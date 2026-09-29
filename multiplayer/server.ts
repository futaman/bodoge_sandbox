import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { reducer, type Action } from '../src/game/reducer';
import type { Card, GameState, Player } from '../shared/game';
import type { ActionLogEntry, ClientMessage, PublicRoomSnapshot, RoomPlayer, ServerMessage } from '../shared/protocol';

const PORT=Number(process.env.PORT??8787);
const ROOM_TTL_MS=6*60*60*1000;
const LOCK_TTL_MS=10_000;
const SAVE_FILE=resolve(process.env.ROOM_DATA_FILE??'multiplayer/data/rooms.json');
const ROOM_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PLAYER_COLORS=['#d64b4b','#397bd8','#e3a52b','#4ca66b','#8556b8','#28a7a1'];

type StoredPlayer=RoomPlayer&{resumeToken:string};
type Lock={playerId:string;expiresAt:number};
type Room={roomId:string;version:number;state:GameState;players:StoredPlayer[];locks:Record<string,Lock>;actionLog:ActionLogEntry[];updatedAt:number};
type Session={roomId?:string;playerId?:string};

const rooms=new Map<string,Room>();
const sockets=new Map<string,Map<string,WebSocket>>();
let saveTimer:NodeJS.Timeout|undefined;

const defaultState=():GameState=>({players:[],cards:[],decks:[],dice:[],tokens:[],pawns:[],tableObjects:[],boards:[{id:crypto.randomUUID(),name:'ボード 1',width:2700,height:1800,backgroundColor:'#4f8567',gridSize:10,gridEnabled:true,snapEnabled:true}],boardShapes:[],boardLines:[],editorMode:'play',pawnLocations:{},cardLocations:{},nextZ:1});
const roomId=()=>Array.from({length:5},()=>ROOM_ALPHABET[Math.floor(Math.random()*ROOM_ALPHABET.length)]).join('');
const uniqueRoomId=()=>{let candidate=roomId();while(rooms.has(candidate))candidate=roomId();return candidate};
const send=(socket:WebSocket,message:ServerMessage)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message))};
const gamePlayer=(playerId:string,name:string,index:number):Player=>({id:playerId,name,color:PLAYER_COLORS[index%PLAYER_COLORS.length],handEnabled:true,scoreEnabled:true,roleEnabled:false,hand:[],score:0});

function visibleState(room:Room,viewerId:string):GameState{
 const ownHand=new Set(room.state.players.find(player=>player.id===viewerId)?.hand??[]);
 const visibleCards=new Map<string,Card>();
 for(const object of room.state.tableObjects.filter(candidate=>candidate.type==='card')){
  const card=room.state.cards.find(candidate=>candidate.id===object.refId);
  if(!card)continue;
  const canSee=!object.faceDown&&card.visibility!=='hidden'&&(card.visibility!=='owner'||card.ownerId===viewerId);
  visibleCards.set(card.id,canSee?card:{id:card.id,suit:'',value:''});
 }
 for(const cardId of ownHand){const card=room.state.cards.find(candidate=>candidate.id===cardId);if(card)visibleCards.set(card.id,card)}
 const deckCardIds=new Set(room.state.decks.flatMap(deck=>deck.cardIds));
 for(const card of room.state.cards)if(room.state.cardLocations[card.id]?.type==='unplaced')visibleCards.set(card.id,card);
 const cardLocations=Object.fromEntries(Object.entries(room.state.cardLocations).filter(([id,location])=>visibleCards.has(id)&&!deckCardIds.has(id)&&!(location.type==='hand'&&location.playerId!==viewerId)));
 return{
  ...structuredClone(room.state),
  cards:[...visibleCards.values()],
  decks:room.state.decks.map(deck=>({...deck,cardIds:Array.from({length:deck.cardIds.length},(_,index)=>`hidden-${deck.id}-${index}`)})),
  players:room.state.players.map(player=>player.id===viewerId?structuredClone(player):{
   ...player,
   hand:Array.from({length:player.hand.length},(_,index)=>`hidden-hand-${player.id}-${index}`),
   role:undefined,
  }),
  cardLocations,
  tableObjects:room.state.tableObjects.map(object=>({...object,lockedBy:room.locks[object.id]?.playerId})),
 };
}

