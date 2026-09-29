import type { GameState } from '../types/game';

export function BoardLayer({state}:{state:GameState}){
 const board=state.boards[0];
 if(!board)return null;
 return <svg className="play-board-layer" viewBox={`0 0 ${board.width} ${board.height}`} preserveAspectRatio="xMidYMid meet">
  <defs><pattern id={`play-grid-${board.id}`} width={board.gridSize} height={board.gridSize} patternUnits="userSpaceOnUse"><path d={`M ${board.gridSize} 0 L 0 0 0 ${board.gridSize}`} fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1"/></pattern></defs>
  <rect width={board.width} height={board.height} fill={board.backgroundColor}/>
  {board.gridEnabled&&<rect width={board.width} height={board.height} fill={`url(#play-grid-${board.id})`}/>} 
  {state.boardLines.filter(l=>l.boardId===board.id).map(l=><line key={l.id} x1={l.start.x} y1={l.start.y} x2={l.end.x} y2={l.end.y} stroke="#26372e" strokeWidth={l.strokeWidth} strokeDasharray={l.lineStyle==='dashed'?'8 6':undefined}/>)}
  {state.boardShapes.filter(s=>s.boardId===board.id).map(s=><g key={s.id}>{s.shapeType==='circle'?<ellipse cx={s.position.x+s.width/2} cy={s.position.y+s.height/2} rx={s.width/2} ry={s.height/2} fill={s.fillColor} stroke={s.strokeColor}/>:<rect x={s.position.x} y={s.position.y} width={s.width} height={s.height} rx={s.shapeType==='roundedRectangle'?12:0} fill={s.fillColor} stroke={s.strokeColor}/>}<text x={s.position.x+s.width/2} y={s.position.y+s.height/2+5} textAnchor="middle">{s.label}</text>{s.note&&<title>{s.note}</title>}</g>)}
 </svg>
}
