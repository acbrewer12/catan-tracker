/**
 * Corner scoring and starting-placement advice. Pure functions, no React.
 *
 * A corner's value mixes:
 *   - production: pips of each touching hex, weighted by how scarce that
 *     resource is on this board (few ore pips -> ore pips are worth more)
 *   - diversity: a bonus for resources the player doesn't produce yet
 *   - harbors: 2:1 harbors are worth more when you produce that resource
 *   - a small penalty for two hexes with the same number (feast or famine)
 * The weights are hand-tuned heuristics, not a solver.
 */
import { pips, portAtVertex, topologyFor } from './board';
import type { Board, GameState, Hex, PlayerId, Port, Resource, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';
import { openingSequence } from './pieces';

/** Rough early-game importance of each resource (roads and settlements first). */
const BASE_WEIGHT: ResourceCounts = { wood: 1, brick: 1, sheep: 0.85, wheat: 1.05, ore: 0.95 };

export const isResource = (t: Hex['terrain']): t is Resource => !!t && t !== 'desert';

/** Total pips per resource on the whole board. */
export function resourcePips(board: Board): ResourceCounts {
  const c = emptyResources();
  for (const h of Object.values(board.hexes)) if (isResource(h.terrain)) c[h.terrain] += pips(h.number);
  return c;
}

/** Scarcity multiplier per resource: sqrt(average pips / this resource's pips), clamped. */
export function scarcityWeights(board: Board): ResourceCounts {
  const rp = resourcePips(board);
  const avg = RESOURCES.reduce((s, r) => s + rp[r], 0) / RESOURCES.length || 1;
  const w = emptyResources();
  for (const r of RESOURCES) w[r] = rp[r] ? Math.min(1.5, Math.max(0.75, Math.sqrt(avg / rp[r]))) : 1.5;
  return w;
}

/** Pips per resource produced by one corner. `blocked` hexes (robber) count for nothing. */
export function vertexProduction(board: Board, v: VertexId, blocked?: string | null): ResourceCounts {
  const c = emptyResources();
  for (const id of topologyFor(board.layout).vertices[v]?.hexes ?? []) {
    const h = board.hexes[id];
    if (h && isResource(h.terrain) && id !== blocked) c[h.terrain] += pips(h.number);
  }
  return c;
}

/** Pips per resource a player collects from all their buildings (cities count double). */
export function playerProduction(state: GameState, player: PlayerId, ignoreRobber = false): ResourceCounts {
  const c = emptyResources();
  for (const [v, b] of Object.entries(state.pieces.buildings)) {
    if (b.player !== player) continue;
    const p = vertexProduction(state.board, v, ignoreRobber ? null : state.robber);
    for (const r of RESOURCES) c[r] += p[r] * (b.kind === 'city' ? 2 : 1);
  }
  return c;
}

/**
 * A guess at how many resource cards an opponent holds, from public info
 * only (their card count isn't tracked): about a round and a half of what
 * their buildings produce, between 1 and 7, or 0 if they produce nothing.
 */
export function typicalHandSize(state: GameState, player: PlayerId): number {
  const inc = playerProduction(state, player, true);
  const perRound = (RESOURCES.reduce((s, r) => s + inc[r], 0) / 36) * state.players.length;
  return perRound > 0 ? Math.max(1, Math.min(7, Math.round(perRound * 1.5))) : 0;
}

/**
 * Distance rule only: the corner is free and no neighbour has a building.
 * Used to score hypothetical spots for any player; for a real legality check
 * use checkBuilding in model/pieces.ts.
 */
export function isOpenCorner(state: GameState, v: VertexId): boolean {
  const info = topologyFor(state.board.layout).vertices[v];
  if (!info || state.pieces.buildings[v]) return false;
  return info.adjacent.every((u) => !state.pieces.buildings[u]);
}

export interface CornerScore {
  vertex: VertexId;
  score: number;
  pips: number;
  production: ResourceCounts;
  port?: Port;
  /** Resources here that the player doesn't produce yet. */
  newResources: Resource[];
  reasons: string[];
}

export interface ScoreContext {
  weights: ResourceCounts;
  /** Pips the player already makes per resource (to value diversity / harbors). */
  owned: ResourceCounts;
  /** Robber hex: its production is counted at half (it will usually move). */
  robber?: string | null;
  /** Numbers the player's buildings already sit on (to spread rolls). */
  ownedNumbers?: number[];
}

function ownedNumbers(state: GameState, player: PlayerId): number[] {
  const topo = topologyFor(state.board.layout);
  const out: number[] = [];
  for (const [v, b] of Object.entries(state.pieces.buildings)) {
    if (b.player !== player) continue;
    for (const id of topo.vertices[v]?.hexes ?? []) {
      const h = state.board.hexes[id];
      if (h?.number && isResource(h.terrain)) out.push(h.number);
    }
  }
  return out;
}

/** Resource pairs that build things: wood+brick (roads, settlements), ore+wheat (cities, dev cards). */
const PAIRS: Array<[Resource, Resource, string]> = [
  ['wood', 'brick', 'wood + brick for roads and settlements'],
  ['ore', 'wheat', 'ore + wheat for cities'],
];

export function scoreContext(state: GameState, player: PlayerId | null): ScoreContext {
  return {
    weights: scarcityWeights(state.board),
    owned: player ? playerProduction(state, player, true) : emptyResources(),
    robber: state.phase === 'playing' ? state.robber : null,
    ownedNumbers: player ? ownedNumbers(state, player) : [],
  };
}

const RES_LABEL: Record<Resource, string> = { wood: 'wood', brick: 'brick', sheep: 'sheep', wheat: 'wheat', ore: 'ore' };

export function scoreCorner(board: Board, v: VertexId, ctx: ScoreContext): CornerScore {
  const topo = topologyFor(board.layout);
  const hexes = (topo.vertices[v]?.hexes ?? []).map((id) => board.hexes[id]).filter(Boolean);
  const production = emptyResources();
  let score = 0;
  let total = 0;
  const reasons: string[] = [];
  const numbers: number[] = [];
  for (const h of hexes) {
    if (!isResource(h.terrain) || !h.number) continue;
    const p = pips(h.number);
    production[h.terrain] += p;
    total += p;
    numbers.push(h.number);
    score += p * BASE_WEIGHT[h.terrain] * ctx.weights[h.terrain] * (h.id === ctx.robber ? 0.5 : 1);
  }
  const here = RESOURCES.filter((r) => production[r] > 0);
  const newResources = here.filter((r) => ctx.owned[r] === 0);
  score += newResources.length * 1.2;
  if (here.length === 3) reasons.push('3 different resources');
  if (newResources.length && RESOURCES.some((r) => ctx.owned[r] > 0)) reasons.push(`adds ${newResources.map((r) => RES_LABEL[r]).join(', ')}`);
  const scarce = here.filter((r) => ctx.weights[r] >= 1.2);
  if (scarce.length) reasons.push(`${scarce.map((r) => RES_LABEL[r]).join(', ')} is scarce on this board`);

  if (new Set(numbers).size < numbers.length) {
    score -= 1;
    reasons.push('repeats a number');
  }
  // Spread your numbers: a number you already sit on adds a burst, not a new roll that pays.
  const shared = numbers.filter((x) => ctx.ownedNumbers?.includes(x)).length;
  if (shared) {
    score -= 0.4 * shared;
    if (shared === numbers.length && numbers.length > 1) reasons.push('same numbers as your other settlement');
  }

  // Coherence: completing a pair you can build with is worth more than a stray resource.
  for (const [a, b, label] of PAIRS) {
    const had = ctx.owned[a] > 0 && ctx.owned[b] > 0;
    const has = ctx.owned[a] + production[a] > 0 && ctx.owned[b] + production[b] > 0;
    if (!had && has) {
      score += production[a] && production[b] ? 0.6 : 0.9;
      if (RESOURCES.some((r) => ctx.owned[r] > 0)) reasons.push(`completes ${label}`);
      else if (production[a] && production[b]) reasons.push(label);
    }
  }

  // Harbors are worth what you can feed them.
  const port = portAtVertex(board, v);
  if (port) {
    const made = RESOURCES.reduce((sum, r) => sum + ctx.owned[r] + production[r], 0);
    if (port.kind === 'any') {
      score += Math.min(1.2, 0.3 + made * 0.04);
      reasons.push('3:1 harbor');
    } else {
      const feed = ctx.owned[port.kind] + production[port.kind];
      score += Math.min(2, 0.15 + feed * 0.3);
      reasons.push(feed >= 4 ? `2:1 ${RES_LABEL[port.kind]} harbor you'd feed` : feed ? `2:1 ${RES_LABEL[port.kind]} harbor (little ${RES_LABEL[port.kind]} yet)` : `2:1 ${RES_LABEL[port.kind]} harbor (you make no ${RES_LABEL[port.kind]})`);
    }
  }
  if (total >= 11) reasons.unshift(`${total} pips`);
  return { vertex: v, score, pips: total, production, port, newResources, reasons };
}

/** Every open corner (distance rule), best first. */
export function rankCorners(state: GameState, player: PlayerId | null, filter?: (v: VertexId) => boolean): CornerScore[] {
  const ctx = scoreContext(state, player);
  return Object.keys(topologyFor(state.board.layout).vertices)
    .filter((v) => isOpenCorner(state, v) && (!filter || filter(v)))
    .map((v) => scoreCorner(state.board, v, ctx))
    .filter((s) => s.pips > 0 || s.port)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Snake draft

/** Setup pick order (each pick = one settlement + road), from the chosen first player. */
export const placementOrder = (state: GameState): PlayerId[] => openingSequence(state);

export interface PlacementAdvice {
  /** Index into the snake order of the next pick, or null when setup is over. */
  pickIndex: number | null;
  /** Who picks next. */
  nextPlayer: PlayerId | null;
  /** My remaining pick indices. */
  myPicks: number[];
  /** Opponent picks before my next one. */
  picksBeforeMine: number;
  /** Best corners for my next pick, best first (top N). */
  ranked: Array<CornerScore & { combo?: number; pairedWith?: VertexId; road?: string; likelyGone?: boolean }>;
  /** Corners opponents are predicted to take before my next pick. */
  likelyTaken: VertexId[];
}

/** Greedy stand-in for opponents: each takes the best corner for themselves. */
function simulatePicks(state: GameState, order: PlayerId[], from: number, to: number): { state: GameState; taken: VertexId[] } {
  let s = state;
  const taken: VertexId[] = [];
  for (let i = from; i < to; i++) {
    const best = rankCorners(s, order[i])[0];
    if (!best) break;
    taken.push(best.vertex);
    s = withBuilding(s, best.vertex, order[i]);
  }
  return { state: s, taken };
}

function withBuilding(s: GameState, v: VertexId, player: PlayerId): GameState {
  return { ...s, pieces: { ...s.pieces, buildings: { ...s.pieces.buildings, [v]: { player, kind: 'settlement' } } } };
}

/**
 * Best starting road from a new settlement: toward the best open corner two
 * steps away (the next settlement spot), ignoring edges already taken.
 */
export function bestStartingRoad(state: GameState, v: VertexId, player: PlayerId): { edge: string; toward: VertexId | null } | null {
  const topo = topologyFor(state.board.layout);
  const s = state.pieces.buildings[v] ? state : withBuilding(state, v, player);
  const ctx = scoreContext(s, player);
  let best: { edge: string; toward: VertexId | null; score: number } | null = null;
  for (const e of topo.vertices[v].edges) {
    if (s.pieces.roads[e]) continue;
    const u = topo.edges[e].vertices.find((x) => x !== v)!;
    if (s.pieces.buildings[u] && s.pieces.buildings[u].player !== player) continue;
    for (const w of topo.vertices[u].adjacent) {
      if (w === v || !isOpenCorner(s, w)) continue;
      const sc = scoreCorner(s.board, w, ctx).score;
      if (!best || sc > best.score) best = { edge: e, toward: w, score: sc };
    }
    if (!best) best = { edge: e, toward: null, score: -1 };
  }
  return best && { edge: best.edge, toward: best.toward };
}

/** Advice for the setup phase from the current board and buildings. */
export function placementAdvice(state: GameState, top = 6): PlacementAdvice {
  const me = state.players.find((p) => p.isMe)?.id ?? null;
  const order = placementOrder(state);
  const placed = Object.keys(state.pieces.buildings).length;
  const pickIndex = placed < order.length ? placed : null;
  const myPicks = me ? order.map((p, i) => (p === me && i >= placed ? i : -1)).filter((i) => i >= 0) : [];
  const empty: PlacementAdvice = { pickIndex, nextPlayer: pickIndex === null ? null : order[pickIndex], myPicks, picksBeforeMine: 0, ranked: [], likelyTaken: [] };
  if (!me || !myPicks.length) return empty;

  const first = myPicks[0];
  const { state: atMyPick, taken: likelyTaken } = simulatePicks(state, order, placed, first);
  const gone = new Set(likelyTaken);

  // Rank on today's board, flag what will probably be gone by my turn.
  const ranked: PlacementAdvice['ranked'] = rankCorners(state, me).map((c) => ({ ...c, likelyGone: gone.has(c.vertex) }));

  // With a second pick still to come, value each candidate as a pair:
  // this corner + the best corner likely left at my next pick.
  if (myPicks.length === 2) {
    const candidates = rankCorners(atMyPick, me).slice(0, 10);
    for (const c of candidates) {
      const after = withBuilding(atMyPick, c.vertex, me);
      const { state: atSecond } = simulatePicks(after, order, first + 1, myPicks[1]);
      const second = rankCorners(atSecond, me)[0];
      const entry = ranked.find((r) => r.vertex === c.vertex);
      if (entry) {
        entry.combo = c.score + (second ? second.score * 0.9 : 0);
        entry.pairedWith = second?.vertex;
      }
    }
  }
  ranked.sort((a, b) => Number(!!a.likelyGone) - Number(!!b.likelyGone) || (b.combo ?? b.score - 100) - (a.combo ?? a.score - 100));
  const out = ranked.slice(0, top);
  for (const r of out) r.road = bestStartingRoad(state, r.vertex, me)?.edge;
  return { ...empty, picksBeforeMine: first - placed, ranked: out, likelyTaken };
}
