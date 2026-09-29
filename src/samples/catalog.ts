import type { Card, Player } from '../types/game';
import fourPlayerPotCards from './four-player-pot-cards.json';

export type SetupSampleData={version:number;players:Player[];cards:Card[]};
export type SetupSample={id:string;name:string;description:string;data:SetupSampleData};

// サンプルを増やす場合は、JSONを同じフォルダへ置き、この配列へ1件追加します。
export const setupSamples:SetupSample[]=[
 {
  id:'four-player-pot-cards',
  name:'4人用・鍋カードサンプル',
  description:'4人のプレイヤーと、赤・青・緑・黒アヒル・黒なべ・ふた・ねぎの全36枚を読み込みます。',
  data:fourPlayerPotCards as SetupSampleData,
 },
];

export const getSetupSample=(sampleId:string)=>setupSamples.find(sample=>sample.id===sampleId);
