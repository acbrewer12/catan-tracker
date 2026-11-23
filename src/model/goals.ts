/**
 * Goals a player can work toward (city, settlement plus roads, dev card), how
 * many rounds each takes to afford, and threats from other players. Shared by
 * the Tips plan (plan.ts) and the trade evaluation (tradeValue.ts).
 */
import { topologyFor } from './board';
import { COST } from './cards';
import { boardPoints, checkBuilding, longestRoad, longestRoadHolder, piecesLeft } from './pieces';
import { WIN_POINTS } from './strategy';
import { playerProduction, scoreContext, scoreCorner } from './suggestions';
import { expansionSpots, largestArmyHolder, tradeRates, tradesFor } from './suggestionsPlay';
import type { EdgeId, GameState, PlayerId, Resource, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';

export type GoalItem = 'city' | 'settlement' | 'devCard' | 'road';

export interface Goal {
  item: GoalItem;
  /** Corner for a city or settlement. */
  where?: VertexId;
  /** Roads to build first (settlement only). */
  roads: number;
  /** First road toward the spot. */
  nextRoad?: EdgeId;
  /** Everything it costs, roads included. */
  cost: ResourceCounts;
  /** Rounds until affordable (0 = this turn), with trades. 99 = not in sight. */
  eta: number;
  pips: number;
  /** An opponent can reach the spot as fast. */
  contested: boolean;
  newResources: Resource[];
  value: number;
}

export type Threat =
  | { kind: 'nearWin'; player: PlayerId; points: number; devCards: number }
  | { kind: 'longestRoad'; player: PlayerId; length: number; mine: number; holds: boolean }
  | { kind: 'largestArmy'; player: PlayerId; knights: number; mine: number; holds: boolean }
  | { kind: 'race'; player: PlayerId; where: VertexId };

export const add = (a: Partial<ResourceCounts>, b: Partial<ResourceCounts>, times = 1): ResourceCounts => {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = (a[r] ?? 0) + (b[r] ?? 0) * times;
  return out;
};
export const total = (c: Partial<ResourceCounts>) => RESOURCES.reduce((s, r) => s + (c[r] ?? 0), 0);
export const shortfall = (hand: ResourceCounts, cost: ResourceCounts) => {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.max(0, cost[r] - hand[r]);
  return out;
};

/**
 * Rounds until `cost` is affordable (with trades), assuming the player keeps
 * their cards and every player rolls once per round.
 */
export function roundsToAfford(hand: ResourceCounts, cost: ResourceCounts, perRound: ResourceCounts, rates: ResourceCounts): number {
  for (let t = 0; t <= 20; t++) {
    const h = emptyResources();
    for (const r of RESOURCES) h[r] = Math.floor(hand[r] + perRound[r] * t + 1e-9);
    if (tradesFor(h, cost, rates)) return t;
  }
  return 99;
}

/** Candidate goals for a player, best first. */
export function goals(state: GameState, player: PlayerId): Goal[] {
  const hand = state.hands[player]?.resources ?? emptyResources();
  const rates = tradeRates(state, player);
  const income = playerProduction(state, player);
  const n = Math.max(2, state.players.length);
  const perRound = emptyResources();
  for (const r of RESOURCES) perRound[r] = (income[r] * n) / 36;
  const left = piecesLeft(state, player);
  const ctx = scoreContext(state, player);
  const out: Goal[] = [];

  const goal = (g: Omit<Goal, 'eta' | 'value'>, gain: number): Goal => {
    const eta = roundsToAfford(hand, g.cost, perRound, rates);
    return { ...g, eta, value: gain / (1 + 0.5 * eta) };
  };

  if (left.city > 0) {
    for (const [v, b] of Object.entries(state.pieces.buildings)) {
      if (b.player !== player || b.kind !== 'settlement') continue;
      const sc = scoreCorner(state.board, v, { ...ctx, owned: income });
      out.push(goal({ item: 'city', where: v, roads: 0, cost: add(COST.city, {}), pips: sc.pips, contested: false, newResources: [] }, 4 + sc.pips * 0.5));
    }
  }

  if (left.settlement > 0) {
    for (const s of expansionSpots(state, player, 6)) {
      if (s.roads > Math.min(3, left.road)) continue;
      if (s.roads === 0 && checkBuilding(state, s.vertex, player, 'settlement').length) continue;
      const cost = add(COST.settlement, COST.road, s.roads);
      out.push(
        goal(
          { item: 'settlement', where: s.vertex, roads: s.roads, nextRoad: s.nextRoad, cost, pips: s.pips, contested: s.contested, newResources: s.newResources },
          4 + s.score * 0.5 + (s.contested ? 1.5 : 0),
        ),
      );
    }
  }

  out.push(goal({ item: 'devCard', roads: 0, cost: add(COST.devCard, {}), pips: 0, contested: false, newResources: [] }, 2.5 + (income.ore + income.wheat) * 0.03));
  return out.sort((a, b) => b.value - a.value);
}

export function threats(state: GameState, me: PlayerId, goal: Goal | null): Threat[] {
  const out: Threat[] = [];
  const holder = longestRoadHolder(state);
  const army = largestArmyHolder(state);
  const myRoad = longestRoad(state, me);
  const myKnights = state.hands[me]?.knightsPlayed ?? 0;
  for (const p of state.players) {
    if (p.id === me) continue;
    const pts = boardPoints(state, p.id, holder) + (army === p.id ? 2 : 0);
    const dev = state.hands[p.id]?.devCards ?? 0;
    if (pts >= WIN_POINTS - 3) out.push({ kind: 'nearWin', player: p.id, points: pts, devCards: dev });
    const len = longestRoad(state, p.id);
    if (holder === p.id || (len >= 4 && len > myRoad)) out.push({ kind: 'longestRoad', player: p.id, length: len, mine: myRoad, holds: holder === p.id });
    const k = state.hands[p.id]?.knightsPlayed ?? 0;
    if (army === p.id || (k >= 2 && k >= myKnights)) out.push({ kind: 'largestArmy', player: p.id, knights: k, mine: myKnights, holds: army === p.id });
  }
  if (goal?.contested && goal.where) {
    // Who else can reach the spot: anyone with a road or building within 2 steps.
    const topo = topologyFor(state.board.layout);
    const near = new Set<VertexId>([goal.where, ...topo.vertices[goal.where].adjacent]);
    for (const v of [...near]) for (const a of topo.vertices[v].adjacent) near.add(a);
    const rival = state.players.find(
      (p) =>
        p.id !== me &&
        [...near].some((v) => state.pieces.buildings[v]?.player === p.id || topo.vertices[v].edges.some((e) => state.pieces.roads[e] === p.id)),
    );
    if (rival) out.push({ kind: 'race', player: rival.id, where: goal.where });
  }
  const order = { nearWin: 0, race: 1, longestRoad: 2, largestArmy: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

