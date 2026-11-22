/**
 * Root reducer. Each slice handles the actions whose `type` starts with its
 * prefix. To add a slice: write slices/<name>.ts exporting `<Name>Action` and
 * a reducer, then add it to `Action` and `SLICES` below.
 */
import type { GameState } from '../model/types';
import { boardReducer, type BoardAction } from './slices/board';
import { diceReducer, syncBuilds, type DiceAction } from './slices/dice';
import { gameReducer, type GameAction } from './slices/game';
import { piecesReducer, type PiecesAction } from './slices/pieces';
import { playersReducer, type PlayersAction } from './slices/players';

export type Action = BoardAction | PlayersAction | PiecesAction | DiceAction | GameAction;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SliceReducer = (s: GameState, a: any) => GameState;

const SLICES: Record<string, SliceReducer> = {
  board: boardReducer,
  players: playersReducer,
  pieces: piecesReducer,
  robber: piecesReducer,
  dice: diceReducer,
  hands: diceReducer,
  cards: diceReducer,
  game: gameReducer,
};

export function reducer(s: GameState, a: Action): GameState {
  const prefix = a.type.split('/')[0];
  const slice = SLICES[prefix];
  const next = slice ? slice(s, a) ?? s : s;
  // Builds on the board charge their owner's hand (see slices/dice.ts).
  return prefix === 'pieces' && next !== s ? syncBuilds(s, next, a) : next;
}
