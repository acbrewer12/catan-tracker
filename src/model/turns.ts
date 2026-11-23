/**
 * Whose turn it is, for the Play tab. Derived from the dice history and the
 * opening placements, so it stays right after undo, corrections on other tabs
 * or a reload. The only extra input is the id of the last roll whose turn was
 * ended ("Next turn"), which the Play tab keeps per device.
 */
import { firstPlayer, openingTurn, turnOrder } from './pieces';
import type { CardEvent, DiceRoll, GameState, PlayerId } from './types';

export type TurnStage =
  /** Who goes first hasn't been decided yet (Pieces tab). */
  | { stage: 'choose-first' }
  /** Opening round: this player places a settlement or road. */
  | { stage: 'opening'; player: PlayerId; place: 'settlement' | 'road' }
  /** Waiting for this player's roll. */
  | { stage: 'roll'; player: PlayerId }
  /** They rolled; trades, builds and dev cards happen now. */
  | { stage: 'act'; player: PlayerId; roll: DiceRoll };

/** Who rolled `roll`: the recorded roller, or turn order by position for rolls entered without one. */
function rollerOf(s: GameState, index: number): PlayerId {
  const order = turnOrder(s);
  return s.diceHistory[index]?.player ?? order[index % order.length];
}

export function currentTurn(s: GameState, endedRollId: string | null): TurnStage {
  if (!s.players.length) return { stage: 'choose-first' };
  const rolls = s.diceHistory;
  if (!rolls.length) {
    if (!firstPlayer(s).decided) return { stage: 'choose-first' };
    const open = openingTurn(s);
    if (open) return { stage: 'opening', ...open };
    return { stage: 'roll', player: turnOrder(s)[0] };
  }
  const i = rolls.length - 1;
  const last = rolls[i];
  const who = rollerOf(s, i);
  if (last.id !== endedRollId) return { stage: 'act', player: who, roll: last };
  return { stage: 'roll', player: nextPlayer(s, who) };
}

/** The player after `p` going clockwise from the first player. */
export function nextPlayer(s: GameState, p: PlayerId): PlayerId {
  const order = turnOrder(s);
  const i = order.indexOf(p);
  return order[(i + 1) % order.length];
}

/** Card events logged since `roll` (its own payout left out), oldest first. */
export function eventsSince(s: GameState, roll: DiceRoll): CardEvent[] {
  const i = s.cardLog.findIndex((e) => e.kind === 'production' && e.rollId === roll.id);
  const after = i >= 0 ? s.cardLog.slice(i + 1) : s.cardLog.filter((e) => e.at >= roll.at && !(e.kind === 'production' && e.rollId === roll.id));
  return after.filter((e) => e.kind !== 'production');
}
