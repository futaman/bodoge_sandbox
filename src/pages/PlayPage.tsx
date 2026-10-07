import { useEffect, useState } from 'react';
import type { Dispatch, PointerEvent } from 'react';
import type { GameState, Player, TableObject } from '../types/game';
import type { Action } from '../game/reducer';
import { BoardLayer } from '../components/BoardLayer';
import { GameObjectLayer, OBJECT_SIZES } from '../components/GameObjectLayer';
import { Modal } from '../components/Modal';
import { cardColorClass } from '../utils/cardColor';

const CARD_SIZE={width:84,height:116};
const DECK_SIZE={width:92,height:118};

function clientToBoard(svg:SVGSVGElement,clientX:number,clientY:number){
 const matrix=svg.getScreenCTM();
 if(!matrix)return{x:clientX,y:clientY};
 const point=new DOMPoint(clientX,clientY).matrixTransform(matrix.inverse());
 return{x:point.x,y:point.y};
}

function deckUnderCard(state:GameState,position:{x:number;y:number}){
 let match:TableObject|undefined;
 let bestCoverage=.9;
 for(const deck of state.tableObjects.filter(object=>object.type==='deck')){
  const overlapWidth=Math.max(0,Math.min(position.x+CARD_SIZE.width,deck.position.x+DECK_SIZE.width)-Math.max(position.x,deck.position.x));
  const overlapHeight=Math.max(0,Math.min(position.y+CARD_SIZE.height,deck.position.y+DECK_SIZE.height)-Math.max(position.y,deck.position.y));
  const coverage=overlapWidth*overlapHeight/(CARD_SIZE.width*CARD_SIZE.height);
  if(coverage>=bestCoverage){bestCoverage=coverage;match=deck}
 }
 return match;
}

function handPlayerAt(clientX:number,clientY:number){
 for(const hand of document.querySelectorAll<HTMLElement>('[data-hand-player-id]')){const rect=hand.getBoundingClientRect();if(clientX>=rect.left&&clientX<=rect.right&&clientY>=rect.top&&clientY<=rect.bottom)return hand.dataset.handPlayerId}
}

