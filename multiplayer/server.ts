import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { reducer, type Action } from '../src/game/reducer';
import type { Card, GameState, Player } from '../shared/game';
import type { ActionLogEntry, ClientMessage, PublicRoomSnapshot, RoomPlayer, ServerMessage } from '../shared/protocol';

const PORT=Number(process.env.PORT??8787);
const ROOM_TTL_MS=6*60*60*1000;
const LOCK_TTL_MS=10_000;
const DRAG_BROADCAST_INTERVAL_MS=40;
const HEARTBEAT_INTERVAL_MS=30_000;
const RATE_WINDOW_MS=10_000;
const MAX_MESSAGES_PER_WINDOW=400;
const MAX_ACTIONS_PER_WINDOW=80;
const MAX_CONNECTIONS_PER_IP=12;
const MAX_ROOMS=500;
const MAX_PLAYERS_PER_ROOM=12;
const MAX_CARDS_PER_ROOM=2_000;
const MAX_TABLE_OBJECTS_PER_ROOM=2_500;
const MAX_PAYLOAD_BYTES=64*1024;
const SAVE_FILE=resolve(process.env.ROOM_DATA_FILE??'multiplayer/data/rooms.json');
const ALLOWED_ORIGINS=(process.env.ALLOWED_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean);
const ROOM_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PLAYER_COLORS=['#d64b4b','#397bd8','#e3a52b','#4ca66b','#8556b8','#28a7a1'];

type StoredPlayer=RoomPlayer&{resumeToken:string};
type Lock={playerId:string;expiresAt:number};
type Room={roomId:string;version:number;state:GameState;players:StoredPlayer[];locks:Record<string,Lock>;actionLog:ActionLogEntry[];updatedAt:number};
type Session={roomId?:string;playerId?:string;dragUpdates:Map<string,number>;rateStartedAt:number;messagesInWindow:number;actionsInWindow:number};
type LiveSocket=WebSocket&{isAlive:boolean;clientIp:string};

const rooms=new Map<string,Room>();
const sockets=new Map<string,Map<string,WebSocket>>();
const connectionsByIp=new Map<string,number>();
let saveTimer:NodeJS.Timeout|undefined;
let shuttingDown=false;

const ALLOWED_ACTION_TYPES=new Set<Action['type']>([
 'setEditorMode','createBoard','updateBoard','createShape','moveShape','updateShape','deleteShape','duplicateShape','generateSpaces','createLine','moveLine','deleteLine',
 'addPlayer','updatePlayer','deletePlayer','exchangeCards','importSetup','createCards','addCards','updateCard','deleteCard','deleteCards','createDeck','deleteDeck','shuffleDeck','drawCard','drawCardToTable','dealCards','dealEvenly','returnToDeck','moveCardToTable','moveCardToHand','setHandCardsRevealed','moveObject','flipTableCard','selectPlayer','addDie','rollDie','addToken','updateToken','deleteToken','addPawn','updatePawn','deletePawn','changeScore',
]);

