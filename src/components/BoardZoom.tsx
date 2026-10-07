import { useEffect, useRef, useState } from 'react';

const MIN_ZOOM=.2;
const MAX_ZOOM=4;
const ZOOM_STEP=.1;
const REFERENCE_WIDTH=900;
const REFERENCE_HEIGHT=600;
const clampZoom=(value:number)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,Math.round(value*100)/100));

export function BoardZoom(){
 const [zoom,setZoom]=useState(1);
 const [fitZoom,setFitZoom]=useState(1);
 const zoomRef=useRef(zoom);
 const change=(value:number)=>{const next=clampZoom(value);zoomRef.current=next;setZoom(next)};

 useEffect(()=>{zoomRef.current=zoom},[zoom]);

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
  let cleanupDesktop:undefined|(()=>void);
  const touchPointers=new Map<number,{x:number;y:number}>();
  let touchPan:undefined|{x:number;y:number;contentX:number;contentY:number;distance:number;zoom:number};
  const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,button');
  const syncPanMode=()=>{if(space||touchPan)document.body.dataset.panMode='true';else delete document.body.dataset.panMode};
  const touchGeometry=()=>{const points=[...touchPointers.values()];const x=(points[0].x+points[1].x)/2,y=(points[0].y+points[1].y)/2;return{x,y,distance:Math.max(1,Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y))}};
  const beginTouchPan=()=>{if(touchPointers.size<2)return;const gesture=touchGeometry(),rect=wrap.getBoundingClientRect();touchPan={...gesture,contentX:wrap.scrollLeft+gesture.x-rect.left,contentY:wrap.scrollTop+gesture.y-rect.top,zoom:zoomRef.current};syncPanMode();wrap.classList.add('panning','touch-panning');window.dispatchEvent(new Event('board-pan-start'))};
  const endTouchPan=()=>{touchPan=undefined;syncPanMode();wrap.classList.remove('panning','touch-panning')};
  const keyDown=(event:KeyboardEvent)=>{if(event.code==='Space'&&!editable(event.target)){space=true;syncPanMode();wrap.classList.add('pan-ready');event.preventDefault()}};
  const keyUp=(event:KeyboardEvent)=>{if(event.code==='Space'){space=false;syncPanMode();wrap.classList.remove('pan-ready')}};
  const start=(event:globalThis.PointerEvent)=>{
   if(event.pointerType==='touch'){
    touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(touchPointers.size===2){event.preventDefault();event.stopPropagation();beginTouchPan()}
    return;
   }
   if(!(event.button===1||(event.button===0&&space)))return;
   event.preventDefault();event.stopPropagation();
   const origin={x:event.clientX,y:event.clientY,left:wrap.scrollLeft,top:wrap.scrollTop};
   wrap.classList.add('panning');
   const move=(pointer:globalThis.PointerEvent)=>{wrap.scrollLeft=origin.left-(pointer.clientX-origin.x);wrap.scrollTop=origin.top-(pointer.clientY-origin.y)};
   const end=()=>{wrap.classList.remove('panning');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end)};
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);cleanupDesktop=end;
  };
  const touchMove=(event:globalThis.PointerEvent)=>{if(event.pointerType!=='touch'||!touchPointers.has(event.pointerId))return;touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(!touchPan||touchPointers.size<2)return;event.preventDefault();const pan=touchPan,gesture=touchGeometry(),rect=wrap.getBoundingClientRect(),nextZoom=clampZoom(pan.zoom*gesture.distance/pan.distance),ratio=nextZoom/pan.zoom;zoomRef.current=nextZoom;setZoom(current=>current===nextZoom?current:nextZoom);requestAnimationFrame(()=>{wrap.scrollLeft=pan.contentX*ratio-(gesture.x-rect.left);wrap.scrollTop=pan.contentY*ratio-(gesture.y-rect.top)})};
  const touchEnd=(event:globalThis.PointerEvent)=>{if(event.pointerType!=='touch')return;touchPointers.delete(event.pointerId);if(touchPointers.size<2)endTouchPan();else beginTouchPan()};
  window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);wrap.addEventListener('pointerdown',start,true);
  window.addEventListener('pointermove',touchMove,{capture:true,passive:false});window.addEventListener('pointerup',touchEnd,true);window.addEventListener('pointercancel',touchEnd,true);
  return()=>{window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);wrap.removeEventListener('pointerdown',start,true);window.removeEventListener('pointermove',touchMove,true);window.removeEventListener('pointerup',touchEnd,true);window.removeEventListener('pointercancel',touchEnd,true);cleanupDesktop?.();touchPointers.clear();endTouchPan();delete document.body.dataset.panMode};
 },[]);

 return <div className="board-zoom" aria-label="盤面の拡大縮小" title="PCはCtrl＋ホイール、スマホは2本指のピンチで拡大・縮小できます"><button onClick={()=>change(zoom-ZOOM_STEP)} disabled={zoom<=MIN_ZOOM} title="縮小">−</button><span className="zoom-value" aria-live="polite">{Math.round(zoom*100)}%</span><button onClick={()=>change(zoom+ZOOM_STEP)} disabled={zoom>=MAX_ZOOM} title="拡大">＋</button><button className="zoom-fit" onClick={()=>change(fitZoom)} disabled={zoom===fitZoom} title="広い盤面全体を表示領域に合わせる">フィット</button></div>;
}
