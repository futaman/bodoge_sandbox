import { useReducer, useState } from 'react';
import type { Dispatch } from 'react';
import { reducer, type Action } from './game/reducer';
import { initialState } from './game/initialState';
import { SetupPage } from './pages/SetupPage';
import { PlayPage } from './pages/PlayPage';
import { BoardEditor } from './components/BoardEditor';
import { BoardZoom } from './components/BoardZoom';
import { ModeLanding } from './components/ModeLanding';
import { OnlineRoomBar } from './components/OnlineRoomBar';
import { useRoomConnection } from './multiplayer/useRoomConnection';
import type { GameState } from './types/game';

type Screen='landing'|'local-setup'|'local-play'|'online-setup'|'online-play';
function GameView({state,dispatch,onSetup,editorMode,setEditorMode,viewerId}:{state:GameState;dispatch:Dispatch<Action>;onSetup:()=>void;editorMode:'play'|'board';setEditorMode:(mode:'play'|'board')=>void;viewerId?:string}){const viewState={...state,editorMode};const viewDispatch:Dispatch<Action>=action=>action.type==='setEditorMode'?setEditorMode(action.mode):dispatch(action);return editorMode==='board'?<BoardEditor state={viewState} dispatch={viewDispatch}/>:<><button className="mode-switch" onClick={()=>setEditorMode('board')}>Board Edit</button><BoardZoom/><PlayPage state={viewState} dispatch={viewDispatch} onSetup={onSetup} viewerId={viewerId}/></>}

export default function App(){
 const [localState,localDispatch]=useReducer(reducer,initialState);const [screen,setScreen]=useState<Screen>('landing');const [editorMode,setEditorMode]=useState<'play'|'board'>('play');const room=useRoomConnection();const onlineState=room.snapshot?.state;
 const startLocal=()=>{if(!localState.boards.length)localDispatch({type:'createBoard',name:'ボード 1'});setScreen('local-play')};const startOnline=()=>{if(onlineState&&!onlineState.boards.length)room.dispatch({type:'createBoard',name:'ボード 1'});setScreen('online-play')};const leave=()=>{room.leaveRoom();setScreen('landing');setEditorMode('play')};
 if(screen==='landing')return <ModeLanding error={room.error} onLocal={()=>setScreen('local-setup')} onCreate={name=>{room.createRoom(name);setScreen('online-setup')}} onJoin={(id,name)=>{room.joinRoom(id,name);setScreen('online-play')}}/>;
 if(screen==='local-setup')return <SetupPage state={localState} dispatch={localDispatch} onStart={startLocal}/>;
 if(screen==='local-play')return <GameView state={localState} dispatch={localDispatch} onSetup={()=>setScreen('local-setup')} editorMode={editorMode} setEditorMode={setEditorMode}/>;
 return <div className="online-session">{room.roomId&&<OnlineRoomBar roomId={room.roomId} status={room.status} players={room.snapshot?.players??[]} onLeave={leave}/>} {room.error&&<div className="online-error" role="alert">{room.error}</div>}{!onlineState?<main className="room-loading"><div className="loading-spinner"/><h1>{room.status==='reconnecting'?'再接続しています…':'ルームへ接続しています…'}</h1><button onClick={leave}>戻る</button></main>:screen==='online-setup'?<SetupPage state={onlineState} dispatch={room.dispatch} onStart={startOnline} online currentPlayerId={room.playerId}/>:<GameView state={onlineState} dispatch={room.dispatch} onSetup={()=>setScreen('online-setup')} editorMode={editorMode} setEditorMode={setEditorMode} viewerId={room.playerId}/>}</div>;
}