const defaultState=():GameState=>({players:[],cards:[],decks:[],dice:[],tokens:[],pawns:[],tableObjects:[],boards:[{id:crypto.randomUUID(),name:'ボード 1',width:2700,height:1800,backgroundColor:'#4f8567',gridSize:10,gridEnabled:true,snapEnabled:true}],boardShapes:[],boardLines:[],editorMode:'play',pawnLocations:{},cardLocations:{},nextZ:1});
const roomId=()=>Array.from({length:5},()=>ROOM_ALPHABET[Math.floor(Math.random()*ROOM_ALPHABET.length)]).join('');
const uniqueRoomId=()=>{let candidate=roomId();while(rooms.has(candidate))candidate=roomId();return candidate};
const send=(socket:WebSocket,message:ServerMessage)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message))};
const gamePlayer=(playerId:string,name:string,index:number):Player=>({id:playerId,name,color:PLAYER_COLORS[index%PLAYER_COLORS.length],handEnabled:true,scoreEnabled:true,roleEnabled:false,hand:[],score:0});
const safePlayerName=(name:string)=>name.trim().slice(0,30)||'プレイヤー';
const validRoomId=(value:string)=>/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(value);
const privateHost=(host:string)=>host==='localhost'||host==='127.0.0.1'||host==='[::1]'||/^192\.168\./.test(host)||/^10\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host);
function originAllowed(origin:string|undefined){
 if(ALLOWED_ORIGINS.length)return!!origin&&ALLOWED_ORIGINS.includes(origin);
 if(process.env.NODE_ENV==='production')return false;
 if(!origin)return true;
 try{return privateHost(new URL(origin).hostname)}catch{return false}
}
function stateWithinLimits(state:GameState){return state.cards.length<=MAX_CARDS_PER_ROOM&&state.tableObjects.length<=MAX_TABLE_OBJECTS_PER_ROOM&&state.players.length<=MAX_PLAYERS_PER_ROOM}
function actionWithinLimits(action:Action){
 if(action.type==='createCards')return action.copies>0&&action.copies*action.suits.length*action.values.length<=MAX_CARDS_PER_ROOM;
 if(action.type==='addCards')return action.copies>0&&action.copies<=200;
 if(action.type==='importSetup')return action.cards.length<=MAX_CARDS_PER_ROOM;
 if(action.type==='generateSpaces')return action.count>0&&action.count<=500;
 if(action.type==='dealCards'||action.type==='dealEvenly')return action.count>0&&action.count<=500;
 if(action.type==='setHandCardsRevealed')return action.cardIds.length<=MAX_CARDS_PER_ROOM;
 return true;
}
function rateLimited(session:Session,isAction:boolean){
 const now=Date.now();if(now-session.rateStartedAt>=RATE_WINDOW_MS){session.rateStartedAt=now;session.messagesInWindow=0;session.actionsInWindow=0}
 session.messagesInWindow++;if(isAction)session.actionsInWindow++;
 return session.messagesInWindow>MAX_MESSAGES_PER_WINDOW||(isAction&&session.actionsInWindow>MAX_ACTIONS_PER_WINDOW);
}

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
 for(const player of room.state.players)for(const cardId of player.revealedHandCardIds??[]){const card=room.state.cards.find(candidate=>candidate.id===cardId);if(card)visibleCards.set(card.id,card)}
 const deckCardIds=new Set(room.state.decks.flatMap(deck=>deck.cardIds));
 for(const card of room.state.cards)if(room.state.cardLocations[card.id]?.type==='unplaced')visibleCards.set(card.id,card);
 const cardLocations=Object.fromEntries(Object.entries(room.state.cardLocations).filter(([id,location])=>visibleCards.has(id)&&!deckCardIds.has(id)&&!(location.type==='hand'&&location.playerId!==viewerId)));
 return{
  ...structuredClone(room.state),
  cards:[...visibleCards.values()],
  decks:room.state.decks.map(deck=>({...deck,cardIds:Array.from({length:deck.cardIds.length},(_,index)=>`hidden-${deck.id}-${index}`)})),
  players:room.state.players.map(player=>player.id===viewerId?structuredClone(player):{
   ...player,
   hand:player.hand.map((cardId,index)=>player.revealedHandCardIds?.includes(cardId)?cardId:`hidden-hand-${player.id}-${index}`),
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
function persist(){try{mkdirSync(dirname(SAVE_FILE),{recursive:true});const temp=`${SAVE_FILE}.tmp`;writeFileSync(temp,JSON.stringify([...rooms.values()],null,2));renameSync(temp,SAVE_FILE)}catch(error){console.error('Failed to persist rooms',error)}}
function restore(){try{const stored=JSON.parse(readFileSync(SAVE_FILE,'utf8')) as unknown;if(!Array.isArray(stored))return;for(const candidate of stored){const room=candidate as Room;if(room?.roomId&&room.state&&Array.isArray(room.players)&&Date.now()-room.updatedAt<ROOM_TTL_MS&&stateWithinLimits(room.state)){room.players=room.players.map(player=>({...player,connectionStatus:'offline'}));room.locks={};rooms.set(room.roomId,room)}}}catch{/* First run or invalid snapshot: start empty. */}}

function addConnection(room:Room,player:StoredPlayer,socket:WebSocket,session:Session,created=false){
 session.roomId=room.roomId;session.playerId=player.playerId;
 player.connectionStatus='online';player.lastSeenAt=Date.now();
 const roomSockets=sockets.get(room.roomId)??new Map<string,WebSocket>();roomSockets.get(player.playerId)?.close(4001,'Reconnected elsewhere');roomSockets.set(player.playerId,socket);sockets.set(room.roomId,roomSockets);
 send(socket,{type:created?'ROOM_CREATED':'ROOM_JOINED',roomId:room.roomId,playerId:player.playerId,resumeToken:player.resumeToken});touch(room);
}

function join(room:Room,name:string,resumeToken:string|undefined,socket:WebSocket,session:Session,created=false){
 let player=resumeToken?room.players.find(candidate=>candidate.resumeToken===resumeToken):undefined;
 if(!player&&room.players.length>=MAX_PLAYERS_PER_ROOM){send(socket,{type:'ERROR',message:'このルームは参加人数の上限に達しています。'});return}
 if(!player){const playerId=crypto.randomUUID();const playerName=safePlayerName(name)||`Player ${room.players.length+1}`;player={playerId,playerName,color:PLAYER_COLORS[room.players.length%PLAYER_COLORS.length],connectionStatus:'online',joinedAt:Date.now(),lastSeenAt:Date.now(),resumeToken:crypto.randomUUID()};room.players.push(player);room.state.players.push(gamePlayer(player.playerId,player.playerName,room.players.length-1));room.state.activePlayerId??=player.playerId}
 else{const resumedPlayer=player;resumedPlayer.playerName=safePlayerName(name)||resumedPlayer.playerName;const existing=room.state.players.find(candidate=>candidate.id===resumedPlayer.playerId);if(existing)existing.name=resumedPlayer.playerName}
 addConnection(room,player,socket,session,created);
}

function handleMessage(socket:WebSocket,session:Session,message:ClientMessage){
 if(message.type==='ROOM_CREATE'){
  if(session.roomId){send(socket,{type:'ERROR',message:'すでにルームへ参加しています。'});return}
  if(rooms.size>=MAX_ROOMS){send(socket,{type:'ERROR',message:'現在ルームを作成できません。時間をおいて再試行してください。'});return}
  const id=uniqueRoomId();const room:Room={roomId:id,version:0,state:defaultState(),players:[],locks:{},actionLog:[],updatedAt:Date.now()};rooms.set(id,room);join(room,message.playerName,message.resumeToken,socket,session,true);return;
 }
 if(message.type==='ROOM_JOIN'){
  if(session.roomId){send(socket,{type:'ERROR',message:'すでにルームへ参加しています。'});return}
  const id=message.roomId.toUpperCase();if(!validRoomId(id)){send(socket,{type:'ERROR',message:'ルームIDの形式が正しくありません。'});return}const room=rooms.get(id);if(!room){send(socket,{type:'ERROR',message:'ルームが見つかりません。'});return}join(room,message.playerName,message.resumeToken,socket,session);return;
 }
 if(!session.roomId||!session.playerId){send(socket,{type:'ERROR',message:'先にルームへ参加してください。'});return}
 const room=rooms.get(session.roomId);if(!room)return;
 if(message.type==='ROOM_LEAVE'){socket.close(1000,'Left room');return}
 if(message.type==='DRAG_START'){
  if(!mayLock(room,message.targetId,session.playerId)){send(socket,{type:'ACTION_REJECTED',actionId:message.actionId,reason:'他のプレイヤーが操作中です。'});return}
  session.dragUpdates.delete(message.targetId);
  room.locks[message.targetId]={playerId:session.playerId,expiresAt:Date.now()+LOCK_TTL_MS};touch(room);return;
 }
 if(message.type==='DRAG_MOVE'||message.type==='DRAG_END'){
  if(!mayLock(room,message.targetId,session.playerId)){send(socket,{type:'ACTION_REJECTED',actionId:message.actionId,reason:'他のプレイヤーが操作中です。'});return}
  if(message.type==='DRAG_MOVE'){const now=Date.now(),last=session.dragUpdates.get(message.targetId)??0;if(now-last<DRAG_BROADCAST_INTERVAL_MS)return;session.dragUpdates.set(message.targetId,now)}
  if(!Number.isFinite(message.position.x)||!Number.isFinite(message.position.y)){send(socket,{type:'ACTION_REJECTED',actionId:message.actionId,reason:'移動先が不正です。'});return}
  room.locks[message.targetId]={playerId:session.playerId,expiresAt:Date.now()+LOCK_TTL_MS};room.state=reducer(room.state,{type:'moveObject',id:message.targetId,position:message.position,snap:message.snap});
  if(message.type==='DRAG_END'){session.dragUpdates.delete(message.targetId);delete room.locks[message.targetId];record(room,session.playerId,'moveObject',message.targetId)}touch(room);return;
 }
 if(message.type==='ACTION'){
  if(message.action.roomId!==room.roomId||message.action.playerId!==session.playerId){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'Actionの送信元が一致しません。'});return}
  let action=message.action.payload as Action;
  if(!action||typeof action!=='object'||typeof action.type!=='string'){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'不正なActionです。'});return}
  if(!ALLOWED_ACTION_TYPES.has(action.type)){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'許可されていないActionです。'});return}
  if(!actionWithinLimits(action)){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'一度に操作できる上限を超えています。'});return}
  if(action.type==='addPlayer'||action.type==='deletePlayer'){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'オンラインでは参加者が自動的にプレイヤーへ追加されます。'});return}
  // Online actions always target the connected player. The selected player is a local UI concern.
  if(action.type==='selectPlayer'){return}
  if(action.type==='drawCard'||action.type==='dealCards')action={...action,playerId:session.playerId};
  if(action.type==='setHandCardsRevealed')action={...action,playerId:session.playerId};
  if(action.type==='updatePlayer'&&action.id!==session.playerId){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'変更できるのは自分のプレイヤー設定だけです。'});return}
  if(action.type==='importSetup')action={...action,players:room.state.players};
  const nextState=reducer(room.state,action);if(!stateWithinLimits(nextState)){send(socket,{type:'ACTION_REJECTED',actionId:message.action.actionId,reason:'ルームの上限を超えるため操作できません。'});return}room.state=nextState;
  if(action.type==='updatePlayer'){const presence=room.players.find(candidate=>candidate.playerId===session.playerId);if(presence){if(action.changes.name)presence.playerName=action.changes.name;if(action.changes.color)presence.color=action.changes.color}}
  record(room,session.playerId,action.type,message.action.targetId);touch(room);
 }
}

