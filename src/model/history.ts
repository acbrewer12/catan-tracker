/**
 * Rebuild the game as it stood at any moment, from the card log and dice
 * history. Used by the post-game review to judge each decision against what
 * the board looked like at the time, not at the end.
 *
 *   turnsOf(game)          -> every roll, who rolled it, and which card events
 *                             happened during that turn
 *   stateAt(game, i, n)    -> the game before card event `i`, after `n` rolls
 *
 * Pieces come from the build events in the log (each has its spot). The robber
 * isn't logged when it moves, so past states put it back on the desert.
 */
import { desertHex } from './board';
import { withHands } from './cards';
import { turnOrder } from './pieces';
import type { CardEvent, DiceRoll, GameState, Pieces, PlayerId } from './types';

export interface TurnInfo {
  /** 0-based position in diceHistory; shown to people as turn index + 1. */
  index: number;
  roll: DiceRoll;
  player: PlayerId;
  /** 1-based round (every player rolls once per round). */
  round: number;
  /** Card events [start, end) that belong to this turn (its payout included). */
  start: number;
  end: number;
}

/** Where each roll sits in the card log: its payout, or the first event logged after it. */
function rollPositions(game: GameState): number[] {
  const log = game.cardLog;
  let from = 0;
  return game.diceHistory.map((roll) => {
    let i = log.findIndex((e, k) => k >= from && e.kind === 'production' && e.rollId === roll.id);
    // No payout (a 7, or nobody collected): the first event logged after it.
    if (i < 0) i = log.findIndex((e, k) => k >= from && e.at >= roll.at);
    if (i < 0) i = log.length;
    const hit = log[i];
    from = hit?.kind === 'production' && hit.rollId === roll.id ? i + 1 : i;
    return i;
  });
}

export function turnsOf(game: GameState): TurnInfo[] {
  const order = turnOrder(game);
  const n = Math.max(1, order.length);
  const pos = rollPositions(game);
  return game.diceHistory.map((roll, i) => ({
    index: i,
    roll,
    player: roll.player ?? order[i % n],
    round: Math.floor(i / n) + 1,
    start: pos[i],
    end: i + 1 < pos.length ? pos[i + 1] : game.cardLog.length,
  }));
}

/** Card events logged before the first roll (opening placements). */
export function openingEnd(game: GameState): number {
  return turnsOf(game)[0]?.start ?? game.cardLog.length;
}

/** Board pieces built by the first `upto` card events. */
export function piecesFrom(log: CardEvent[], upto = log.length): Pieces {
  const pieces: Pieces = { buildings: {}, roads: {} };
  for (const e of log.slice(0, upto)) {
    if (e.kind !== 'build' || !e.spot) continue;
    if (e.item === 'road') pieces.roads[e.spot] = e.player;
    else if (e.item === 'settlement') pieces.buildings[e.spot] = { player: e.player, kind: 'settlement' };
    else if (e.item === 'city') pieces.buildings[e.spot] = { player: e.player, kind: 'city' };
  }
  return pieces;
}

/** The game just before card event `upto`, with the first `rolls` rolls made. */
export function stateAt(game: GameState, upto: number, rolls: number): GameState {
  const cardLog = game.cardLog.slice(0, upto);
  return withHands({
    ...game,
    phase: rolls > 0 ? 'playing' : 'placement',
    pieces: piecesFrom(cardLog),
    diceHistory: game.diceHistory.slice(0, rolls),
    robber: desertHex(game.board),
    cardLog,
  });
}
