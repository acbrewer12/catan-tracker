/**
 * Dice rolls and cards. Owned by the dice/cards feature.
 *
 * Rolls go in `diceHistory`; every card movement goes in `cardLog`, and
 * `hands` is rebuilt from the log after each change (model/cards.ts).
 * A roll logs its payout in the same step, so one undo takes back both.
 *
 * `syncBuilds` is called by the root reducer after piece changes: a new road,
 * settlement or city charges its owner, opening placements are free, and the
 * second opening settlement hands out its starting resources.
 */
import { newEventId, replay, rollPayout, startingResources, withHands } from '../../model/cards';
import { emptyHand, type CardEvent, type DiceRoll, type GameState, type Hand, type PlayerId } from '../../model/types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A card event to log; id and time are filled in if left out. */
export type NewCardEvent = DistributiveOmit<CardEvent, 'id' | 'at'> & { id?: string; at?: number };

export type DiceAction =
  | { type: 'dice/add'; roll: DiceRoll }
  | { type: 'dice/removeLast' }
  | { type: 'dice/remove'; id: string }
  | { type: 'hands/set'; player: PlayerId; hand: Hand }
  | { type: 'cards/log'; event: NewCardEvent }
  | { type: 'cards/remove'; id: string };

const withLog = (s: GameState, cardLog: CardEvent[]): GameState => withHands({ ...s, cardLog });
const stamp = (e: NewCardEvent): CardEvent => ({ ...e, id: e.id ?? newEventId(), at: e.at ?? Date.now() }) as CardEvent;

function removeRoll(s: GameState, id: string | undefined): GameState {
  if (!id) return s;
  return withLog(
    { ...s, diceHistory: s.diceHistory.filter((r) => r.id !== id) },
    s.cardLog.filter((e) => !(e.kind === 'production' && e.rollId === id)),
  );
}

export function diceReducer(s: GameState, a: DiceAction): GameState {
  switch (a.type) {
    case 'dice/add': {
      const next = { ...s, diceHistory: [...s.diceHistory, a.roll] };
      const { gains } = rollPayout(s, a.roll.total);
      if (!Object.keys(gains).length) return next;
      return withLog(next, [...s.cardLog, stamp({ kind: 'production', rollId: a.roll.id, gains, at: a.roll.at })]);
    }
    case 'dice/removeLast':
      return removeRoll(s, s.diceHistory[s.diceHistory.length - 1]?.id);
    case 'dice/remove':
      return removeRoll(s, a.id);
    case 'hands/set': {
      const hand = { ...emptyHand(), ...a.hand };
      return withLog(s, [...s.cardLog, stamp({ kind: 'set', player: a.player, resources: hand.resources })]);
    }
    case 'cards/log': {
      const e = stamp(a.event);
      const last = s.cardLog[s.cardLog.length - 1];
      // Repeated +/- taps on the same hand become one correction.
      const log = e.kind === 'set' && last?.kind === 'set' && last.player === e.player ? s.cardLog.slice(0, -1) : s.cardLog;
      return withLog(s, [...log, e]);
    }
    case 'cards/remove':
      return withLog(s, s.cardLog.filter((e) => e.id !== a.id));
  }
}

// ---------------------------------------------------------------------------

type PieceAction = { type: string; vertex?: string; edge?: string; from?: string; to?: string };

/** Before the first roll, everything placed is part of the opening and costs nothing. */
const inOpening = (s: GameState) => s.diceHistory.length === 0;

/**
 * Keep the card log in step with the board after a pieces action.
 * Builds charge their owner; removals refund; moves and owner changes are
 * corrections that move the existing charge instead.
 */
export function syncBuilds(prev: GameState, next: GameState, a: PieceAction): GameState {
  let log = next.cardLog;
  const at = Date.now();
  const opening = inOpening(next);
  const bySpot = (spot: string | undefined) => (e: CardEvent) => e.kind === 'build' && e.spot === spot;
  const dropAt = (spot: string, item?: string) => {
    if (!item) {
      log = log.filter((e) => !bySpot(spot)(e));
      return;
    }
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.kind === 'build' && e.spot === spot && e.item === item) {
        log = log.filter((_, j) => j !== i);
        return;
      }
    }
  };
  const reassign = (spot: string, player: PlayerId) => {
    log = log.map((e) => (e.kind === 'build' && e.spot === spot ? { ...e, player } : e));
  };
  const respot = (from: string, to: string) => {
    log = log.map((e) => (e.kind === 'build' && e.spot === from ? { ...e, spot: to } : e));
  };
  const build = (e: Omit<Extract<CardEvent, { kind: 'build' }>, 'id' | 'at' | 'kind'>) => {
    log = [...log, { ...e, kind: 'build', id: newEventId(), at }];
  };

  switch (a.type) {
    case 'pieces/setBuilding': {
      const v = a.vertex!;
      const old = prev.pieces.buildings[v];
      const now = next.pieces.buildings[v];
      if (!now) break;
      if (!old) {
        const settlements = Object.values(next.pieces.buildings).filter((b) => b.player === now.player).length;
        const startGain = opening && settlements === 2 ? startingResources(next, v) : undefined;
        build({ player: now.player, item: 'settlement', spot: v, free: opening || undefined, startGain });
        if (now.kind === 'city') build({ player: now.player, item: 'city', spot: v, free: opening || undefined });
        break;
      }
      if (old.player !== now.player) reassign(v, now.player);
      if (old.kind === 'settlement' && now.kind === 'city') build({ player: now.player, item: 'city', spot: v, free: opening || undefined });
      if (old.kind === 'city' && now.kind === 'settlement') dropAt(v, 'city');
      break;
    }
    case 'pieces/removeBuilding':
    case 'pieces/removeRoad':
      dropAt((a.vertex ?? a.edge)!);
      break;
    case 'pieces/setRoad': {
      const e = a.edge!;
      const old = prev.pieces.roads[e];
      const now = next.pieces.roads[e];
      if (!now) break;
      if (!old) {
        const free = opening || (replay(log)[now]?.freeRoads ?? 0) > 0;
        build({ player: now, item: 'road', spot: e, free: free || undefined });
      } else if (old !== now) reassign(e, now);
      break;
    }
    case 'pieces/moveBuilding':
    case 'pieces/moveRoad':
      if (a.from && a.to) respot(a.from, a.to);
      break;
  }
  return log === next.cardLog ? next : withHands({ ...next, cardLog: log });
}
