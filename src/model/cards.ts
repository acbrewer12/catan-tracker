/**
 * Card tracking: roll payouts, build costs, and hand estimates.
 *
 * Every card movement is a `CardEvent` in `GameState.cardLog`. Replaying the
 * log gives the user's own hand, exactly. Opponents' resource cards are not
 * tracked (by choice: only public info is used for them): their `Hand` has
 * no resources, and only public things are counted for them (dev cards
 * bought and played, knights). Their card count is unknown (`known: false`
 * on their estimate); planners guess from what their buildings produce.
 */
import { hexesAtVertex } from './board';
import {
  RESOURCES,
  emptyHand,
  emptyResources,
  type BuildItem,
  type CardEvent,
  type DevCardKind,
  type GameState,
  type Hand,
  type LayoutId,
  type PlayerId,
  type Resource,
  type ResourceCounts,
  type VertexId,
} from './types';

export const COST: Record<BuildItem, Partial<ResourceCounts>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

/** Cards of each resource in the bank at the start (5-6 player extension adds 5 of each). */
export const BANK_SIZE: Record<LayoutId, number> = { standard: 19, extended: 24 };

/** Development deck. The 5-6 player extension adds 6 knights, 1 each of the progress cards. */
export const DEV_DECK: Record<LayoutId, Record<DevCardKind, number>> = {
  standard: { knight: 14, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2, victoryPoint: 5 },
  extended: { knight: 20, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3, victoryPoint: 5 },
};

export const DEV_LABEL: Record<DevCardKind, string> = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  victoryPoint: 'Victory Point',
};

export const BUILD_LABEL: Record<BuildItem, string> = { road: 'Road', settlement: 'Settlement', city: 'City', devCard: 'Dev card' };

export const DEV_KINDS = Object.keys(DEV_LABEL) as DevCardKind[];

export const toCounts = (p: Partial<ResourceCounts> | undefined): ResourceCounts => ({ ...emptyResources(), ...p });
export const countTotal = (p: Partial<ResourceCounts> | undefined): number =>
  RESOURCES.reduce((n, r) => n + (p?.[r] ?? 0), 0);

let seq = 0;
export const newEventId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---------------------------------------------------------------------------
// Roll payouts

export interface Payout {
  /** What each player picks up (players who get nothing are left out). */
  gains: Record<PlayerId, Partial<ResourceCounts>>;
  /** What the robber stopped. */
  blocked: Record<PlayerId, Partial<ResourceCounts>>;
  /** Resources the bank can't cover for everyone, so nobody gets them. */
  shortages: Resource[];
}

/**
 * Who picks up what when `total` is rolled. Settlements take 1, cities 2,
 * nothing from the robber's tile. If the bank certainly can't pay every
 * player a resource, nobody gets it (one player gets what's left).
 */
export function rollPayout(state: GameState, total: number, bank?: ResourceCounts): Payout {
  const gains: Record<PlayerId, ResourceCounts> = {};
  const blocked: Record<PlayerId, ResourceCounts> = {};
  if (total === 7) return { gains: {}, blocked: {}, shortages: [] };
  for (const [v, b] of Object.entries(state.pieces.buildings)) {
    for (const h of hexesAtVertex(state.board, v)) {
      if (h.number !== total || !h.terrain || h.terrain === 'desert') continue;
      const n = b.kind === 'city' ? 2 : 1;
      const into = h.id === state.robber ? blocked : gains;
      into[b.player] ??= emptyResources();
      into[b.player][h.terrain] += n;
    }
  }
  const shortages: Resource[] = [];
  const left = bank ?? bankLeft(state);
  for (const r of RESOURCES) {
    const takers = Object.keys(gains).filter((p) => gains[p][r] > 0);
    const want = takers.reduce((n, p) => n + gains[p][r], 0);
    if (want <= left[r]) continue;
    shortages.push(r);
    if (takers.length === 1) gains[takers[0]][r] = Math.max(0, left[r]);
    else for (const p of takers) gains[p][r] = 0;
  }
  return { gains: strip(gains), blocked: strip(blocked), shortages };
}

function strip(m: Record<PlayerId, ResourceCounts>): Record<PlayerId, Partial<ResourceCounts>> {
  const out: Record<PlayerId, Partial<ResourceCounts>> = {};
  for (const [p, c] of Object.entries(m)) {
    const nz = Object.fromEntries(RESOURCES.filter((r) => c[r] > 0).map((r) => [r, c[r]]));
    if (Object.keys(nz).length) out[p] = nz;
  }
  return out;
}

