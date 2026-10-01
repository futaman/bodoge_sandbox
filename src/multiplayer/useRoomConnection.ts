import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '../game/reducer';
import type { Position } from '../types/game';
import type { ClientMessage, ConnectionStatus, PublicRoomSnapshot, ServerMessage } from '../../shared/protocol';
import { createActionId } from '../../shared/protocol';

type JoinIntent={roomId?:string;playerName:string;resumeToken?:string};
type DragState={actionId:string;lastSent:number;position:Position;snap?:boolean;timer?:number};
const DRAG_BROADCAST_INTERVAL_MS=50;

const socketUrl=()=>{const configured=String(import.meta.env.VITE_MULTIPLAYER_URL??'').trim();return configured?(configured.endsWith('/ws')?configured:`${configured.replace(/\/$/,'')}/ws`):`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:8787/ws`};
const roomPath=(roomId:string)=>`${import.meta.env.BASE_URL}room/${roomId}`.replace(/\/+/g,'/');
const tokenKey=(roomId:string)=>`boardgame-room-token:${roomId}`;

export function useRoomConnection(){
 const socketRef=useRef<WebSocket|null>(null);
 const intentRef=useRef<JoinIntent|null>(null);
 const reconnectTimer=useRef<number|undefined>(undefined);
 const reconnectAttempt=useRef(0);
 const leaving=useRef(false);
 const dragRef=useRef(new Map<string,DragState>());
 const [status,setStatus]=useState<ConnectionStatus>('offline');
 const [snapshot,setSnapshot]=useState<PublicRoomSnapshot>();
 const [roomId,setRoomId]=useState<string>();
 const [playerId,setPlayerId]=useState<string>();
 const [error,setError]=useState<string>();

 const send=useCallback((message:ClientMessage)=>{const socket=socketRef.current;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message))},[]);
 const open=useCallback((intent:JoinIntent,creating=false)=>{
  clearTimeout(reconnectTimer.current);socketRef.current?.close(1000,'Replacing connection');intentRef.current=intent;leaving.current=false;setError(undefined);setStatus(reconnectAttempt.current?'reconnecting':'offline');
  const socket=new WebSocket(socketUrl());socketRef.current=socket;
  socket.onopen=()=>{const resumeToken=intent.roomId?localStorage.getItem(tokenKey(intent.roomId))??intent.resumeToken:intent.resumeToken;const message:ClientMessage=creating?{type:'ROOM_CREATE',playerName:intent.playerName}:{type:'ROOM_JOIN',roomId:intent.roomId!,playerName:intent.playerName,resumeToken};socket.send(JSON.stringify(message))};
  socket.onmessage=event=>{const message=JSON.parse(event.data) as ServerMessage;if(message.type==='ROOM_CREATED'||message.type==='ROOM_JOINED'){localStorage.setItem(tokenKey(message.roomId),message.resumeToken);intentRef.current={roomId:message.roomId,playerName:intent.playerName,resumeToken:message.resumeToken};reconnectAttempt.current=0;setRoomId(message.roomId);setPlayerId(message.playerId);setStatus('online');history.replaceState(null,'',roomPath(message.roomId))}else if(message.type==='SNAPSHOT'){setSnapshot(message.snapshot);setStatus('online')}else if(message.type==='ERROR'||message.type==='ACTION_REJECTED')setError(message.type==='ERROR'?message.message:message.reason)};
  socket.onerror=()=>setError('マルチプレイヤーサーバーへ接続できません。サーバーの起動またはURL設定を確認してください。');
  socket.onclose=()=>{if(socketRef.current!==socket||leaving.current)return;setStatus('reconnecting');const next=intentRef.current;if(!next?.roomId)return;const delay=Math.min(1000*2**reconnectAttempt.current,10_000);reconnectAttempt.current++;reconnectTimer.current=window.setTimeout(()=>open(next,false),delay)};
 },[]);
 const createRoom=useCallback((playerName:string)=>{reconnectAttempt.current=0;open({playerName},true)},[open]);
 const joinRoom=useCallback((id:string,playerName:string)=>{reconnectAttempt.current=0;open({roomId:id.trim().toUpperCase(),playerName},false)},[open]);
 const leaveRoom=useCallback(()=>{leaving.current=true;clearTimeout(reconnectTimer.current);send({type:'ROOM_LEAVE'});socketRef.current?.close(1000,'Left room');socketRef.current=null;intentRef.current=null;setSnapshot(undefined);setRoomId(undefined);setPlayerId(undefined);setStatus('offline');setError(undefined);history.replaceState(null,'',import.meta.env.BASE_URL)},[send]);
 const dispatch=useCallback((action:Action)=>{
  if(!roomId||!playerId)return;
  if(action.type==='moveObject'){
   const now=performance.now();let drag=dragRef.current.get(action.id);if(!drag){drag={actionId:createActionId(),lastSent:0,position:action.position,snap:action.snap};dragRef.current.set(action.id,drag);send({type:'DRAG_START',actionId:drag.actionId,targetId:action.id})}
   drag.position=action.position;drag.snap=action.snap;if(now-drag.lastSent>=DRAG_BROADCAST_INTERVAL_MS){send({type:'DRAG_MOVE',actionId:drag.actionId,targetId:action.id,position:drag.position,snap:drag.snap});drag.lastSent=now}
   clearTimeout(drag.timer);drag.timer=window.setTimeout(()=>{const final=dragRef.current.get(action.id);if(!final)return;send({type:'DRAG_END',actionId:final.actionId,targetId:action.id,position:final.position,snap:final.snap});dragRef.current.delete(action.id)},100);return;
  }
  const targetId='id' in action&&typeof action.id==='string'?action.id:'deckId' in action?String(action.deckId):'cardId' in action?String(action.cardId):undefined;
  send({type:'ACTION',action:{actionId:createActionId(),type:action.type,playerId,roomId,targetId,payload:action,timestamp:Date.now()}});
 },[playerId,roomId,send]);
 useEffect(()=>()=>{leaving.current=true;clearTimeout(reconnectTimer.current);socketRef.current?.close()},[]);
 return{status,snapshot,roomId,playerId,error,createRoom,joinRoom,leaveRoom,dispatch};
}
