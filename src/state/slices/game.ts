/** Whole-game actions: phase changes, new game, import. */
import { emptyHand, type GameState, type Phase, type PlayerId, type Rules } from '../../model/types';
import { newGame } from '../initialState';

export type GameAction =
  | { type: 'game/setPhase'; phase: Phase }
  | { type: 'game/new'; keepBoard?: boolean; keepPlayers?: boolean }
  | { type: 'game/load'; state: GameState }
  | { type: 'game/setRules'; rules: Partial<Rules> }
  /** Record a player's opening roll (appends; ties need another). */
  | { type: 'game/addStartRoll'; player: PlayerId; total: number }
  | { type: 'game/clearStartRolls' };

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
        // Keep how the first player is chosen, but roll again for the new game.
        if (s.rules) fresh.rules = { ...s.rules, startRolls: {} };
      }
      return fresh;
    }
    case 'game/load':
      return a.state;
    case 'game/setRules':
      return { ...s, rules: { ...s.rules, ...a.rules } };
    case 'game/addStartRoll': {
      if (a.total < 2 || a.total > 12) return s;
      const rolls = s.rules?.startRolls ?? {};
      return { ...s, rules: { ...s.rules, startRolls: { ...rolls, [a.player]: [...(rolls[a.player] ?? []), a.total] } } };
    }
    case 'game/clearStartRolls':
      return { ...s, rules: { ...s.rules, startRolls: {} } };
  }
}