/** Resources a corner hands out once (second opening settlement). */
export function startingResources(state: GameState, v: VertexId): Partial<ResourceCounts> {
  const c = emptyResources();
  for (const h of hexesAtVertex(state.board, v)) if (h.terrain && h.terrain !== 'desert') c[h.terrain]++;
  return Object.fromEntries(RESOURCES.filter((r) => c[r]).map((r) => [r, c[r]]));
}

// ---------------------------------------------------------------------------
// Possible-hands tracking

type Counts = number[]; // indexed like RESOURCES
const MAX_WORLDS = 2000;

/** A weighted set of hands a player could be holding. */
class Worlds {
  m = new Map<string, { c: Counts; w: number }>();
  constructor(c: Counts = [0, 0, 0, 0, 0]) {
    this.m.set(c.join(), { c, w: 1 });
  }
  private static from(list: Array<{ c: Counts; w: number }>): Worlds {
    const out = new Worlds();
    out.m.clear();
    for (const { c, w } of list) {
      if (w <= 0) continue;
      const k = c.join();
      const cur = out.m.get(k);
      if (cur) cur.w += w;
      else out.m.set(k, { c, w });
    }
    out.normalise();
    return out;
  }
  private normalise() {
    let list = [...this.m.values()];
    if (list.length > MAX_WORLDS) {
      list.sort((a, b) => b.w - a.w);
      list = list.slice(0, MAX_WORLDS);
      this.m = new Map(list.map((x) => [x.c.join(), x]));
    }
    const sum = list.reduce((s, x) => s + x.w, 0);
    if (sum > 0) for (const x of list) x.w /= sum;
  }
  list() {
    return [...this.m.values()];
  }
  add(d: Counts): Worlds {
    return Worlds.from(this.list().map(({ c, w }) => ({ c: c.map((n, i) => n + d[i]), w })));
  }
  /** Spend cards. Returns false if no possible hand could afford it (we missed something). */
  remove(d: Counts): { next: Worlds; ok: boolean } {
    const fits = this.list().filter(({ c }) => c.every((n, i) => n >= d[i]));
    if (fits.length) return { next: Worlds.from(fits.map(({ c, w }) => ({ c: c.map((n, i) => n - d[i]), w }))), ok: true };
    return { next: Worlds.from(this.list().map(({ c, w }) => ({ c: c.map((n, i) => Math.max(0, n - d[i])), w }))), ok: false };
  }
  /** Lose one random card. Returns the chance it was each resource. */
  loseRandom(): { next: Worlds; dist: number[] } {
    const out: Array<{ c: Counts; w: number }> = [];
    const dist = [0, 0, 0, 0, 0];
    for (const { c, w } of this.list()) {
      const t = c.reduce((a, b) => a + b, 0);
      if (!t) {
        out.push({ c, w });
        continue;
      }
      c.forEach((n, i) => {
        if (!n) return;
        const p = (w * n) / t;
        dist[i] += p;
        out.push({ c: c.map((x, j) => (j === i ? x - 1 : x)), w: p });
      });
    }
    return { next: Worlds.from(out), dist };
  }
  /** Gain one card whose type has the given probabilities. */
  gainRandom(dist: number[]): Worlds {
    const sum = dist.reduce((a, b) => a + b, 0);
    if (!sum) return this;
    const out: Array<{ c: Counts; w: number }> = [];
    for (const { c, w } of this.list())
      dist.forEach((p, i) => p > 0 && out.push({ c: c.map((x, j) => (j === i ? x + 1 : x)), w: (w * p) / sum }));
    return Worlds.from(out);
  }
  /** We learned they hold exactly n of resource i. */
  exactly(i: number, n: number): Worlds {
    const fits = this.list().filter(({ c }) => c[i] === n);
    return Worlds.from(fits.length ? fits : this.list().map(({ c, w }) => ({ c: c.map((x, j) => (j === i ? n : x)), w })));
  }
  total(): number {
    return this.list().reduce((s, { c, w }) => s + w * c.reduce((a, b) => a + b, 0), 0);
  }
}

const vec = (p: Partial<ResourceCounts> | undefined): Counts => RESOURCES.map((r) => p?.[r] ?? 0);
const UNIFORM = [1, 1, 1, 1, 1];