function snapshot(room:Room,viewerId:string):PublicRoomSnapshot{
 return{roomId:room.roomId,version:room.version,state:visibleState(room,viewerId),players:room.players.map(({resumeToken:_,...player})=>player),locks:Object.fromEntries(Object.entries(room.locks).map(([id,lock])=>[id,lock.playerId])),actionLog:room.actionLog.slice(-50)};
}

function broadcast(room:Room){
 const roomSockets=sockets.get(room.roomId);
 if(!roomSockets)return;
 for(const [playerId,socket] of roomSockets)send(socket,{type:'SNAPSHOT',snapshot:snapshot(room,playerId)});
}

function record(room:Room,playerId:string,type:string,targetId?:string){
 const player=room.players.find(candidate=>candidate.playerId===playerId);
 const verbs:Record<string,string>={moveObject:'moved an object',flipTableCard:'flipped a card',shuffleDeck:'shuffled a deck',rollDie:'rolled a die',addCards:'created cards',deleteCard:'deleted a card',returnToDeck:'returned a card'};
 const entry:ActionLogEntry={actionId:crypto.randomUUID(),playerId,playerName:player?.playerName??'Unknown',type,targetId,summary:`${player?.playerName??'Unknown'} ${verbs[type]??type}`,timestamp:Date.now()};
 room.actionLog.push(entry);if(room.actionLog.length>200)room.actionLog.splice(0,room.actionLog.length-200);
}

function touch(room:Room){room.version++;room.updatedAt=Date.now();scheduleSave();broadcast(room)}
function releasePlayerLocks(room:Room,playerId:string){for(const [targetId,lock] of Object.entries(room.locks))if(lock.playerId===playerId)delete room.locks[targetId]}
function mayLock(room:Room,targetId:string,playerId:string){const lock=room.locks[targetId];return!lock||lock.playerId===playerId||lock.expiresAt<Date.now()}

function scheduleSave(){if(saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=undefined;persist()},250)}
function persist(){mkdirSync(dirname(SAVE_FILE),{recursive:true});const temp=`${SAVE_FILE}.tmp`;writeFileSync(temp,JSON.stringify([...rooms.values()],null,2));renameSync(temp,SAVE_FILE)}
function restore(){try{const stored=JSON.parse(readFileSync(SAVE_FILE,'utf8')) as Room[];for(const room of stored)if(Date.now()-room.updatedAt<ROOM_TTL_MS){room.players=room.players.map(player=>({...player,connectionStatus:'offline'}));room.locks={};rooms.set(room.roomId,room)}}catch{/* First run or invalid snapshot: start empty. */}}

function addConnection(room:Room,player:StoredPlayer,socket:WebSocket,session:Session){
 session.roomId=room.roomId;session.playerId=player.playerId;
 player.connectionStatus='online';player.lastSeenAt=Date.now();
 const roomSockets=sockets.get(room.roomId)??new Map<string,WebSocket>();roomSockets.get(player.playerId)?.close(4001,'Reconnected elsewhere');roomSockets.set(player.playerId,socket);sockets.set(room.roomId,roomSockets);
 send(socket,{type:'ROOM_JOINED',roomId:room.roomId,playerId:player.playerId,resumeToken:player.resumeToken});touch(room);
}

function join(room:Room,name:string,resumeToken:string|undefined,socket:WebSocket,session:Session){
 let player=resumeToken?room.players.find(candidate=>candidate.resumeToken===resumeToken):undefined;
 if(!player){const playerId=crypto.randomUUID();const playerName=name.trim()||`Player ${room.players.length+1}`;player={playerId,playerName,color:PLAYER_COLORS[room.players.length%PLAYER_COLORS.length],connectionStatus:'online',joinedAt:Date.now(),lastSeenAt:Date.now(),resumeToken:crypto.randomUUID()};room.players.push(player);room.state.players.push(gamePlayer(player.playerId,player.playerName,room.players.length-1));room.state.activePlayerId??=player.playerId}
 else{const resumedPlayer=player;resumedPlayer.playerName=name.trim()||resumedPlayer.playerName;const existing=room.state.players.find(candidate=>candidate.id===resumedPlayer.playerId);if(existing)existing.name=resumedPlayer.playerName}
 addConnection(room,player,socket,session);
}