restore();
const httpServer=createServer((request,response)=>{
 response.setHeader('Content-Type','application/json; charset=utf-8');
 if(request.method==='GET'&&request.url==='/health'){response.writeHead(shuttingDown?503:200);response.end(JSON.stringify({status:shuttingDown?'shutting-down':'ok'}));return}
 response.writeHead(404);response.end(JSON.stringify({error:'Not found',websocketPath:'/ws'}));
});
const server=new WebSocketServer({noServer:true,maxPayload:MAX_PAYLOAD_BYTES,perMessageDeflate:false});
httpServer.on('upgrade',(request,networkSocket,head)=>{
 const path=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`).pathname;
 if(shuttingDown||path!=='/ws'||!originAllowed(request.headers.origin)){networkSocket.write(`HTTP/1.1 ${path!=='/ws'?404:403} ${path!=='/ws'?'Not Found':'Forbidden'}\r\nConnection: close\r\n\r\n`);networkSocket.destroy();return}
 server.handleUpgrade(request,networkSocket,head,socket=>server.emit('connection',socket,request));
});
server.on('connection',(baseSocket,request)=>{
 const socket=baseSocket as LiveSocket;const clientIp=request.socket.remoteAddress??'unknown';const connections=(connectionsByIp.get(clientIp)??0)+1;
 if(connections>MAX_CONNECTIONS_PER_IP){socket.close(1008,'Too many connections');return}
 connectionsByIp.set(clientIp,connections);socket.clientIp=clientIp;socket.isAlive=true;socket.on('pong',()=>{socket.isAlive=true});
 const session:Session={dragUpdates:new Map(),rateStartedAt:Date.now(),messagesInWindow:0,actionsInWindow:0};
 socket.on('message',(raw,isBinary)=>{try{if(isBinary){socket.close(1003,'Text messages only');return}const message=JSON.parse(raw.toString()) as ClientMessage;const countsAsAction=message.type!=='DRAG_MOVE';if(rateLimited(session,countsAsAction)){if(session.messagesInWindow>MAX_MESSAGES_PER_WINDOW)socket.close(1008,'Rate limit exceeded');else send(socket,{type:'ACTION_REJECTED',reason:'操作が速すぎます。少し待ってから再試行してください。'});return}handleMessage(socket,session,message)}catch(error){console.warn('Rejected malformed WebSocket message',{clientIp,error:error instanceof Error?error.message:'unknown'});send(socket,{type:'ERROR',message:'メッセージを処理できませんでした。'})}});
 socket.on('close',()=>{connectionsByIp.set(clientIp,Math.max(0,(connectionsByIp.get(clientIp)??1)-1));if(!session.roomId||!session.playerId)return;const room=rooms.get(session.roomId);if(!room)return;const roomSockets=sockets.get(room.roomId);if(roomSockets?.get(session.playerId)!==socket)return;roomSockets.delete(session.playerId);const player=room.players.find(candidate=>candidate.playerId===session.playerId);if(player){player.connectionStatus='offline';player.lastSeenAt=Date.now()}releasePlayerLocks(room,session.playerId);touch(room)});
});

setInterval(()=>{const now=Date.now();for(const [id,room] of rooms){for(const [targetId,lock] of Object.entries(room.locks))if(lock.expiresAt<now)delete room.locks[targetId];if(!sockets.get(id)?.size&&now-room.updatedAt>ROOM_TTL_MS){rooms.delete(id);sockets.delete(id)}}scheduleSave()},5000).unref();
setInterval(()=>{for(const baseSocket of server.clients){const socket=baseSocket as LiveSocket;if(!socket.isAlive){socket.terminate();continue}socket.isAlive=false;socket.ping()}},HEARTBEAT_INTERVAL_MS).unref();
function shutdown(signal:string){if(shuttingDown)return;shuttingDown=true;console.log(`${signal} received; saving rooms and closing connections`);if(saveTimer){clearTimeout(saveTimer);saveTimer=undefined}persist();for(const socket of server.clients)socket.close(1012,'Server restarting');httpServer.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10_000).unref()}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
httpServer.listen(PORT,'0.0.0.0',()=>console.log(`Multiplayer server listening on http://0.0.0.0:${PORT} (WebSocket: /ws)`));
