const colorNames=[
 {key:'red',names:['赤','red']},
 {key:'yellow',names:['黄','yellow']},
 {key:'black',names:['黒','black']},
 {key:'white',names:['白','white']},
 {key:'green',names:['緑','green']},
 {key:'purple',names:['紫','purple']},
 {key:'blue',names:['青','blue']},
] as const;

export const cardColorClass=(name:string)=>{
 const normalized=name.toLocaleLowerCase();
 const match=colorNames.find(color=>color.names.some(candidate=>normalized.includes(candidate)));
 return match?`card-color-${match.key}`:'';
};
