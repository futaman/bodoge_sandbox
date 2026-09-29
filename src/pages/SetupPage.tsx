import { useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { GameState, Player } from '../types/game';
import type { Action } from '../game/reducer';
import type { SetupSampleData } from '../samples/catalog';
import { getSetupSample, setupSamples } from '../samples/catalog';
import { id } from '../utils/id';

const colors=['#d64b4b','#397bd8','#e3a52b','#4ca66b','#8556b8'];

export function SetupPage({state,dispatch,onStart,online=false,currentPlayerId}:{state:GameState;dispatch:Dispatch<Action>;onStart:()=>void;online?:boolean;currentPlayerId?:string}){
 const [suits,setSuits]=useState(['赤','青']);
 const [values,setValues]=useState(['1','2','3']);
 const [copies,setCopies]=useState(1);
 const [confirmDelete,setConfirmDelete]=useState<string>();
 const [sampleId,setSampleId]=useState(setupSamples[0]?.id??'');
 const fileInput=useRef<HTMLInputElement>(null);
 const selectedSample=getSetupSample(sampleId);
 const cardGroups=Object.values(state.cards.reduce<Record<string,{key:string;suit:string;value:string|number;ids:string[]}>>((groups,card)=>{const key=`${card.suit} / ${card.value}`;(groups[key]??={key,suit:card.suit,value:card.value,ids:[]}).ids.push(card.id);return groups},{}));

 const addPlayer=()=>{const player:Player={id:id('player'),name:`プレイヤー ${state.players.length+1}`,color:colors[state.players.length%colors.length],handEnabled:true,scoreEnabled:true,roleEnabled:false,hand:[],score:0};dispatch({type:'addPlayer',player})};
 const update=(player:Player,changes:Partial<Player>)=>dispatch({type:'updatePlayer',id:player.id,changes});
 const applySetup=(data:SetupSampleData)=>{
  dispatch({type:'importSetup',players:online?state.players:data.players,cards:data.cards});
  setSuits([...new Set(data.cards.map(card=>card.suit))]);
  setValues([...new Set(data.cards.map(card=>String(card.value)))]);
 };
 const loadSample=()=>{
  if(!selectedSample)return;
  const hasCurrentSetup=state.players.length>0||state.cards.length>0;
  if(hasCurrentSetup&&!window.confirm('現在のプレイヤーとカード設定を、選択したサンプルで置き換えます。よろしいですか？'))return;
  applySetup(structuredClone(selectedSample.data));
 };
 const exportSetup=()=>{const content=JSON.stringify({version:1,players:state.players,cards:state.cards},null,2);const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='boardgame-setup.json';link.click();URL.revokeObjectURL(url)};
 const importSetup=async(file:File)=>{try{const data=JSON.parse(await file.text());if(!Array.isArray(data.players)||!Array.isArray(data.cards))throw new Error('形式が正しくありません');applySetup(data as SetupSampleData)}catch{alert('読み込めませんでした。設定JSONファイルを選択してください。')}};
 const field=(items:string[],set:(next:string[])=>void,label:string)=><label>{label}<div className="chips">{items.map((item,index)=><input key={index} value={item} onChange={event=>set(items.map((value,itemIndex)=>itemIndex===index?event.target.value:value))}/>)}<button type="button" onClick={()=>set([...items,''])}>＋</button></div></label>;

 return <main className="setup">
  <div className="intro">
   <p className="eyebrow">BOARD GAME PLAYTEST</p>
   <h1>ゲームを組み立てる</h1>
   <p>ルールを縛らず、カードやコマを自由に置いて試遊できるワークスペースです。</p>
   <div className="setup-io"><button className="secondary" onClick={exportSetup}>設定を出力</button><button className="secondary" onClick={()=>fileInput.current?.click()}>設定を読み込む</button><input ref={fileInput} className="file-input" type="file" accept="application/json,.json" onChange={event=>{const file=event.target.files?.[0];if(file)importSetup(file);event.currentTarget.value=''}}/></div>
  </div>

  <section className="sample-loader" aria-labelledby="sample-loader-title">
   <div><p className="eyebrow">SAMPLE ENVIRONMENT</p><h2 id="sample-loader-title">サンプル環境から始める</h2><p>{selectedSample?.description??'利用できるサンプルはありません。'}</p></div>
   <div className="sample-loader-controls"><label>サンプル<select value={sampleId} onChange={event=>setSampleId(event.target.value)}>{setupSamples.map(sample=><option key={sample.id} value={sample.id}>{sample.name}</option>)}</select></label><button className="primary" disabled={!selectedSample} onClick={loadSample}>このサンプルを読み込む</button></div>
  </section>

  <section className="setup-grid">
   <article><h2>プレイヤー</h2>{online&&<p className="muted">参加者はルームへ接続すると自動で追加されます。自分の設定だけ変更できます。</p>}{state.players.map(player=>{const editable=!online||player.id===currentPlayerId;return <div className="player-edit" key={player.id}><input disabled={!editable} type="color" value={player.color} onChange={event=>update(player,{color:event.target.value})}/><input disabled={!editable} value={player.name} onChange={event=>update(player,{name:event.target.value})}/>{!online&&<button onClick={()=>dispatch({type:'deletePlayer',id:player.id})}>削除</button>}<div className="toggles">{(['handEnabled','scoreEnabled','roleEnabled'] as const).map(key=><label key={key}><input disabled={!editable} type="checkbox" checked={player[key]} onChange={event=>update(player,{[key]:event.target.checked})}/>{key==='handEnabled'?'手札':key==='scoreEnabled'?'得点':'役職'}</label>)}</div></div>})}{!online&&<button className="secondary" onClick={addPlayer}>＋ プレイヤー追加</button>}</article>
   <article><h2>カードセット作成</h2>{field(suits,setSuits,'Suit')}{field(values,setValues,'Value')}<label>各カードの枚数<input type="number" min="1" value={copies} onChange={event=>setCopies(Math.max(1,Number(event.target.value)))}/></label><button className="primary" onClick={()=>dispatch({type:'createCards',suits,values,copies})}>カードを生成</button><p className="muted">現在 {state.cards.length} 枚のカード</p></article>
   <article><h2>山札</h2><p>生成済みのカードをひとつの山札にまとめて、試遊中にシャッフル・ドローできます。</p><button className="secondary" disabled={!state.cards.length} onClick={()=>dispatch({type:'createDeck',name:`山札 ${state.decks.length+1}`,cardIds:state.cards.filter(card=>state.cardLocations[card.id]?.type==='unplaced').map(card=>card.id),position:{x:80,y:100}})}>未配置カードで山札を作成</button><p className="muted">{state.decks.length} 個の山札</p></article>
  </section>

  <section className="card-summary"><h2>現在のカード一覧</h2>{cardGroups.length===0?<p className="muted">まだカードはありません。</p>:<div className="summary-list">{cardGroups.map(group=><div className="summary-row" key={group.key}><span className={`suit-dot suit-${group.suit}`}/><span>{group.suit} / {group.value}</span><strong>× {group.ids.length}</strong><button className="danger" onClick={()=>confirmDelete===group.key?(dispatch({type:'deleteCards',ids:group.ids}),setConfirmDelete(undefined)):setConfirmDelete(group.key)}>{confirmDelete===group.key?'削除を確定':'削除'}</button></div>)}</div>}</section>
  <button className="start" onClick={onStart}>試遊を開始 →</button>
 </main>;
}