export interface PlayerCards {
  worlds: Worlds;
  devCards: number;
  knightsPlayed: number;
  /** Road Building roads still to place for free. */
  freeRoads: number;
  /** Dev cards by kind; only known for the user. */
  dev: Record<DevCardKind, number>;
  /** A spend didn't fit any hand we thought possible, so we missed some cards. */
  missedCards: boolean;
  /** Resources picked up from rolls so far. */
  produced: ResourceCounts;
}

const freshPlayer = (): PlayerCards => ({
  worlds: new Worlds(),
  devCards: 0,
  knightsPlayed: 0,
  freeRoads: 0,
  dev: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 },
  missedCards: false,
  produced: emptyResources(),
});

/** Replay the card log. Cached per log array, since state updates replace it. */
const replayCache = new WeakMap<CardEvent[], Map<string, Record<PlayerId, PlayerCards>>>();
/**
 * Replay the card log. Resources are only tracked for `me` (the user);
 * everyone's public counts (dev cards, knights, Road Building) are tracked.
 */
export function replay(log: CardEvent[], me: PlayerId | undefined): Record<PlayerId, PlayerCards> {
  const key = me ?? '';
  let byMe = replayCache.get(log);
  const hit = byMe?.get(key);
  if (hit) return hit;
  const ps: Record<PlayerId, PlayerCards> = {};
  const all = (id: PlayerId) => (ps[id] ??= freshPlayer());
  // Resource changes only land on the user's hand; others get a throwaway.
  const P = (id: PlayerId) => (id === me ? all(id) : freshPlayer());
  const spend = (id: PlayerId, d: Counts) => {
    const p = P(id);
    const { next, ok } = p.worlds.remove(d);
    p.worlds = next;
    if (!ok) p.missedCards = true;
  };
  for (const e of log) {
    switch (e.kind) {
      case 'production':
        for (const [id, g] of Object.entries(e.gains)) {
          P(id).worlds = P(id).worlds.add(vec(g));
          for (const r of RESOURCES) P(id).produced[r] += g[r] ?? 0;
        }
        break;
      case 'gain':
        P(e.player).worlds = P(e.player).worlds.add(vec(e.resources));
        break;
      case 'lose':
        spend(e.player, vec(e.resources));
        break;
      case 'build': {
        const p = all(e.player);
        if (e.item === 'road' && e.free && p.freeRoads > 0) p.freeRoads--;
        if (!e.free) spend(e.player, vec(COST[e.item]));
        if (e.startGain && e.player === me) p.worlds = p.worlds.add(vec(e.startGain));
        if (e.item === 'devCard') {
          p.devCards++;
          if (e.devCard) p.dev[e.devCard]++;
        }
        break;
      }
      case 'trade':
        spend(e.player, vec(e.give));
        P(e.player).worlds = P(e.player).worlds.add(vec(e.get));
        if (e.with !== 'bank') {
          spend(e.with, vec(e.get));
          P(e.with).worlds = P(e.with).worlds.add(vec(e.give));
        }
        break;
      case 'steal': {
        if (e.resource) {
          spend(e.victim, vec({ [e.resource]: 1 }));
          P(e.thief).worlds = P(e.thief).worlds.add(vec({ [e.resource]: 1 }));
        } else {
          const { next, dist } = P(e.victim).worlds.loseRandom();
          P(e.victim).worlds = next;
          P(e.thief).worlds = P(e.thief).worlds.gainRandom(dist);
        }
        break;
      }
      case 'playDev': {
        const p = all(e.player);
        p.devCards = Math.max(0, p.devCards - 1);
        if (p.dev[e.card] > 0) p.dev[e.card]--;
        if (e.card === 'knight') p.knightsPlayed++;
        if (e.card === 'roadBuilding') p.freeRoads += 2;
        if (e.card === 'yearOfPlenty' && e.take && e.player === me) p.worlds = p.worlds.add(vec(e.take));
        if (e.card === 'monopoly' && e.resource && e.taken) {
          const i = RESOURCES.indexOf(e.resource);
          let got = 0;
          for (const [id, n] of Object.entries(e.taken)) {
            if (id === e.player) continue;
            P(id).worlds = P(id).worlds.exactly(i, n).remove(vec({ [e.resource]: n })).next;
            got += n;
          }
          if (e.player === me) p.worlds = p.worlds.add(vec({ [e.resource]: got }));
        }
        break;
      }
      case 'set':
        P(e.player).worlds = new Worlds(vec(e.resources));
        P(e.player).missedCards = false;
        break;
      case 'setTotal': {
        // Old saves only: opponent card counts are no longer tracked.
        if (e.player !== me) break;
        const p = P(e.player);
        let diff = e.total - Math.round(p.worlds.total());
        for (; diff > 0; diff--) p.worlds = p.worlds.gainRandom(UNIFORM);
        for (; diff < 0; diff++) p.worlds = p.worlds.loseRandom().next;
        p.missedCards = false;
        break;
      }
    }
  }
  if (!byMe) replayCache.set(log, (byMe = new Map()));
  byMe.set(key, ps);
  return ps;
}