export function PlayPage({state,dispatch,onSetup,viewerId}:{state:GameState;dispatch:Dispatch<Action>;onSetup:()=>void;viewerId?:string}){
 const [selectedIds,setSelectedIds]=useState<string[]>([]); const [selectionRect,setSelectionRect]=useState<{x:number;y:number;width:number;height:number}>(); const [add,setAdd]=useState(false); const [dialog,setDialog]=useState<''|'card'|'token'|'pawn'|'deck'>(''); const [hidden,setHidden]=useState<Record<string,boolean>>({}); const [rolling,setRolling]=useState<string>(); const [shuffling,setShuffling]=useState<string>(); const [ghost,setGhost]=useState<{x:number;y:number;back:boolean;count:number}|null>(null); const [selections,setSelections]=useState<Record<string,string[]>>({}); const [dropTargetDeckId,setDropTargetDeckId]=useState<string>(); const [dropTargetHandId,setDropTargetHandId]=useState<string>(); const [localActivePlayerId,setLocalActivePlayerId]=useState(state.activePlayerId??state.players[0]?.id); const [playersCollapsed,setPlayersCollapsed]=useState(false); const [mobileToolsOpen,setMobileToolsOpen]=useState(false); const [multiSelectMode,setMultiSelectMode]=useState(false); const [handFaceDown,setHandFaceDown]=useState(false); const [snapDrag,setSnapDrag]=useState(false); const [randomDeckPlacement,setRandomDeckPlacement]=useState(false);
 const get=(o:TableObject):any=>o.type==='card'?state.cards.find(x=>x.id===o.refId):o.type==='deck'?state.decks.find(x=>x.id===o.refId):o.type==='die'?state.dice.find(x=>x.id===o.refId):o.type==='token'?state.tokens.find(x=>x.id===o.refId):state.pawns.find(x=>x.id===o.refId);
 const drag=(o:TableObject,e:PointerEvent<HTMLDivElement>)=>{
  e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);
  const svg=e.currentTarget.closest('svg.game-object-layer') as SVGSVGElement|null;if(!svg)return;
  const moving=selectedIds.includes(o.id)&&selectedIds.length>1?state.tableObjects.filter(x=>selectedIds.includes(x.id)):[o];
  const origins=moving.map(x=>({id:x.id,p:{...x.position}}));const draggedOrigin=origins.find(origin=>origin.id===o.id)!;const start=clientToBoard(svg,e.clientX,e.clientY);
  const positionAt=(pointer:globalThis.PointerEvent)=>{const current=clientToBoard(svg,pointer.clientX,pointer.clientY);return{x:draggedOrigin.p.x+current.x-start.x,y:draggedOrigin.p.y+current.y-start.y}};
  const cleanup=()=>{setDropTargetDeckId(undefined);setDropTargetHandId(undefined);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('board-pan-start',cancel)};
  const move=(pointer:globalThis.PointerEvent)=>{if(document.body.dataset.panMode==='true'){cancel();return}const current=clientToBoard(svg,pointer.clientX,pointer.clientY);origins.forEach(origin=>dispatch({type:'moveObject',id:origin.id,position:{x:origin.p.x+current.x-start.x,y:origin.p.y+current.y-start.y},snap:pointer.shiftKey||snapDrag}));setDropTargetDeckId(o.type==='card'?deckUnderCard(state,positionAt(pointer))?.refId:undefined);setDropTargetHandId(o.type==='card'?handPlayerAt(pointer.clientX,pointer.clientY):undefined)};
  const end=(pointer:globalThis.PointerEvent)=>{if(document.body.dataset.panMode==='true'){cleanup();return}if(o.type==='card'&&Math.hypot(pointer.clientX-e.clientX,pointer.clientY-e.clientY)>4){const cards=moving.filter(object=>object.type==='card');const handPlayerId=handPlayerAt(pointer.clientX,pointer.clientY);const target=deckUnderCard(state,positionAt(pointer));if(handPlayerId)cards.forEach(card=>dispatch({type:'moveCardToHand',cardId:card.refId,playerId:handPlayerId}));else if(target)cards.forEach(card=>dispatch({type:'returnToDeck',cardId:card.refId,deckId:target.refId,placement:pointer.ctrlKey||randomDeckPlacement?'random':'top'}));if(handPlayerId||target)setSelectedIds(current=>current.filter(id=>!moving.some(object=>object.id===id)))}cleanup()};
  const cancel=()=>cleanup();window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('board-pan-start',cancel);
 };
 const dragHand=(id:string,e:PointerEvent<HTMLButtonElement>)=>{
  if(e.button!==0&&e.button!==2)return;e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);
  const owner=state.players.find(p=>p.hand.includes(id));const picked=owner&&selections[owner.id]?.includes(id)?selections[owner.id]:[id];const start={x:e.clientX,y:e.clientY},back=e.button===2||handFaceDown;
  const boardPosition=(pointer:globalThis.PointerEvent)=>{const boardElement=document.querySelector<HTMLElement>('.play .board');if(!boardElement)return;const rect=boardElement.getBoundingClientRect();if(pointer.clientX<rect.left||pointer.clientX>rect.right||pointer.clientY<rect.top||pointer.clientY>rect.bottom)return;const svg=boardElement.querySelector<SVGSVGElement>('.game-object-layer');if(!svg)return;const point=clientToBoard(svg,pointer.clientX,pointer.clientY);return{x:point.x-CARD_SIZE.width/2,y:point.y-CARD_SIZE.height/2}};
  const cleanup=()=>{setGhost(null);setDropTargetDeckId(undefined);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('board-pan-start',cancel)};
  const move=(pointer:globalThis.PointerEvent)=>{if(document.body.dataset.panMode==='true'){cancel();return}setGhost({x:pointer.clientX,y:pointer.clientY,back,count:picked.length});const position=boardPosition(pointer);setDropTargetDeckId(position?deckUnderCard(state,position)?.refId:undefined)};
  const end=(pointer:globalThis.PointerEvent)=>{if(document.body.dataset.panMode==='true'){cleanup();return}const base=boardPosition(pointer);if(base&&Math.hypot(pointer.clientX-start.x,pointer.clientY-start.y)>8){const target=deckUnderCard(state,base);if(target)picked.forEach(cardId=>dispatch({type:'returnToDeck',cardId,deckId:target.refId,placement:pointer.ctrlKey||randomDeckPlacement?'random':'top'}));else picked.forEach((cardId,index)=>dispatch({type:'moveCardToTable',cardId,position:{x:base.x+(index%5)*18,y:base.y+Math.floor(index/5)*24},faceDown:back,snap:pointer.shiftKey||snapDrag}));if(owner)setSelections(current=>({...current,[owner.id]:[]}))}cleanup()};
  const cancel=()=>cleanup();window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('board-pan-start',cancel);
 };
 const roll=(id:string)=>{if(rolling)return;setRolling(id);setTimeout(()=>{dispatch({type:'rollDie',id});setRolling(undefined)},500)};
 const shuffleDeck=(id:string)=>{if(shuffling)return;setShuffling(id);setTimeout(()=>{dispatch({type:'shuffleDeck',id});setShuffling(undefined)},200)};
 const choose=(id:string,additive:boolean)=>{const addToSelection=additive||multiSelectMode;setSelectedIds(current=>addToSelection?(current.includes(id)?current.filter(x=>x!==id):[...current,id]):[id])};
 const startRangeSelection=(event:PointerEvent<HTMLDivElement>)=>{
  if(event.button!==0||document.body.dataset.panMode==='true')return;
  const svg=event.currentTarget.querySelector<SVGSVGElement>('.game-object-layer');if(!svg)return;
  event.preventDefault();const start=clientToBoard(svg,event.clientX,event.clientY);const startClient={x:event.clientX,y:event.clientY};const additive=event.shiftKey||multiSelectMode;
  const cleanup=()=>{setSelectionRect(undefined);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('board-pan-start',cancel)};
  const rectangle=(clientX:number,clientY:number)=>{const point=clientToBoard(svg,clientX,clientY);return{x:Math.min(start.x,point.x),y:Math.min(start.y,point.y),width:Math.abs(point.x-start.x),height:Math.abs(point.y-start.y)}};
  const move=(pointer:globalThis.PointerEvent)=>{if(document.body.dataset.panMode==='true'){cancel();return}if(Math.hypot(pointer.clientX-startClient.x,pointer.clientY-startClient.y)>4)setSelectionRect(rectangle(pointer.clientX,pointer.clientY))};
  const end=(pointer:globalThis.PointerEvent)=>{const moved=Math.hypot(pointer.clientX-startClient.x,pointer.clientY-startClient.y)>4;if(!moved){if(!additive)setSelectedIds([]);cleanup();return}const area=rectangle(pointer.clientX,pointer.clientY);const hits=state.tableObjects.filter(object=>{const size=OBJECT_SIZES[object.type];return object.position.x<area.x+area.width&&object.position.x+size.w>area.x&&object.position.y<area.y+area.height&&object.position.y+size.h>area.y}).map(object=>object.id);setSelectedIds(current=>additive?[...new Set([...current,...hits])]:hits);cleanup()};
  const cancel=()=>cleanup();window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('board-pan-start',cancel);
 };
 useEffect(()=>{const key=(event:KeyboardEvent)=>{const target=event.target as HTMLElement|null;if(target?.closest('input,textarea,select,[contenteditable=true]'))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();setSelectedIds(state.tableObjects.map(object=>object.id));return}if(event.key==='Escape'){setSelectedIds([]);return}if(!selectedIds.length||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?10:1;const offset={ArrowLeft:{x:-step,y:0},ArrowRight:{x:step,y:0},ArrowUp:{x:0,y:-step},ArrowDown:{x:0,y:step}}[event.key]!;state.tableObjects.filter(object=>selectedIds.includes(object.id)).forEach(object=>dispatch({type:'moveObject',id:object.id,position:{x:object.position.x+offset.x,y:object.position.y+offset.y}}))};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[dispatch,selectedIds,state.tableObjects]);
 const chosen=state.tableObjects.find(o=>o.id===selectedIds[selectedIds.length-1]);const selectedCardIds=state.tableObjects.filter(o=>selectedIds.includes(o.id)&&o.type==='card').map(o=>o.refId);
 return <main className={`play ${playersCollapsed?'players-collapsed':''}`}>
  <button className="mobile-panel-toggle players-toggle" onClick={()=>setPlayersCollapsed(value=>!value)}>{playersCollapsed?'プレイヤーを表示':'プレイヤーを隠す'}</button>
  <button className="mobile-touch-toggle" aria-expanded={mobileToolsOpen} onClick={()=>setMobileToolsOpen(value=>!value)}>タッチ操作 {mobileToolsOpen?'▲':'▼'}</button>
  {mobileToolsOpen&&<aside className="mobile-touch-tools" aria-label="スマホ操作設定"><strong>空白ドラッグ：範囲選択／2本指：移動・拡縮</strong><button className={multiSelectMode?'active':''} aria-pressed={multiSelectMode} onClick={()=>setMultiSelectMode(value=>!value)}>複数選択 {multiSelectMode?'ON':'OFF'}</button><button onClick={()=>setSelectedIds(state.tableObjects.map(object=>object.id))}>全選択</button><button disabled={!selectedIds.length} onClick={()=>setSelectedIds([])}>選択解除</button><button className={handFaceDown?'active':''} aria-pressed={handFaceDown} onClick={()=>setHandFaceDown(value=>!value)}>手札から {handFaceDown?'裏向き':'表向き'}</button><button className={snapDrag?'active':''} aria-pressed={snapDrag} onClick={()=>setSnapDrag(value=>!value)}>位置吸着 {snapDrag?'ON':'OFF'}</button><button className={randomDeckPlacement?'active':''} aria-pressed={randomDeckPlacement} onClick={()=>setRandomDeckPlacement(value=>!value)}>山札へ {randomDeckPlacement?'ランダム':'一番上'}</button></aside>}
  <aside className="players"><div className="bar"><b>プレイヤー</b><button onClick={onSetup}>設定</button></div>{state.players.map(p=><section key={p.id} className={`player ${p.id===(viewerId??localActivePlayerId)?'active':''}`} onClick={()=>{setLocalActivePlayerId(p.id);if(!viewerId)dispatch({type:'selectPlayer',id:p.id})}}><i style={{background:p.color}}/><strong>{p.name}</strong>{p.scoreEnabled&&<span className="score"><button onClick={()=>dispatch({type:'changeScore',id:p.id,amount:-1})}>−</button>{p.score}<button onClick={()=>dispatch({type:'changeScore',id:p.id,amount:1})}>＋</button></span>}</section>)}</aside>
  <section className="board-wrap"><div className="board" onPointerDown={startRangeSelection}><BoardLayer state={state}/><GameObjectLayer state={state} selectedIds={selectedIds} selectionRect={selectionRect} rolling={rolling} shuffling={shuffling} dropTargetDeckId={dropTargetDeckId} viewerId={viewerId} dispatch={dispatch} onSelect={choose} onDrag={drag} onRoll={roll}/></div>{selectedIds.length>1&&<output className="selection-count">{selectedIds.length}個を選択中</output>}{chosen&&<Menu o={chosen} item={get(chosen)} selectedCardIds={selectedCardIds} state={state} dispatch={dispatch} roll={roll} shuffleDeck={shuffleDeck}/>}</section>
  <button className="fab" onClick={()=>setAdd(!add)}>＋</button>{add&&<div className="add-menu">{(['card','deck','die','token','pawn'] as const).map(k=><button key={k} onClick={()=>{setAdd(false);k==='die'?dispatch({type:'addDie',position:{x:300,y:160}}):setDialog(k)}}>{k}</button>)}</div>}
  <section className="hands">{state.players.filter(p=>p.handEnabled).map(p=><Hand key={p.id} player={p} state={state} dispatch={dispatch} hidden={!!hidden[p.id]} toggle={()=>setHidden({...hidden,[p.id]:!hidden[p.id]})} selected={selections[p.id]??[]} allSelections={selections} setSelected={ids=>setSelections({...selections,[p.id]:ids})} drag={dragHand} viewerId={viewerId} dropTarget={dropTargetHandId===p.id}/>)}</section>
  {ghost&&<div className={`drag-ghost ${ghost.back?'face-down':''}`} style={{left:ghost.x,top:ghost.y}}>{ghost.back?'◆':`${ghost.count}枚を置く`}</div>}{dialog&&<Add kind={dialog} state={state} dispatch={dispatch} close={()=>setDialog('')}/>}
 </main>;
}
function Hand({player,state,dispatch,hidden,toggle,selected,allSelections,setSelected,drag,viewerId,dropTarget}:{player:Player;state:GameState;dispatch:Dispatch<Action>;hidden:boolean;toggle:()=>void;selected:string[];allSelections:Record<string,string[]>;setSelected:(ids:string[])=>void;drag:(id:string,e:PointerEvent<HTMLButtonElement>)=>void;viewerId?:string;dropTarget:boolean}){
 const [target,setTarget]=useState(state.players.find(candidate=>candidate.id!==player.id)?.id??'');
 const [deck,setDeck]=useState(state.decks[0]?.id??'');
 const pick=(id:string)=>setSelected(selected.includes(id)?selected.filter(cardId=>cardId!==id):[...selected,id]);
 const interactive=!viewerId||viewerId===player.id;const revealed=new Set(player.revealedHandCardIds??[]);const publish=(cardIds:string[])=>{const cards=cardIds.map(id=>state.cards.find(card=>card.id===id)).filter(Boolean);if(!cards.length)return;const description=cards.map(card=>`${card!.suit} ${card!.value}`).join('、');if(window.confirm(`次の${cards.length}枚を全員へ公開します。\n${description}\n\n本当に公開しますか？`))dispatch({type:'setHandCardsRevealed',playerId:player.id,cardIds,revealed:true})};
 return <div className={`hand ${dropTarget?'hand-drop-target':''}`} data-hand-player-id={player.id}>{dropTarget&&<div className="hand-drop-message">ここに離して手札へ戻す</div>}<header><span>{player.name} の手札（{player.hand.length}）</span><span className="hand-header-actions"><button onClick={toggle}>{hidden?'見る':'隠す'}</button>{viewerId===player.id&&player.hand.some(id=>!revealed.has(id))&&<button className="reveal-action" onClick={()=>publish(player.hand)}>全て公開…</button>}{viewerId===player.id&&revealed.size>0&&<button onClick={()=>dispatch({type:'setHandCardsRevealed',playerId:player.id,cardIds:[...revealed],revealed:false})}>全て非公開</button>}</span></header>{!hidden&&<><div className="hand-card-list">{player.hand.map((id,index)=>{const card=state.cards.find(candidate=>candidate.id===id);if(!card)return <span className="hand-card face-down hand-card-placeholder" key={`${id}-${index}`} aria-label="非公開カード"><span className="card-back">◆</span></span>;if(!interactive)return <span className={`hand-card public-hand-card ${cardColorClass(card.suit)}`} key={id}>{card.suit}<b>{card.value}</b><small>公開中</small></span>;return <span className="hand-select" key={id}><input type="checkbox" checked={selected.includes(id)} onChange={()=>pick(id)}/><button className={`hand-card ${cardColorClass(card.suit)} ${selected.includes(id)?'selected':''} ${revealed.has(id)?'is-public':''}`} onContextMenu={event=>event.preventDefault()} onPointerDown={event=>drag(id,event)} onClick={event=>{if(event.shiftKey){event.preventDefault();pick(id)}}}>{card.suit}<b>{card.value}</b>{revealed.has(id)&&<small>公開中</small>}<span className="hand-hint">Shift＋クリックで複数選択<br/>ドラッグで表／右ドラッグで裏<br/>山札に重ねて戻す</span></button></span>})}</div>{selected.length>0&&<div className="hand-actions"><button className="reveal-action" onClick={()=>publish(selected)}>選択分を公開…</button>{selected.some(id=>revealed.has(id))&&<button onClick={()=>dispatch({type:'setHandCardsRevealed',playerId:player.id,cardIds:selected,revealed:false})}>選択分を非公開</button>}<select value={target} onChange={event=>setTarget(event.target.value)}>{state.players.filter(candidate=>candidate.id!==player.id).map(candidate=><option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select><button onClick={()=>{selected.forEach(cardId=>dispatch({type:'moveCardToHand',cardId,playerId:target}));setSelected([])}}>選択分を渡す</button><button disabled={!allSelections[target]?.length} onClick={()=>{dispatch({type:'exchangeCards',firstPlayerId:player.id,firstCardIds:selected,secondPlayerId:target,secondCardIds:allSelections[target]??[]});setSelected([])}}>選択分を交換</button><select value={deck} onChange={event=>setDeck(event.target.value)}>{state.decks.map(candidate=><option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select><button disabled={!deck} onClick={()=>{selected.forEach(cardId=>dispatch({type:'returnToDeck',cardId,deckId:deck}));setSelected([])}}>選択分を山札へ</button></div>}</>}</div>;
}
function Menu({o,item,selectedCardIds,state,dispatch,roll,shuffleDeck}:{o:TableObject;item:any;selectedCardIds:string[];state:GameState;dispatch:Dispatch<Action>;roll:(id:string)=>void;shuffleDeck:(id:string)=>void}){
 const [count,setCount]=useState('1'),[player,setPlayer]=useState(state.activePlayerId??''),[deck,setDeck]=useState(state.decks[0]?.id??'');
 const dealCount=Number(count),invalidCount=count===''||!Number.isInteger(dealCount)||dealCount<1;
 const cards=selectedCardIds.length?selectedCardIds:[item?.id].filter(Boolean);
 return <div className="object-menu" role="toolbar" aria-label="選択中のオブジェクトの操作">
  <strong className="action-menu-title">{o.type==='deck'?'山札の操作':o.type==='card'?`カード ${cards.length}枚を操作`:o.type==='die'?'ダイスの操作':'チップの操作'}</strong>
  {o.type==='deck'&&<>
   <div className="action-group"><button className="action-primary" onClick={()=>shuffleDeck(item.id)}>↻ シャッフル</button><button onClick={()=>dispatch({type:'drawCard',deckId:item.id})}>＋ 1枚引く</button><button onClick={()=>dispatch({type:'drawCardToTable',deckId:item.id})}>▣ 場に出す</button></div>
   <div className="action-group"><label className="action-field"><span>配る枚数</span><input aria-label="配る枚数" type="number" inputMode="numeric" min="1" value={count} onChange={e=>setCount(e.target.value)}/></label><button disabled={invalidCount} onClick={()=>dispatch({type:'dealCards',deckId:item.id,count:dealCount})}>自分へ配る</button><button disabled={invalidCount} onClick={()=>dispatch({type:'dealEvenly',deckId:item.id,count:dealCount})}>全員へ配る</button></div>
  </>}
  {o.type==='die'&&<div className="action-group"><button className="action-primary" onClick={()=>roll(item.id)}>⚄ ダイスを振る</button></div>}
  {o.type==='token'&&<div className="action-group"><button onClick={()=>dispatch({type:'updateToken',id:item.id,changes:{value:item.value-1}})}>− 1</button><button className="action-primary" onClick={()=>dispatch({type:'updateToken',id:item.id,changes:{value:item.value+1}})}>＋ 1</button></div>}
  {o.type==='card'&&<>
   <div className="action-group"><button className="action-primary" onClick={()=>state.tableObjects.filter(x=>x.type==='card'&&cards.includes(x.refId)).forEach(x=>dispatch({type:'flipTableCard',objectId:x.id}))}>↔ 選択分を反転</button></div>
   <div className="action-group"><label className="action-field"><span>戻す手札</span><select aria-label="戻す手札" value={player} onChange={e=>setPlayer(e.target.value)}>{state.players.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><button onClick={()=>cards.forEach(cardId=>dispatch({type:'moveCardToHand',cardId,playerId:player}))}>手札へ戻す</button></div>
   <div className="action-group"><label className="action-field"><span>戻す山札</span><select aria-label="戻す山札" value={deck} onChange={e=>setDeck(e.target.value)}>{state.decks.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label><button onClick={()=>cards.forEach(cardId=>dispatch({type:'returnToDeck',cardId,deckId:deck}))}>山札へ戻す</button></div>
  </>}
 </div>
}
function Add({kind,state,dispatch,close}:{kind:'card'|'token'|'pawn'|'deck';state:GameState;dispatch:Dispatch<Action>;close:()=>void}){
 const isPlayerPiece=kind==='token'||kind==='pawn';
 const initialPlayer=state.players.find(player=>player.id===state.activePlayerId)??state.players[0];
 const [a,setA]=useState(kind==='card'?'joker':isPlayerPiece?(initialPlayer?.color??'#e3a52b'):'山札');
 const [b,setB]=useState('1');
 const [ownerId,setOwnerId]=useState(initialPlayer?.id??'');
 const selectPlayerColor=(player:Player)=>{setA(player.color);setOwnerId(player.id)};
 const addPiece=(color:string,position:{x:number;y:number},playerId?:string)=>{
  if(kind==='token')dispatch({type:'addToken',color,value:+b||0,position});
  if(kind==='pawn')dispatch({type:'addPawn',color,ownerPlayerId:playerId,position});
 };
 const addForEveryPlayer=()=>{state.players.forEach((player,index)=>addPiece(player.color,{x:220+(index%8)*82,y:170+Math.floor(index/8)*88},player.id));close()};
 const addOne=()=>{if(kind==='card')dispatch({type:'addCards',suit:a,value:b,copies:1,position:{x:260,y:180}});if(isPlayerPiece)addPiece(a,{x:280,y:190},ownerId||undefined);if(kind==='deck')dispatch({type:'createDeck',name:a,cardIds:state.cards.filter(c=>state.cardLocations[c.id]?.type==='unplaced').map(c=>c.id),position:{x:100,y:150}});close()};
 return <Modal title={`${kind==='token'?'チップ':kind==='pawn'?'コマ':kind==='card'?'カード':'山札'}を追加`} onClose={close}>
  {isPlayerPiece?<>
   <p className="piece-color-label">プレイヤーカラーから選択</p>
   <div className="player-color-list">{state.players.map(player=><button key={player.id} type="button" className={ownerId===player.id?'selected':''} onClick={()=>selectPlayerColor(player)}><i style={{background:player.color}}/>{player.name}</button>)}</div>
   <label className="piece-color-custom">色を調整<input type="color" value={a} onChange={e=>{setA(e.target.value);setOwnerId('')}}/></label>
   {kind==='token'&&<label>数値<input type="number" value={b} onChange={e=>setB(e.target.value)}/></label>}
   <div className="piece-add-actions"><button className="primary" onClick={addOne}>選択した色で1個追加</button><button className="secondary" disabled={!state.players.length} onClick={addForEveryPlayer}>人数分を追加（{state.players.length}個）</button></div>
  </>:<><label>{kind==='card'?'スート':'山札名'}<input value={a} onChange={e=>setA(e.target.value)}/></label>{kind==='card'&&<label>値<input value={b} onChange={e=>setB(e.target.value)}/></label>}<button className="primary" onClick={addOne}>追加</button></>}
 </Modal>
}