function handleMessage(socket:WebSocket,session:Session,message:ClientMessage){
 if(message.type==='ROOM_CREATE'){
  const id=uniqueRoomId();const room:Room={roomId:id,version:0,state:defaultState(),players:[],locks:{},actionLog:[],updatedAt:Date.now()};rooms.set(id,room);join(room,message.playerName,message.resumeToken,socket,session);send(socket,{type:'ROOM_CREATED',roomId:id,playerId:session.playerId!,resumeToken:room.players[0].resumeToken});return;
 }
 if(message.type==='ROOM_JOIN'){
  const room=rooms.get(message.roomId.toUpperCase());if(!room){send(socket,{type:'ERROR',message:'ルームが見つかりません。'});return}join(room,message.playerName,message.resumeToken,socket,session);return;
 }
 if(!session.roomId||!session.playerId){send(socket,{type:'ERROR',message:'先にルームへ参加してください。'});return}
 const room=rooms.get(session.roomId);if(!room)return;
 if(message.type==='ROOM_LEAVE'){socket.close(1000,'Left room');return}
 if(message.type==='DRAG_START'){
  if(!mayLock(room,message.targetId,session.playerId)){send(socket,{type:'ACTION_REJECTED',actionId:message.actionId,reason:'他のプレイヤーが操作中です。'});return}
  room.locks[message.targetId]={playerId:session.playerId,expiresAt:Date.now()+LOCK_TTL_MS};touch(room);return;
 }
 if(message.type==='DRAG_MOVE'||message.type==='DRAG_END'){
  if(!mayLock(room,message.targetId,session.playerId)){send(socket,{type:'ACTION_REJECTED',actionId:message.actionId,reason:'他のプレイヤーが操作中です。'});return}
  room.locks[message.targetId]={playerId:session.playerId,expiresAt:Date.now()+LOCK_TTL_MS};room.state=reducer(room.state,{type:'moveObject',id:message.targetId,position:message.position,snap:message.snap});
  if(message.type==='DRAG_END'){delete room.locks[message.targetId];record(room,session.playerId,'moveObject',message.targetId)}touch(room);return;
 }
 if(message.type==='ACTION'){
  if(message.action.roomId!==room.roomId||message.action.playerId!==session.playerId){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'Actionの送信元が一致しません。'});return}
  let action=message.action.payload as Action;
  if(!action||typeof action!=='object'||typeof action.type!=='string'){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'不正なActionです。'});return}
  if(action.type==='addPlayer'||action.type==='deletePlayer'){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'オンラインでは参加者が自動的にプレイヤーへ追加されます。'});return}
  if(action.type==='updatePlayer'&&action.id!==session.playerId){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'変更できるのは自分のプレイヤー設定だけです。'});return}
  if(action.type==='importSetup')action={...action,players:room.state.players};
  room.state=reducer(room.state,action);
  if(action.type==='updatePlayer'){const presence=room.players.find(candidate=>candidate.playerId===session.playerId);if(presence){if(action.changes.name)presence.playerName=action.changes.name;if(action.changes.color)presence.color=action.changes.color}}
  record(room,session.playerId,action.type,message.action.targetId);touch(room);
 }
}

restore();
const server=new WebSocketServer({port:PORT});
server.on('connection',socket=>{
 const session:Session={};
 socket.on('message',raw=>{try{handleMessage(socket,session,JSON.parse(raw.toString()) as ClientMessage)}catch(error){send(socket,{type:'ERROR',message:error instanceof Error?error.message:'メッセージを処理できませんでした。'})}});
 socket.on('close',()=>{if(!session.roomId||!session.playerId)return;const room=rooms.get(session.roomId);if(!room)return;const roomSockets=sockets.get(room.roomId);if(roomSockets?.get(session.playerId)!==socket)return;roomSockets.delete(session.playerId);const player=room.players.find(candidate=>candidate.playerId===session.playerId);if(player){player.connectionStatus='offline';player.lastSeenAt=Date.now()}releasePlayerLocks(room,session.playerId);touch(room)});
});

setInterval(()=>{const now=Date.now();for(const [id,room] of rooms){for(const [targetId,lock] of Object.entries(room.locks))if(lock.expiresAt<now)delete room.locks[targetId];if(!sockets.get(id)?.size&&now-room.updatedAt>ROOM_TTL_MS){rooms.delete(id);sockets.delete(id)}}scheduleSave()},5000).unref();
console.log(`Multiplayer WebSocket server listening on ws://localhost:${PORT}`);
