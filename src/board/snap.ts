import type { BoardShape, Point } from '../types/game';
export const snapToGrid=(point:Point,size:number)=>({x:Math.round(point.x/size)*size,y:Math.round(point.y/size)*size});
export const snapToShapes=(point:Point,shapes:BoardShape[],skipId?:string,threshold=8)=>{let next={...point};for(const s of shapes){if(s.id===skipId)continue;for(const x of [s.position.x,s.position.x+s.width/2,s.position.x+s.width])if(Math.abs(point.x-x)<threshold)next.x=x;for(const y of [s.position.y,s.position.y+s.height/2,s.position.y+s.height])if(Math.abs(point.y-y)<threshold)next.y=y}return next};
export const nearestShapeAnchor=(point:Point,shapes:BoardShape[],threshold=18)=>{
 let nearest:Point|undefined;
 let best=threshold;
 for(const shape of shapes){
  const left=shape.position.x,top=shape.position.y,right=left+shape.width,bottom=top+shape.height,cx=left+shape.width/2,cy=top+shape.height/2;
  const anchors=[{x:left,y:top},{x:cx,y:top},{x:right,y:top},{x:right,y:cy},{x:right,y:bottom},{x:cx,y:bottom},{x:left,y:bottom},{x:left,y:cy},{x:cx,y:cy}];
  for(const anchor of anchors){const distance=Math.hypot(point.x-anchor.x,point.y-anchor.y);if(distance<best){best=distance;nearest=anchor}}
 }
 return nearest;
};
export const snapToShapeAnchors=(point:Point,shapes:BoardShape[],threshold=18)=>nearestShapeAnchor(point,shapes,threshold)??point;
export const nearestSpace=(point:Point,shapes:BoardShape[],distance=44)=>{const spaces=shapes.filter(s=>s.isSpace);let match:BoardShape|undefined;let best=distance;for(const s of spaces){const center={x:s.position.x+s.width/2,y:s.position.y+s.height/2};const d=Math.hypot(point.x-center.x,point.y-center.y);if(d<best){best=d;match=s}}return match};
