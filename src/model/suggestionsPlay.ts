/**
 * Suggestions during normal play: what to build or trade for next, where to
 * expand, and where to put the robber. Pure functions, no React.
 */
import { pips, portAtVertex, topologyFor } from './board';
import { boardPoints, checkBuilding, longestRoadHolder, piecesLeft } from './pieces';
import { isOpenCorner, isResource, playerProduction, scoreContext, scoreCorner, type CornerScore } from './suggestions';
import type { EdgeId, GameState, HexId, PlayerId, Resource, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';

export type BuildKind = 'city' | 'settlement' | 'devCard' | 'road';

export const COSTS: Record<BuildKind, Partial<ResourceCounts>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

/** Bank trade rate per resource for a player: 4, 3 with a 3:1 harbor, 2 with a matching 2:1. */
export function tradeRates(state: GameState, player: PlayerId): ResourceCounts {
  const rates: ResourceCounts = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  for (const [v, b] of Object.entries(state.pieces.buildings)) {
    if (b.player !== player) continue;
    const port = portAtVertex(state.board, v);
    if (!port) continue;
    for (const r of RESOURCES) rates[r] = Math.min(rates[r], port.kind === 'any' ? 3 : port.kind === r ? 2 : 4);
  }
  return rates;
}

export interface Trade {
  give: Resource;
  count: number;
  get: Resource;
}

/**
 * Bank/harbor trades that turn `hand` into `cost`, or null if impossible.
 * Spends the resource we have most spare of first, never cards the build needs.
 */
export function tradesFor(hand: ResourceCounts, cost: Partial<ResourceCounts>, rates: ResourceCounts): Trade[] | null {
  const spare = emptyResources();
  const missing: Resource[] = [];
  for (const r of RESOURCES) {
    const need = cost[r] ?? 0;
    spare[r] = Math.max(0, hand[r] - need);
    for (let i = hand[r]; i < need; i++) missing.push(r);
  }
  const trades: Trade[] = [];
  for (const get of missing) {
    const give = RESOURCES.filter((r) => spare[r] >= rates[r]).sort((a, b) => spare[b] / rates[b] - spare[a] / rates[a] || rates[a] - rates[b])[0];
    if (!give) return null;
    spare[give] -= rates[give];
    const same = trades.find((t) => t.give === give && t.get === get);
    if (same) same.count += rates[give];
    else trades.push({ give, count: rates[give], get });
  }
  return trades;
}

export interface ExpansionSpot extends CornerScore {
  /** Roads still needed to reach it (0 = can build a settlement there now). */
  roads: number;
  /** Next road to build toward it. */
  nextRoad?: EdgeId;
  /** An opponent can reach it with as many or fewer roads. */
  contested: boolean;
}

/**
 * Fewest new roads from a player's network to every corner (0/1 BFS).
 * Can't pass through other players' buildings or along their roads.
 */
function roadDistances(state: GameState, player: PlayerId): Map<VertexId, number> {
  const topo = topologyFor(state.board.layout);
  const { buildings, roads } = state.pieces;
  const dist = new Map<VertexId, number>();
  const deque: VertexId[] = [];
  const start = new Set<VertexId>();
  for (const [v, b] of Object.entries(buildings)) if (b.player === player) start.add(v);
  for (const [e, p] of Object.entries(roads)) if (p === player) topo.edges[e]?.vertices.forEach((v) => start.add(v));
  for (const v of start) {
    dist.set(v, 0);
    deque.push(v);
  }
  while (deque.length) {
    const v = deque.shift()!;
    const d = dist.get(v)!;
    const occ = buildings[v];
    if (occ && occ.player !== player) continue; // blocked: can't road through
    for (const e of topo.vertices[v].edges) {
      const owner = roads[e];
      if (owner && owner !== player) continue;
      const u = topo.edges[e].vertices.find((x) => x !== v)!;
      const nd = d + (owner === player ? 0 : 1);
      if (nd > 4 || nd >= (dist.get(u) ?? Infinity)) continue;
      dist.set(u, nd);
      if (owner === player) deque.unshift(u);
      else deque.push(u);
    }
  }
  return dist;
}

/** Best corners a player can reach with a few roads, best value per road first. */
export function expansionSpots(state: GameState, player: PlayerId, top = 5): ExpansionSpot[] {
  const topo = topologyFor(state.board.layout);
  const ctx = scoreContext(state, player);
  const mine = roadDistances(state, player);
  const others = state.players.filter((p) => p.id !== player).map((p) => roadDistances(state, p.id));
  const out: ExpansionSpot[] = [];
  for (const v of Object.keys(topo.vertices)) {
    const d = mine.get(v);
    if (d === undefined || !isOpenCorner(state, v)) continue;
    // A settlement needs one of our roads touching it: a corner we only reach
    // through a building of ours (d = 0, no road) still needs one road.
    const touchesRoad = topo.vertices[v].edges.some((e) => state.pieces.roads[e] === player);
    const roads = d === 0 && !touchesRoad ? 1 : d;
    const sc = scoreCorner(state.board, v, ctx);
    if (sc.pips === 0 && !sc.port) continue;
    const contested = others.some((o) => (o.get(v) ?? Infinity) <= roads);
    out.push({ ...sc, roads, nextRoad: roads > 0 ? firstRoadToward(state, player, v, mine) : undefined, contested });
  }
  return out.sort((a, b) => b.score / (1 + 0.45 * b.roads) - a.score / (1 + 0.45 * a.roads)).slice(0, top);
}

/** Walk back from the target along decreasing distance to find the first unbuilt road. */
function firstRoadToward(state: GameState, player: PlayerId, target: VertexId, dist: Map<VertexId, number>): EdgeId | undefined {
  const topo = topologyFor(state.board.layout);
  let v = target;
  let lastFree: EdgeId | undefined;
  for (let guard = 0; guard < 12; guard++) {
    const d = dist.get(v);
    if (d === undefined) return lastFree;
    if (d === 0) {
      // Target touching our network but with no road of ours on it: any free edge
      // from a network corner to it works.
      if (lastFree) return lastFree;
      return topo.vertices[v].edges.find((e) => !state.pieces.roads[e] && topo.edges[e].vertices.some((u) => u !== v && dist.get(u) === 0));
    }
    let step: { e: EdgeId; u: VertexId } | undefined;
    for (const e of topo.vertices[v].edges) {
      const owner = state.pieces.roads[e];
      if (owner && owner !== player) continue;
      const u = topo.edges[e].vertices.find((x) => x !== v)!;
      const occ = state.pieces.buildings[u];
      if (occ && occ.player !== player) continue;
      const du = dist.get(u);
      if (du === undefined) continue;
      const cost = owner === player ? 0 : 1;
      if (du + cost === d) {
        step = { e, u };
        if (cost === 1) break;
      }
    }
    if (!step) return lastFree;
    if (!state.pieces.roads[step.e]) lastFree = step.e;
    v = step.u;
  }
  return lastFree;
}

export interface BuildOption {
  kind: BuildKind;
  /** 'now' = you have the cards, 'trade' = reachable with bank/harbor trades, 'need' = missing cards. */
  status: 'now' | 'trade' | 'need' | 'blocked';
  missing: ResourceCounts;
  trades: Trade[];
  where?: VertexId | EdgeId;
  why: string;
  /** Higher = better move. */
  value: number;
}

const count = (c: Partial<ResourceCounts>) => RESOURCES.reduce((s, r) => s + (c[r] ?? 0), 0);

/** What `player` (normally me) should build next, best first. */
export function buildOptions(state: GameState, player: PlayerId): BuildOption[] {
  const hand = state.hands[player]?.resources ?? emptyResources();
  const rates = tradeRates(state, player);
  const ctx = scoreContext(state, player);
  const mine = Object.entries(state.pieces.buildings).filter(([, b]) => b.player === player);
  const settlements = mine.filter(([, b]) => b.kind === 'settlement');
  const left = piecesLeft(state, player);
  const spots = expansionSpots(state, player, 8);
  const income = playerProduction(state, player);

  const option = (kind: BuildKind, value: number, why: string, where?: string, blockedWhy?: string): BuildOption => {
    const cost = COSTS[kind];
    const missing = emptyResources();
    for (const r of RESOURCES) missing[r] = Math.max(0, (cost[r] ?? 0) - hand[r]);
    if (blockedWhy) return { kind, status: 'blocked', missing, trades: [], where, why: blockedWhy, value: -1 };
    const short = count(missing);
    const trades = short ? tradesFor(hand, cost, rates) : [];
    const status = short === 0 ? 'now' : trades ? 'trade' : 'need';
    // Prefer things we can do now; trades cost a little value.
    const adj = status === 'now' ? 3 : status === 'trade' ? 1.5 - 0.3 * (trades?.length ?? 0) : -short * 0.8;
    return { kind, status, missing, trades: trades ?? [], where, why, value: value + adj };
  };

  const out: BuildOption[] = [];

  // City: upgrade the settlement with the most production.
  const bestCity = settlements
    .map(([v]) => ({ v, sc: scoreCorner(state.board, v, { ...ctx, owned: income }) }))
    .sort((a, b) => b.sc.score - a.sc.score)[0];
  if (!bestCity) out.push(option('city', 0, '', undefined, 'No settlement to upgrade yet.'));
  else if (left.city <= 0) out.push(option('city', 0, '', undefined, 'All 4 cities are on the board.'));
  else out.push(option('city', 1 + bestCity.sc.pips * 0.6, `Doubles ${bestCity.sc.pips} pips of production and +1 point.`, bestCity.v));

  // Settlement: best spot reachable with no new road.
  const ready = spots.find((s) => s.roads === 0 && checkBuilding(state, s.vertex, player, 'settlement').length === 0);
  if (left.settlement <= 0) out.push(option('settlement', 0, '', undefined, 'All 5 settlements are on the board. Build a city to free one.'));
  else if (!ready) out.push(option('settlement', 0, '', undefined, spots.length ? 'No open spot on your roads yet. Build a road first.' : 'No open spot you can reach.'));
  else out.push(option('settlement', 2 + ready.score * 0.6, `New corner with ${ready.pips} pips${ready.newResources.length ? `, adds ${ready.newResources.join(', ')}` : ''} and +1 point.`, ready.vertex));

  // Road: toward the best spot that still needs roads.
  const target = spots.find((s) => s.roads > 0 && s.nextRoad);
  if (left.road <= 0) out.push(option('road', 0, '', undefined, 'All 15 roads are on the board.'));
  else if (!target) out.push(option('road', 0.5, 'Mostly for longest road; no good spot to head for.'));
  else
    out.push(
      option(
        'road',
        (target.score * 0.5) / target.roads - (ready ? 1.5 : 0) + (target.contested ? 1 : 0),
        `Toward a ${target.pips}-pip spot, ${target.roads} road${target.roads > 1 ? 's' : ''} away${target.contested ? ' (an opponent can reach it too)' : ''}.`,
        target.nextRoad,
      ),
    );

  // Dev card: steady value; better with ore/wheat income and nothing else to build.
  out.push(option('devCard', 3 + (income.ore + income.wheat) * 0.05, 'Knight (move the robber), progress card or a hidden point.'));

  const rank = { now: 0, trade: 1, need: 2, blocked: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.value - a.value);
}

export interface RobberTarget {
  hex: HexId;
  score: number;
  /** Pips (×2 for cities) taken from each opponent. */
  hits: Array<{ player: PlayerId; pips: number }>;
  /** Our own pips it would block (bad). */
  selfPips: number;
  /** Who to steal from: the victim with the most cards, ties to the leader. */
  stealFrom?: PlayerId;
}


const handSize = (state: GameState, p: PlayerId) => {
  const h = state.hands[p];
  return h ? RESOURCES.reduce((s, r) => s + h.resources[r], 0) + h.unknown : 0;
};

/** Best hexes to put the robber on, best first. */
export function robberTargets(state: GameState, player: PlayerId, top = 3): RobberTarget[] {
  const topo = topologyFor(state.board.layout);
  const holder = longestRoadHolder(state);
  const points = (p: PlayerId) => boardPoints(state, p, holder);
  const myPoints = points(player);
  const out: RobberTarget[] = [];
  for (const id of topo.hexes) {
    const h = state.board.hexes[id];
    if (id === state.robber || !h || !isResource(h.terrain) || !h.number) continue;
    const p = pips(h.number);
    const byPlayer = new Map<PlayerId, number>();
    for (const v of Object.keys(topo.vertices)) {
      const b = state.pieces.buildings[v];
      if (!b || !topo.vertices[v].hexes.includes(id)) continue;
      byPlayer.set(b.player, (byPlayer.get(b.player) ?? 0) + p * (b.kind === 'city' ? 2 : 1));
    }
    const selfPips = byPlayer.get(player) ?? 0;
    byPlayer.delete(player);
    if (!byPlayer.size) continue;
    let score = -selfPips * 1.5;
    const hits: RobberTarget['hits'] = [];
    for (const [op, n] of byPlayer) {
      const lead = points(op) - myPoints;
      score += n * (1 + Math.max(-0.3, 0.15 * lead));
      hits.push({ player: op, pips: n });
    }
    const victims = [...byPlayer.keys()].sort((a, b) => handSize(state, b) - handSize(state, a) || points(b) - points(a));
    score += Math.min(handSize(state, victims[0]), 7) * 0.3;
    out.push({ hex: id, score, hits: hits.sort((a, b) => b.pips - a.pips), selfPips, stealFrom: victims[0] });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, top);
}

/** Expected cards per resource per 36 rolls is just pips; this gives per-roll averages. */
export function expectedPerRoll(state: GameState, player: PlayerId): ResourceCounts {
  const p = playerProduction(state, player);
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = p[r] / 36;
  return out;
}
