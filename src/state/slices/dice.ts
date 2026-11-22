/**
 * Baseline dice + hand actions. The dice/resources feature thread owns this
 * file and will add "resources gained from a roll", discards, steals, trades.
 */
import { emptyHand, type DiceRoll, type GameState, type Hand, type PlayerId } from '../../model/types';

export type DiceAction =
  | { type: 'dice/add'; roll: DiceRoll }
  | { type: 'dice/removeLast' }
  | { type: 'hands/set'; player: PlayerId; hand: Hand };

export function diceReducer(s: GameState, a: DiceAction): GameState {
  switch (a.type) {
    case 'dice/add':
      return { ...s, diceHistory: [...s.diceHistory, a.roll] };
    case 'dice/removeLast':
      return { ...s, diceHistory: s.diceHistory.slice(0, -1) };
    case 'hands/set':
      return { ...s, hands: { ...s.hands, [a.player]: { ...emptyHand(), ...a.hand } } };
  }
}
