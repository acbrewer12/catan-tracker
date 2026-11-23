/**
 * Look-ahead for the Tips plan: which overall strategy gets you to 10 points
 * fastest, and the odds of affording something within the next few turns.
 *
 *   compareStrategies(state, me)  -> cities / expand / dev cards / longest road,
 *                                    each with expected rounds to 10 points
 *   affordOdds(state, me, cost)   -> chance of affording `cost` by each turn,
 *                                    from simulated dice (with 7s and discards)
 *
 * Both run on expected or simulated income from the board, so they are fast
 * estimates rather than a full game solver.
 */
import { pips, topologyFor } from './board';
import { COST, DEV_DECK, handEstimates } from './cards';
import { boardPoints, longestRoad, longestRoadHolder, piecesLeft } from './pieces';
import { isResource, playerProduction, vertexProduction } from './suggestions';
import { expansionSpots, largestArmyHolder, tradeRates, tradesFor } from './suggestionsPlay';
import type { GameState, PlayerId, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';

export const WIN_POINTS = 10;

export type StrategyId = 'cities' | 'expand' | 'devCards' | 'longestRoad';
export type BuyItem = 'city' | 'settlement' | 'devCard' | 'road';

export interface Purchase {
  item: BuyItem;
  where?: VertexId;
  /** Roads built on the way (settlements). */
  roads?: number;
  /** Round it happens in (0 = this turn). */
  round: number;
  /** Points after this purchase (fractional for dev cards). */
  points: number;
}

export interface StrategyResult {
  id: StrategyId;
  /** Expected rounds to 10 points (41 = not within 40 rounds). */
  rounds: number;
  /** First few purchases, in order. */
  buys: Purchase[];
  /** Points expected after 10 rounds, to compare strategies that don't finish. */
  pointsAt10: number;
}

/** Everything the simulations need about a player, computed once. */
export interface PlayerOutlook {
  points: number;
  /** Hidden victory point cards (only known for me). */
  hiddenPoints: number;
  income: ResourceCounts;
  /** Expected cards per round (every player rolls once per round). */
  perRound: ResourceCounts;
  rates: ResourceCounts;
  roadLength: number;
  longestRoadHolder: PlayerId | null;
  /** Roads needed to take Longest Road (0 if already mine). */
  roadsForLongest: number;
  knights: number;
  knightsInHand: number;
  armyHolder: PlayerId | null;
  /** Knights still to play to take Largest Army (0 if already mine). */
  knightsForArmy: number;
}

export function outlook(state: GameState, me: PlayerId): PlayerOutlook {
  const n = Math.max(2, state.players.length);
  const income = playerProduction(state, me);
  const perRound = emptyResources();
  for (const r of RESOURCES) perRound[r] = (income[r] * n) / 36;
  const holder = longestRoadHolder(state);
  const army = largestArmyHolder(state);
  const est = handEstimates(state)[me];
  const others = state.players.filter((p) => p.id !== me);
  const roadLength = longestRoad(state, me);
  const bestOtherRoad = Math.max(0, ...others.map((p) => longestRoad(state, p.id)));
  const knights = state.hands[me]?.knightsPlayed ?? 0;
  const bestOtherKnights = Math.max(0, ...others.map((p) => state.hands[p.id]?.knightsPlayed ?? 0));
  const hiddenPoints = est?.dev?.victoryPoint ?? 0;
  return {
    points: boardPoints(state, me, holder) + (army === me ? 2 : 0) + hiddenPoints,
    hiddenPoints,
    income,
    perRound,
    rates: tradeRates(state, me),
    roadLength,
    longestRoadHolder: holder,
    roadsForLongest: holder === me ? 0 : Math.max(5, bestOtherRoad + 1) - roadLength,
    knights,
    knightsInHand: est?.dev?.knight ?? 0,
    armyHolder: army,
    knightsForArmy: army === me ? 0 : Math.max(0, Math.max(3, bestOtherKnights + 1) - knights),
  };
}

const sub = (hand: ResourceCounts, cost: Partial<ResourceCounts>) => {
  for (const r of RESOURCES) hand[r] -= cost[r] ?? 0;
};

/** Pay for `cost` from a fractional hand, using bank/harbor trades. False if it can't. */
function pay(hand: ResourceCounts, cost: Partial<ResourceCounts>, rates: ResourceCounts): boolean {
  const whole = emptyResources();
  for (const r of RESOURCES) whole[r] = Math.floor(hand[r] + 1e-9);
  const trades = tradesFor(whole, cost, rates);
  if (!trades) return false;
  for (const t of trades) {
    hand[t.give] -= t.count;
    hand[t.get] += t.count / rates[t.give];
  }
  sub(hand, cost);
  return true;
}

const plus = (...cs: Partial<ResourceCounts>[]) => {
  const out = emptyResources();
  for (const c of cs) for (const r of RESOURCES) out[r] += c[r] ?? 0;
  return out;
};

/**
 * Expected-value walk of one strategy: each round add expected income, then
 * buy the strategy's next target whenever it's affordable (with trades).
 */
function simulate(state: GameState, me: PlayerId, id: StrategyId, o: PlayerOutlook): StrategyResult {
  const topo = topologyFor(state.board.layout);
  const hand = { ...(state.hands[me]?.resources ?? emptyResources()) };
  const income = { ...o.income };
  const left = piecesLeft(state, me);
  const deck = DEV_DECK[state.board.layout];
  const deckSize = Object.values(deck).reduce((a, b) => a + b, 0);
  const vpPerDev = deck.victoryPoint / deckSize;
  const knightPerDev = deck.knight / deckSize;
  const n = Math.max(2, state.players.length);

  let points = o.points;
  let roadsBuilt = 0;
  let knights = o.knightsInHand;
  let haveArmy = o.knightsForArmy === 0 && o.armyHolder === me;
  let haveLongest = o.roadsForLongest <= 0;
  const spots = expansionSpots(state, me, 10).filter((s) => s.roads <= Math.min(4, left.road));
  const taken = new Set<VertexId>();
  const myTowns: Array<{ v: VertexId; prod: ResourceCounts }> = Object.entries(state.pieces.buildings)
    .filter(([, b]) => b.player === me && b.kind === 'settlement')
    .map(([v]) => ({ v, prod: vertexProduction(state.board, v, state.robber) }));
  const buys: Purchase[] = [];

  const nextSpot = (round: number) =>
    spots.find((s) => !taken.has(s.vertex) && !topo.vertices[s.vertex].adjacent.some((a) => taken.has(a)) && !(s.contested && round > 2 + s.roads));
  const best = <T extends { prod: ResourceCounts }>(xs: T[]) => xs.sort((a, b) => sumPips(b.prod) - sumPips(a.prod))[0];
  const sumPips = (c: ResourceCounts) => RESOURCES.reduce((s, r) => s + c[r], 0);

  type Target = { item: BuyItem; cost: ResourceCounts; apply: (round: number) => Purchase };
  const cityTarget = (): Target | null => {
    if (left.city <= 0 || !myTowns.length) return null;
    const t = best(myTowns);
    return {
      item: 'city',
      cost: plus(COST.city),
      apply: (round) => {
        myTowns.splice(myTowns.indexOf(t), 1);
        left.city--;
        left.settlement++;
        for (const r of RESOURCES) income[r] += t.prod[r];
        points += 1;
        return { item: 'city', where: t.v, round, points };
      },
    };
  };
  const settleTarget = (round: number): Target | null => {
    if (left.settlement <= 0) return null;
    const s = nextSpot(round);
    if (!s || s.roads > left.road) return null;
    return {
      item: 'settlement',
      cost: plus(COST.settlement, ...Array(s.roads).fill(COST.road)),
      apply: (r) => {
        taken.add(s.vertex);
        left.settlement--;
        left.road -= s.roads;
        roadsBuilt += s.roads;
        const prod = vertexProduction(state.board, s.vertex, state.robber);
        myTowns.push({ v: s.vertex, prod });
        for (const x of RESOURCES) income[x] += prod[x];
        points += 1;
        checkLongest();
        return { item: 'settlement', where: s.vertex, roads: s.roads, round: r, points };
      },
    };
  };
  const devTarget = (): Target => ({
    item: 'devCard',
    cost: plus(COST.devCard),
    apply: (round) => {
      points += vpPerDev;
      knights += knightPerDev;
      if (!haveArmy && knights >= o.knightsForArmy && o.knightsForArmy > 0) {
        haveArmy = true;
        points += 2;
      }
      return { item: 'devCard', round, points };
    },
  });
  const roadTarget = (): Target | null =>
    haveLongest || left.road <= 0
      ? null
      : {
          item: 'road',
          cost: plus(COST.road),
          apply: (round) => {
            left.road--;
            roadsBuilt++;
            checkLongest();
            return { item: 'road', round, points };
          },
        };
  function checkLongest() {
    if (!haveLongest && roadsBuilt >= o.roadsForLongest) {
      haveLongest = true;
      points += 2;
    }
  }

  const target = (round: number): Target | null => {
    const order: Array<() => Target | null> =
      id === 'cities'
        ? [cityTarget, () => settleTarget(round), devTarget]
        : id === 'expand'
          ? [() => settleTarget(round), cityTarget, devTarget]
          : id === 'devCards'
            ? [() => (haveArmy ? null : devTarget()), cityTarget, () => settleTarget(round), devTarget]
            : [roadTarget, () => settleTarget(round), cityTarget, devTarget];
    for (const f of order) {
      const t = f();
      if (t) return t;
    }
    return null;
  };

  let rounds = 41;
  let pointsAt10 = points;
  for (let round = 0; round <= 40; round++) {
    if (round > 0) for (const r of RESOURCES) hand[r] += (income[r] * n) / 36;
    for (let guard = 0; guard < 4; guard++) {
      const t = target(round);
      if (!t || !pay(hand, t.cost, o.rates)) break;
      const p = t.apply(round);
      if (buys.length < 6) buys.push(p);
    }
    if (round === 10) pointsAt10 = points;
    if (points >= WIN_POINTS - 1e-9) {
      rounds = round;
      if (round < 10) pointsAt10 = points;
      break;
    }
  }
  return { id, rounds, buys, pointsAt10 };
}

/** All four strategies, fastest first. Longest Road is skipped when it's already yours. */
export function compareStrategies(state: GameState, me: PlayerId): { outlook: PlayerOutlook; results: StrategyResult[] } {
  const o = outlook(state, me);
  const ids: StrategyId[] = ['cities', 'expand', 'devCards', ...(o.roadsForLongest > 0 && o.roadsForLongest <= 8 ? (['longestRoad'] as const) : [])];
  const results = ids.map((id) => simulate(state, me, id, o)).sort((a, b) => a.rounds - b.rounds || b.pointsAt10 - a.pointsAt10);
  return { outlook: o, results };
}

// ---------------------------------------------------------------------------
// Dice simulation

/** Small seeded RNG so the odds don't flicker between renders. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** What `me` collects on each dice total (robber tile excluded). */
export function payoutTable(state: GameState, me: PlayerId): ResourceCounts[] {
  const table = Array.from({ length: 13 }, () => emptyResources());
  const topo = topologyFor(state.board.layout);
  for (const [v, b] of Object.entries(state.pieces.buildings)) {
    if (b.player !== me) continue;
    for (const id of topo.vertices[v]?.hexes ?? []) {
      const h = state.board.hexes[id];
      if (!h || id === state.robber || !isResource(h.terrain) || !h.number || !pips(h.number)) continue;
      table[h.number][h.terrain] += b.kind === 'city' ? 2 : 1;
    }
  }
  return table;
}

export interface AffordOdds {
  /** byTurn[k] = chance of affording it by your k-th turn from now (0 = right now). */
  byTurn: number[];
  /** Turn by which it's affordable at least half the time (99 if not within the window). */
  median: number;
}

/**
 * Monte Carlo: roll the dice for every player's turn, collect your cards,
 * discard half on a 7 when holding more than 7, and check after each of your
 * own rolls whether `cost` is affordable (with bank/harbor trades).
 */
export function affordOdds(state: GameState, me: PlayerId, cost: Partial<ResourceCounts>, turns = 4, sims = 400): AffordOdds {
  const table = payoutTable(state, me);
  const rates = tradeRates(state, me);
  const start = state.hands[me]?.resources ?? emptyResources();
  const n = Math.max(2, state.players.length);
  const rand = rng(12345);
  const hits = Array(turns + 1).fill(0);
  const full = plus(cost);
  for (let s = 0; s < sims; s++) {
    const hand = { ...start };
    let done = !!tradesFor(hand, full, rates);
    if (done) {
      for (let k = 0; k <= turns; k++) hits[k]++;
      continue;
    }
    for (let k = 1; k <= turns && !done; k++) {
      // The other players roll, then you do.
      for (let roll = 0; roll < n; roll++) {
        const total = 2 + Math.floor(rand() * 6) + Math.floor(rand() * 6);
        if (total === 7) {
          let cards = RESOURCES.reduce((a, r) => a + hand[r], 0);
          if (cards > 7) {
            for (let d = Math.floor(cards / 2); d > 0; d--, cards--) {
              // Discard what the goal needs least.
              const r = [...RESOURCES].filter((x) => hand[x] > 0).sort((a, b) => hand[b] - full[b] - (hand[a] - full[a]))[0];
              hand[r]--;
            }
          }
        } else for (const r of RESOURCES) hand[r] += table[total][r];
      }
      if (tradesFor(hand, full, rates)) {
        done = true;
        for (let j = k; j <= turns; j++) hits[j]++;
      }
    }
  }
  const byTurn = hits.map((h) => h / sims);
  const median = byTurn.findIndex((p) => p >= 0.5);
  return { byTurn, median: median < 0 ? 99 : median };
}

/** Chance that a 7 is rolled before your next turn ends (n rolls). */
export const sevenRisk = (players: number) => 1 - Math.pow(5 / 6, Math.max(1, players));
