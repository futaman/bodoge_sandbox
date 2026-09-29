import { useReducer, useState } from 'react';
import { reducer } from './game/reducer';
import { initialState } from './game/initialState';
import { SetupPage } from './pages/SetupPage';
import { PlayPage } from './pages/PlayPage';
import { BoardEditor } from './components/BoardEditor';
import { BoardZoom } from './components/BoardZoom';
export default function App(){const [state,dispatch]=useReducer(reducer,initialState);const [playing,setPlaying]=useState(false);const startPlaying=()=>{if(!state.boards.length)dispatch({type:'createBoard',name:'ボード 1'});setPlaying(true)};return playing?(state.editorMode==='board'?<BoardEditor state={state} dispatch={dispatch}/>:<><button className="mode-switch" onClick={()=>dispatch({type:'setEditorMode',mode:'board'})}>Board Edit</button><BoardZoom/><PlayPage state={state} dispatch={dispatch} onSetup={()=>setPlaying(false)}/></>):<SetupPage state={state} dispatch={dispatch} onStart={startPlaying}/>}
