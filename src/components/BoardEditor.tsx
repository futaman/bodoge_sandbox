import { useState } from 'react';
import type { Dispatch, PointerEvent } from 'react';
import type { BoardLine, BoardShape, GameState, Point } from '../types/game';
import type { Action } from '../game/reducer';
import { nearestShapeAnchor, snapToGrid, snapToShapes } from '../board/snap';

type Tool='select'|'space'|'shape'|'line';

const TOOL_HELP:Record<Tool,string>={
 select:'マス、図形、線をクリックして選択し、ドラッグで移動します。',
 space:'ボード上をクリックすると、ゲーム用のマスを追加します。',
 shape:'ボード上をクリックすると、装飾用の四角形を追加します。',
 line:'始点と終点を順番にクリックして線を引きます。図形の接続点に近づけるとスナップします。',
};

export function BoardEditor({state,dispatch}:{state:GameState;dispatch:Dispatch<Action>}){
 const board=state.boards[0];
 const [tool,setTool]=useState<Tool>('select');
 const [selectedId,setSelectedId]=useState<string>();
 const [lineStart,setLineStart]=useState<Point>();
 const [count,setCount]=useState(10);
 const selected=state.boardShapes.find(shape=>shape.id===selectedId);
 const selectedLine=state.boardLines.find(line=>line.id===selectedId);

 if(!board)return <main className="board-editor empty"><h1>ボードを作成</h1><p>マスや線を配置できるゲーム盤を追加します。</p><button className="primary" onClick={()=>dispatch({type:'createBoard',name:'ボード 1'})}>＋ ボードを追加</button><button onClick={()=>dispatch({type:'setEditorMode',mode:'play'})}>試遊画面へ戻る</button></main>;

 const boardShapes=state.boardShapes.filter(shape=>shape.boardId===board.id);
 const svgPoint=(svg:SVGSVGElement,clientX:number,clientY:number)=>{
  const matrix=svg.getScreenCTM();
  if(!matrix)return{x:clientX,y:clientY};
  const point=new DOMPoint(clientX,clientY).matrixTransform(matrix.inverse());
  return{x:point.x,y:point.y};
 };
 const snapLinePoint=(point:Point)=>{
  if(!board.snapEnabled)return point;
  return nearestShapeAnchor(point,boardShapes)??snapToGrid(point,board.gridSize);
 };
 const clickBoard=(e:PointerEvent<SVGSVGElement>)=>{
  const background=e.target===e.currentTarget||(e.target as Element).classList.contains('board-background');
  if(tool!=='line'&&!background)return;
  const point=svgPoint(e.currentTarget,e.clientX,e.clientY);
  if(tool==='select'){setSelectedId(undefined);return}
  if(tool==='space'||tool==='shape'){
   dispatch({type:'createShape',boardId:board.id,position:board.snapEnabled?snapToGrid(point,board.gridSize):point,isSpace:tool==='space',shapeType:tool==='space'?'roundedRectangle':'rectangle'});
   return;
  }
  const snapped=snapLinePoint(point);
  if(lineStart){dispatch({type:'createLine',boardId:board.id,start:lineStart,end:snapped});setLineStart(undefined)}
  else setLineStart(snapped);
 };
 const startDrag=(shape:BoardShape,e:PointerEvent<SVGElement>)=>{
  if(tool==='line')return;
  e.stopPropagation();setSelectedId(shape.id);
  if(tool!=='select')return;
  const svg=e.currentTarget.ownerSVGElement;if(!svg)return;
  const pointerStart=svgPoint(svg,e.clientX,e.clientY),origin=shape.position;
  const move=(event:globalThis.PointerEvent)=>{const current=svgPoint(svg,event.clientX,event.clientY);let position={x:origin.x+current.x-pointerStart.x,y:origin.y+current.y-pointerStart.y};if(board.snapEnabled&&!event.altKey){position=snapToGrid(position,board.gridSize);position=snapToShapes(position,state.boardShapes,shape.id)}dispatch({type:'moveShape',id:shape.id,position})};
  const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end)};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
 };
 const startLineDrag=(line:BoardLine,e:PointerEvent<SVGGElement>)=>{
  if(tool==='line')return;
  e.stopPropagation();setSelectedId(line.id);
  if(tool!=='select')return;
  const svg=e.currentTarget.ownerSVGElement;if(!svg)return;
  const pointerStart=svgPoint(svg,e.clientX,e.clientY),originStart={...line.start},originEnd={...line.end};
  const move=(event:globalThis.PointerEvent)=>{
   const current=svgPoint(svg,event.clientX,event.clientY),delta={x:current.x-pointerStart.x,y:current.y-pointerStart.y};
   let start={x:originStart.x+delta.x,y:originStart.y+delta.y},end={x:originEnd.x+delta.x,y:originEnd.y+delta.y};
   if(board.snapEnabled&&!event.altKey){
    const startSnap=nearestShapeAnchor(start,boardShapes),endSnap=nearestShapeAnchor(end,boardShapes);
    if(startSnap||endSnap){const startDistance=startSnap?Math.hypot(startSnap.x-start.x,startSnap.y-start.y):Infinity,endDistance=endSnap?Math.hypot(endSnap.x-end.x,endSnap.y-end.y):Infinity;const target=startDistance<=endDistance?startSnap!:endSnap!,source=startDistance<=endDistance?start:end,correction={x:target.x-source.x,y:target.y-source.y};start={x:start.x+correction.x,y:start.y+correction.y};end={x:end.x+correction.x,y:end.y+correction.y}}
    else{const gridStart=snapToGrid(start,board.gridSize),correction={x:gridStart.x-start.x,y:gridStart.y-start.y};start=gridStart;end={x:end.x+correction.x,y:end.y+correction.y}}
   }
   dispatch({type:'moveLine',id:line.id,start,end});
  };
  const endDrag=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',endDrag);window.removeEventListener('pointercancel',endDrag)};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',endDrag);window.addEventListener('pointercancel',endDrag);
 };
 const chooseTool=(next:Tool)=>{setTool(next);setLineStart(undefined)};

 return <main className="board-editor">
  <header><div><strong>ボード編集：{board.name}</strong><small>編集内容は試遊画面にもそのまま反映されます</small></div><button onClick={()=>dispatch({type:'setEditorMode',mode:'play'})}>試遊画面へ</button></header>
  <aside className="board-tools">
   <h2>ツール</h2>
   {([['select','選択・移動'],['space','マスを追加'],['shape','図形を追加'],['line','線を引く']] as [Tool,string][]).map(([key,label])=><button key={key} className={tool===key?'active':''} onClick={()=>chooseTool(key)}>{label}</button>)}
   <p className="tool-help">{TOOL_HELP[tool]}{tool==='line'&&lineStart&&<b> 始点を設定済みです。終点をクリックしてください。</b>}</p>
   <section className="generator"><h2>マス一括生成</h2><label>個数<input type="number" min="1" max="100" value={count} onChange={e=>setCount(Math.max(1,+e.target.value))}/></label><button onClick={()=>dispatch({type:'generateSpaces',boardId:board.id,count,spacing:16,autoNumber:true,start:1})}>番号つきマスを生成</button></section>
   <label className="snap-toggle"><input type="checkbox" checked={board.snapEnabled} onChange={e=>dispatch({type:'updateBoard',id:board.id,changes:{snapEnabled:e.target.checked}})}/><span>位置をスナップ</span></label><small>Altを押しながら移動すると一時的に無効化できます。</small>
   {selected&&<section className="shape-properties"><h2>選択中の図形</h2><label>ラベル<input value={selected.label??''} onChange={e=>dispatch({type:'updateShape',id:selected.id,changes:{label:e.target.value}})}/></label><label>メモ<textarea value={selected.note??''} onChange={e=>dispatch({type:'updateShape',id:selected.id,changes:{note:e.target.value}})}/></label><label>幅<input type="number" value={selected.width} onChange={e=>dispatch({type:'updateShape',id:selected.id,changes:{width:+e.target.value}})}/></label><label>高さ<input type="number" value={selected.height} onChange={e=>dispatch({type:'updateShape',id:selected.id,changes:{height:+e.target.value}})}/></label><label className="snap-toggle"><input type="checkbox" checked={selected.isSpace} onChange={e=>dispatch({type:'updateShape',id:selected.id,changes:{isSpace:e.target.checked}})}/><span>ゲームのマスとして使用</span></label><div><button onClick={()=>dispatch({type:'duplicateShape',id:selected.id})}>複製</button><button className="danger" onClick={()=>{dispatch({type:'deleteShape',id:selected.id});setSelectedId(undefined)}}>削除</button></div></section>}
   {selectedLine&&<section className="shape-properties"><h2>選択中の線</h2><p className="tool-help">ドラッグすると線全体を移動できます。図形の接続点付近では端点がスナップします。</p><button className="danger" onClick={()=>{dispatch({type:'deleteLine',id:selectedLine.id});setSelectedId(undefined)}}>線を削除</button></section>}
  </aside>
  <div className="board-canvas-wrap"><svg className="board-svg" viewBox={`0 0 ${board.width} ${board.height}`} onPointerDown={clickBoard}>
   <defs><pattern id="grid" width={board.gridSize} height={board.gridSize} patternUnits="userSpaceOnUse"><path d={`M ${board.gridSize} 0 L 0 0 0 ${board.gridSize}`} fill="none" stroke="#fff" strokeOpacity=".18"/></pattern><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#26372e"/></marker></defs>
   <rect className="board-background" width={board.width} height={board.height} fill={board.backgroundColor}/>{board.gridEnabled&&<rect className="board-background" width={board.width} height={board.height} fill="url(#grid)"/>}
   {state.boardLines.filter(line=>line.boardId===board.id).map(line=><g key={line.id} className={`board-line ${selectedId===line.id?'selected':''}`} onPointerDown={event=>startLineDrag(line,event)}><line className="line-hit" x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y}/><line className="line-visible" x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke="#26372e" strokeWidth={line.strokeWidth} strokeDasharray={line.lineStyle==='dashed'?'8 6':undefined} markerEnd={line.arrow==='end'?'url(#arrow)':undefined}/>{selectedId===line.id&&<><circle className="line-handle" cx={line.start.x} cy={line.start.y} r="5"/><circle className="line-handle" cx={line.end.x} cy={line.end.y} r="5"/></>}</g>)}
   {lineStart&&<circle cx={lineStart.x} cy={lineStart.y} r="6" fill="#f2b544"/>}
   {boardShapes.map(shape=><g key={shape.id} className={selectedId===shape.id?'board-shape selected':'board-shape'} onPointerDown={event=>startDrag(shape,event)}>{shape.shapeType==='circle'?<ellipse cx={shape.position.x+shape.width/2} cy={shape.position.y+shape.height/2} rx={shape.width/2} ry={shape.height/2} fill={shape.fillColor} stroke={shape.strokeColor} strokeWidth={shape.strokeWidth}/>:<rect x={shape.position.x} y={shape.position.y} width={shape.width} height={shape.height} rx={shape.shapeType==='roundedRectangle'?12:0} fill={shape.fillColor} stroke={shape.strokeColor} strokeWidth={shape.strokeWidth}/>}<text x={shape.position.x+shape.width/2} y={shape.position.y+shape.height/2+5} textAnchor="middle">{shape.label}</text>{shape.note&&<title>{shape.note}</title>}</g>)}
  </svg></div>
 </main>;
}
