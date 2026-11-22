/** Whole-game actions: phase changes, new game, import. */
import { emptyHand, type GameState, type Phase } from '../../model/types';
import { newGame } from '../initialState';

export type GameAction =
  | { type: 'game/setPhase'; phase: Phase }
  | { type: 'game/new'; keepBoard?: boolean; keepPlayers?: boolean }
  | { type: 'game/load'; state: GameState };

export function gameReducer(s: GameState, a: GameAction): GameState {
  switch (a.type) {
    case 'game/setPhase':
      return { ...s, phase: a.phase };
    case 'game/new': {
      const fresh = newGame(s.board.layout);
      if (a.keepBoard) {
        fresh.board = s.board;
        fresh.robber = s.robber;
      }
      if (a.keepPlayers) {
        fresh.players = s.players;
        fresh.hands = Object.fromEntries(s.players.map((p) => [p.id, fresh.hands[p.id] ?? emptyHand()]));
      }
      return fresh;
    }
    case 'game/load':
      return a.state;
  }
}
