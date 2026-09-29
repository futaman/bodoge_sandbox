import type { GameState, Position } from './game';

export type ConnectionStatus='online'|'reconnecting'|'offline';
export type RoomPlayer={playerId:string;playerName:string;color:string;connectionStatus:ConnectionStatus;joinedAt:number;lastSeenAt:number};
export type RoomActionEnvelope={actionId:string;type:string;playerId:string;roomId:string;targetId?:string;payload:unknown;timestamp:number};
export type ActionLogEntry={actionId:string;playerId:string;playerName:string;type:string;targetId?:string;summary:string;timestamp:number};
export type PublicRoomSnapshot={roomId:string;version:number;state:GameState;players:RoomPlayer[];locks:Record<string,string>;actionLog:ActionLogEntry[]};

export type ClientMessage=
 |{type:'ROOM_CREATE';playerName:string;resumeToken?:string}
 |{type:'ROOM_JOIN';roomId:string;playerName:string;resumeToken?:string}
 |{type:'ROOM_LEAVE'}
 |{type:'ACTION';action:RoomActionEnvelope}
 |{type:'DRAG_START';actionId:string;targetId:string}
 |{type:'DRAG_MOVE';actionId:string;targetId:string;position:Position;snap?:boolean}
 |{type:'DRAG_END';actionId:string;targetId:string;position:Position;snap?:boolean};

export type ServerMessage=
 |{type:'ROOM_CREATED';roomId:string;playerId:string;resumeToken:string}
 |{type:'ROOM_JOINED';roomId:string;playerId:string;resumeToken:string}
 |{type:'SNAPSHOT';snapshot:PublicRoomSnapshot}
 |{type:'ACTION_REJECTED';actionId?:string;reason:string}
 |{type:'ERROR';message:string};

export const createActionId=()=>crypto.randomUUID();
