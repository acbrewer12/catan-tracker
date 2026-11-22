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
import { DEFAULT_RULES, type Building, type BuildingKind, type EdgeId, type GameState, type HexId, type PlayerId, type Rules, type VertexId } from './types';

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

/** The table's rules with defaults filled in. */
export function rulesOf(s: GameState): Rules {
  return { ...DEFAULT_RULES, ...s.rules };
}

export type FirstPlayerStatus =
  | { decided: true; player: PlayerId }
  /** Still rolling: `waiting` must (re)roll. `tied` is set once a re-roll is needed. */
  | { decided: false; waiting: PlayerId[]; tied: PlayerId[] };

/** Players oldest to youngest (anyone not ranked yet goes last, in seating order). */
export function ageOrderOf(s: GameState): PlayerId[] {
  const ids = s.players.map((p) => p.id);
  const ranked = rulesOf(s).ageOrder.filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
  return [...ranked, ...ids.filter((id) => !ranked.includes(id))];
}

/**
 * Who goes first. 'list': the oldest player. 'dice': highest roll; players
 * tied for highest roll again until one is ahead.
 */
export function firstPlayer(s: GameState): FirstPlayerStatus {
  const ids = s.players.map((p) => p.id);
  const { firstPlayerBy, startRolls } = rulesOf(s);
  if (!ids.length) return { decided: false, waiting: [], tied: [] };
  if (firstPlayerBy !== 'dice') return { decided: true, player: ageOrderOf(s)[0] };
  let alive = ids;
  for (let round = 0; ; round++) {
    const waiting = alive.filter((id) => startRolls[id]?.[round] === undefined);
    if (waiting.length) return { decided: false, waiting, tied: round ? alive : [] };
    const max = Math.max(...alive.map((id) => startRolls[id][round]));
    const top = alive.filter((id) => startRolls[id][round] === max);
    if (top.length === 1) return { decided: true, player: top[0] };
    alive = top;
  }
}

/**
 * Normal turn order: from the first player, clockwise round the table
 * (Players list = seating order). Before the dice decide, starts at the top.
 */
export function turnOrder(s: GameState): PlayerId[] {
  const ids = s.players.map((p) => p.id);
  const f = firstPlayer(s);
  const start = f.decided ? Math.max(0, ids.indexOf(f.player)) : 0;
  return [...ids.slice(start), ...ids.slice(0, start)];
}

/**
 * Who places in each of the 2N opening picks, then back the other way.
 * Oldest-first: by age, oldest to youngest. Dice: clockwise from the winner.
 */
export function openingSequence(s: GameState): PlayerId[] {
  const round = rulesOf(s).firstPlayerBy === 'dice' ? turnOrder(s) : ageOrderOf(s);
  return [...round, ...[...round].reverse()];
}

/**
 * Whose opening pick it is and what they place next, or null once everyone
 * has 2 settlements and 2 roads.
 */
export function openingTurn(s: GameState): { player: PlayerId; place: 'settlement' | 'road' } | null {
  const n = s.players.length;
  if (!n) return null;
  const seq = openingSequence(s);
  for (let k = 0; k < 2 * n; k++) {
    const p = { id: seq[k] };
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