export interface ResourceEstimate {
  /** Cards of this type they definitely hold. */
  min: number;
  /** Most they could hold. */
  max: number;
  /** Expected count (can be fractional). */
  expected: number;
}

export interface HandEstimate {
  /** True for the user. Opponents' resource cards aren't tracked, so for them this is false and total is 0. */
  known: boolean;
  /** Number of resource cards held (the user's; 0 for opponents, see `known`). */
  total: number;
  resources: Record<Resource, ResourceEstimate>;
  devCards: number;
  knightsPlayed: number;
  /** Dev cards in hand by kind (only filled for the user). */
  dev: Record<DevCardKind, number>;
  freeRoads: number;
  missedCards: boolean;
  produced: ResourceCounts;
  /** How many possible hands are being tracked (1 = known exactly). */
  possibilities: number;
}

function estimateFor(p: PlayerCards, known: boolean): HandEstimate {
  const list = p.worlds.list();
  const resources = {} as Record<Resource, ResourceEstimate>;
  RESOURCES.forEach((r, i) => {
    let min = Infinity;
    let max = 0;
    let expected = 0;
    for (const { c, w } of list) {
      min = Math.min(min, c[i]);
      max = Math.max(max, c[i]);
      expected += w * c[i];
    }
    resources[r] = { min: list.length ? min : 0, max, expected };
  });
  return {
    known,
    total: Math.round(p.worlds.total()),
    resources,
    devCards: p.devCards,
    knightsPlayed: p.knightsPlayed,
    dev: p.dev,
    freeRoads: p.freeRoads,
    missedCards: p.missedCards,
    produced: p.produced,
    possibilities: list.length,
  };
}

/** Detailed estimate for every player (in turn order). */
export function handEstimates(state: GameState): Record<PlayerId, HandEstimate> {
  const me = state.players.find((p) => p.isMe)?.id;
  const ps = replay(state.cardLog ?? [], me);
  return Object.fromEntries(state.players.map((pl) => [pl.id, estimateFor(ps[pl.id] ?? freshPlayer(), pl.id === me)]));
}

/** Compact Hand for `GameState.hands`: definite cards + count of unnamed ones. */
export function toHand(e: HandEstimate): Hand {
  const resources = toCounts(Object.fromEntries(RESOURCES.map((r) => [r, e.resources[r].min])));
  return { ...emptyHand(), resources, unknown: Math.max(0, e.total - countTotal(resources)), devCards: e.devCards, knightsPlayed: e.knightsPlayed };
}

/** Rebuild `state.hands` from the log. Call after any change to cardLog. */
export function withHands(state: GameState): GameState {
  const est = handEstimates(state);
  return { ...state, hands: Object.fromEntries(state.players.map((p) => [p.id, toHand(est[p.id])])) };
}

/** Upper bound on what's left in the bank (only the user's cards are known to be out). */
export function bankLeft(state: GameState): ResourceCounts {
  const est = handEstimates(state);
  const size = BANK_SIZE[state.board.layout];
  return toCounts(Object.fromEntries(RESOURCES.map((r) => [r, size - Object.values(est).reduce((n, e) => n + e.resources[r].min, 0)])));
}

/** Development cards left in the deck. */
export function devCardsLeft(state: GameState): number {
  const deck = Object.values(DEV_DECK[state.board.layout]).reduce((a, b) => a + b, 0);
  return deck - (state.cardLog ?? []).filter((e) => e.kind === 'build' && e.item === 'devCard').length;
}

/** Can this hand pay for an item? */
export const canAfford = (hand: ResourceCounts, item: BuildItem) => RESOURCES.every((r) => hand[r] >= (COST[item][r] ?? 0));

/** Number of cards a player must discard on a 7 (0 if 7 or fewer). */
export const discardCount = (total: number, limit = 7) => (total > limit ? Math.floor(total / 2) : 0);
