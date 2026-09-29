import { useEffect, useState } from 'react';

const MIN_ZOOM=.2;
const MAX_ZOOM=4;
const ZOOM_STEP=.1;
const REFERENCE_WIDTH=900;
const REFERENCE_HEIGHT=600;
const clampZoom=(value:number)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,Math.round(value*10)/10));

export function BoardZoom(){
 const [zoom,setZoom]=useState(1);
 const [fitZoom,setFitZoom]=useState(1);
 const change=(value:number)=>setZoom(clampZoom(value));

 useEffect(()=>{
  const board=document.querySelector<HTMLElement>('.play .board');
  const wrap=board?.parentElement;
  const svg=board?.querySelector<SVGSVGElement>('.play-board-layer');
  if(!board||!wrap)return;
  const resize=()=>{
   const style=getComputedStyle(wrap);
   const availableWidth=Math.max(1,wrap.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
   const availableHeight=Math.max(1,wrap.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom));
   const logicalWidth=svg?.viewBox.baseVal.width||REFERENCE_WIDTH;
   const logicalHeight=svg?.viewBox.baseVal.height||REFERENCE_HEIGHT;
   const baseScale=Math.min(availableWidth/REFERENCE_WIDTH,availableHeight/REFERENCE_HEIGHT);
   const renderedWidth=logicalWidth*baseScale*zoom;
   const renderedHeight=logicalHeight*baseScale*zoom;
   const nextFit=clampZoom(Math.min(availableWidth/(logicalWidth*baseScale),availableHeight/(logicalHeight*baseScale)));
   board.style.width=`${renderedWidth}px`;
   board.style.height=`${renderedHeight}px`;
   board.style.aspectRatio=`${logicalWidth}/${logicalHeight}`;
   wrap.style.justifyContent=renderedWidth>availableWidth?'flex-start':'center';
   wrap.style.alignItems=renderedHeight>availableHeight?'flex-start':'center';
   setFitZoom(current=>current===nextFit?current:nextFit);
  };
  resize();
  const observer=new ResizeObserver(resize);
  observer.observe(wrap);
  return()=>{observer.disconnect();board.style.removeProperty('width');board.style.removeProperty('height');board.style.removeProperty('aspect-ratio');wrap.style.removeProperty('justify-content');wrap.style.removeProperty('align-items')};
 },[zoom]);

 useEffect(()=>{
  const zoomBoard=(event:WheelEvent)=>{if(!event.ctrlKey)return;event.preventDefault();setZoom(current=>clampZoom(current+(event.deltaY<0?ZOOM_STEP:-ZOOM_STEP)))};
  window.addEventListener('wheel',zoomBoard,{passive:false,capture:true});
  return()=>window.removeEventListener('wheel',zoomBoard,{capture:true});
 },[]);

 useEffect(()=>{
  const wrap=document.querySelector<HTMLElement>('.play .board-wrap');
  if(!wrap)return;
  let space=false;
  let cleanup:undefined|(()=>void);
  const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,button');
  const keyDown=(event:KeyboardEvent)=>{if(event.code==='Space'&&!editable(event.target)){space=true;document.body.dataset.panMode='true';wrap.classList.add('pan-ready');event.preventDefault()}};
  const keyUp=(event:KeyboardEvent)=>{if(event.code==='Space'){space=false;delete document.body.dataset.panMode;wrap.classList.remove('pan-ready')}};
  const start=(event:globalThis.PointerEvent)=>{if(!(event.button===1||(event.button===0&&space)))return;event.preventDefault();event.stopPropagation();const origin={x:event.clientX,y:event.clientY,left:wrap.scrollLeft,top:wrap.scrollTop};wrap.classList.add('panning');const move=(pointer:globalThis.PointerEvent)=>{wrap.scrollLeft=origin.left-(pointer.clientX-origin.x);wrap.scrollTop=origin.top-(pointer.clientY-origin.y)};const end=()=>{wrap.classList.remove('panning');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);cleanup=end};
  window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);wrap.addEventListener('pointerdown',start,true);
  return()=>{window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);wrap.removeEventListener('pointerdown',start,true);cleanup?.();delete document.body.dataset.panMode};
 },[]);

 return <div className="board-zoom" aria-label="盤面の拡大縮小" title="Ctrl＋ホイールでも盤面を拡大・縮小できます"><button onClick={()=>change(zoom-ZOOM_STEP)} disabled={zoom<=MIN_ZOOM} title="縮小">−</button><span className="zoom-value" aria-live="polite">{Math.round(zoom*100)}%</span><button onClick={()=>change(zoom+ZOOM_STEP)} disabled={zoom>=MAX_ZOOM} title="拡大">＋</button><button className="zoom-fit" onClick={()=>change(fitZoom)} disabled={zoom===fitZoom} title="広い盤面全体を表示領域に合わせる">フィット</button></div>;
}
