/**
 * Settlements, cities, roads and the robber: placement rules, piece limits,
 * longest road and "who is on this tile". Pure functions, no React, so the
 * dice and suggestions features can reuse them.
 *
 *   checkBuilding(state, vertex, player, 'settlement')  -> Problem[] ([] = legal)
 *   checkRoad(state, edge, player)                       -> Problem[]
 *   buildingsOnHex(state, hex)                           -> who collects when it rolls
 *   robberVictims(state, hex, thief)                     -> who can be stolen from
 *   longestRoad(state, player)                           -> length of their longest road
 */
import { topologyFor } from './board';
import type { Building, BuildingKind, EdgeId, GameState, HexId, PlayerId, VertexId } from './types';

/** Pieces each player owns in the box (same for the base game and the 5-6 extension). */
export const PIECE_LIMITS = { settlement: 5, city: 4, road: 15 } as const;
export type PieceKind = keyof typeof PIECE_LIMITS;

/** Roads needed before Longest Road counts. */
export const LONGEST_ROAD_MIN = 5;

export interface Problem {
  code: 'occupied' | 'too-close' | 'not-connected' | 'no-pieces' | 'needs-settlement' | 'not-own' | 'off-board';
  message: string;
}

export interface PieceCounts {
  settlement: number;
  city: number;
  road: number;
}

export function pieceCounts(s: GameState, player: PlayerId): PieceCounts {
  const c = { settlement: 0, city: 0, road: 0 };
  for (const b of Object.values(s.pieces.buildings)) if (b.player === player) c[b.kind]++;
  for (const p of Object.values(s.pieces.roads)) if (p === player) c.road++;
  return c;
}

export function piecesLeft(s: GameState, player: PlayerId): PieceCounts {
  const c = pieceCounts(s, player);
  return { settlement: PIECE_LIMITS.settlement - c.settlement, city: PIECE_LIMITS.city - c.city, road: PIECE_LIMITS.road - c.road };
}

/**
 * The player's first two settlements (the opening round) don't need a road.
 * Opening roads must touch one of their buildings, which checkRoad covers.
 */
export function inOpeningRound(s: GameState, player: PlayerId): boolean {
  const c = pieceCounts(s, player);
  return c.settlement + c.city < 2;
}

/** Can `player` put a `kind` on corner `vertex`? Empty list = yes. `ignore` lets a move skip the piece being moved. */
export function checkBuilding(
  s: GameState,
  vertex: VertexId,
  player: PlayerId,
  kind: BuildingKind,
  ignore?: VertexId,
): Problem[] {
  const topo = topologyFor(s.board.layout);
  const v = topo.vertices[vertex];
  if (!v) return [{ code: 'off-board', message: 'That corner is not on this board.' }];
  const out: Problem[] = [];
  const here = vertex === ignore ? undefined : s.pieces.buildings[vertex];
  const left = piecesLeft(s, player);

  if (kind === 'city') {
    if (!here || here.kind !== 'settlement') out.push({ code: 'needs-settlement', message: 'A city replaces one of your settlements.' });
    else if (here.player !== player) out.push({ code: 'not-own', message: "That settlement belongs to someone else." });
    if (left.city <= 0) out.push({ code: 'no-pieces', message: `All ${PIECE_LIMITS.city} cities are already on the board.` });
    return out;
  }

  if (here) out.push({ code: 'occupied', message: 'There is already a building there.' });
  if (v.adjacent.some((a) => a !== ignore && s.pieces.buildings[a]))
    out.push({ code: 'too-close', message: 'Too close: settlements need at least two road lengths between them.' });
  if (!inOpeningRound(s, player) && !v.edges.some((e) => s.pieces.roads[e] === player))
    out.push({ code: 'not-connected', message: 'Not connected to one of their roads.' });
  if (left.settlement <= 0 && !(ignore && s.pieces.buildings[ignore]?.kind === 'settlement'))
    out.push({ code: 'no-pieces', message: `All ${PIECE_LIMITS.settlement} settlements are already on the board.` });
  return out;
}

/** Can `player` build a road on `edge`? Empty list = yes. */
export function checkRoad(s: GameState, edge: EdgeId, player: PlayerId, ignore?: EdgeId): Problem[] {
  const topo = topologyFor(s.board.layout);
  const e = topo.edges[edge];
  if (!e) return [{ code: 'off-board', message: 'That edge is not on this board.' }];
  const out: Problem[] = [];
  if (edge !== ignore && s.pieces.roads[edge]) out.push({ code: 'occupied', message: 'There is already a road there.' });

  const connected = e.vertices.some((v) => {
    const b = s.pieces.buildings[v];
    if (b?.player === player) return true;
    if (b) return false; // an opponent's building blocks the way through
    return topo.vertices[v].edges.some((o) => o !== edge && o !== ignore && s.pieces.roads[o] === player);
  });
  if (!connected) out.push({ code: 'not-connected', message: 'Not connected to their roads or buildings.' });

  if (piecesLeft(s, player).road <= 0 && !(ignore && s.pieces.roads[ignore] === player))
    out.push({ code: 'no-pieces', message: `All ${PIECE_LIMITS.road} roads are already on the board.` });
  return out;
}

