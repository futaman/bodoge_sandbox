import type { GameState } from '../types/game';
export const initialState: GameState = { players: [], cards: [], decks: [], dice: [], tokens: [], pawns: [], tableObjects: [], boards: [], boardShapes: [], boardLines: [], editorMode: 'play', pawnLocations: {}, cardLocations: {}, nextZ: 1 };