/** Land hexes that the robber may move to (any hex except where it is now). */
export function robberTargets(s: GameState): HexId[] {
  return Object.keys(s.board.hexes).filter((h) => h !== s.robber);
}

/** Every building touching a hex: who collects (1 per settlement, 2 per city) when it rolls. */
export function buildingsOnHex(s: GameState, hex: HexId): Array<Building & { vertex: VertexId }> {
  const topo = topologyFor(s.board.layout);
  return Object.entries(s.pieces.buildings)
    .filter(([v]) => topo.vertices[v]?.hexes.includes(hex))
    .map(([vertex, b]) => ({ ...b, vertex }));
}

/** Players (other than the thief) with a building on the hex, in turn order. */
export function robberVictims(s: GameState, hex: HexId, thief?: PlayerId): PlayerId[] {
  const on = new Set(buildingsOnHex(s, hex).map((b) => b.player));
  return s.players.map((p) => p.id).filter((id) => id !== thief && on.has(id));
}

/** Length of the player's longest continuous road. Opponents' buildings break a road. */
export function longestRoad(s: GameState, player: PlayerId): number {
  const topo = topologyFor(s.board.layout);
  const mine = Object.keys(s.pieces.roads).filter((e) => s.pieces.roads[e] === player && topo.edges[e]);
  let best = 0;
  const used = new Set<EdgeId>();

  function walk(at: VertexId, length: number) {
    best = Math.max(best, length);
    const b = s.pieces.buildings[at];
    if (b && b.player !== player && length > 0) return;
    for (const e of topo.vertices[at].edges) {
      if (used.has(e) || s.pieces.roads[e] !== player) continue;
      used.add(e);
      const [a, c] = topo.edges[e].vertices;
      walk(a === at ? c : a, length + 1);
      used.delete(e);
    }
  }
  for (const e of mine) for (const v of topo.edges[e].vertices) walk(v, 0);
  return best;
}

/**
 * Who holds Longest Road. Approximation: the longest road of at least 5; on a
 * tie we can't tell who got there first, so we keep `current` if they're tied,
 * otherwise nobody.
 */
export function longestRoadHolder(s: GameState, current?: PlayerId | null): PlayerId | null {
  const lengths = s.players.map((p) => ({ id: p.id, n: longestRoad(s, p.id) }));
  const max = Math.max(0, ...lengths.map((l) => l.n));
  if (max < LONGEST_ROAD_MIN) return null;
  const top = lengths.filter((l) => l.n === max).map((l) => l.id);
  if (top.length === 1) return top[0];
  return current && top.includes(current) ? current : null;
}

/** Victory points visible on the board: settlements, cities and Longest Road (not dev cards or Largest Army). */
export function boardPoints(s: GameState, player: PlayerId, holder = longestRoadHolder(s)): number {
  const c = pieceCounts(s, player);
  return c.settlement + 2 * c.city + (holder === player ? 2 : 0);
}

/**
 * Opening round order: 1..N then N..1. Returns whose turn it is and what they
 * place next, or null once everyone has 2 settlements and 2 roads.
 */
export function openingTurn(s: GameState): { player: PlayerId; place: 'settlement' | 'road' } | null {
  const n = s.players.length;
  if (!n) return null;
  for (let k = 0; k < 2 * n; k++) {
    const p = s.players[k < n ? k : 2 * n - 1 - k];
    const round = k < n ? 1 : 2;
    const c = pieceCounts(s, p.id);
    const buildings = c.settlement + c.city;
    if (buildings < round) return { player: p.id, place: 'settlement' };
    if (c.road < round) return { player: p.id, place: 'road' };
  }
  return null;
}

/** All corners where `player` could legally build a settlement right now. */
export function legalSettlementSpots(s: GameState, player: PlayerId): VertexId[] {
  return Object.keys(topologyFor(s.board.layout).vertices).filter((v) => checkBuilding(s, v, player, 'settlement').length === 0);
}

/** All edges where `player` could legally build a road right now. */
export function legalRoadSpots(s: GameState, player: PlayerId): EdgeId[] {
  return Object.keys(topologyFor(s.board.layout).edges).filter((e) => checkRoad(s, e, player).length === 0);
}

export const pieceLabel = (k: PieceKind) => ({ settlement: 'settlement', city: 'city', road: 'road' })[k];
