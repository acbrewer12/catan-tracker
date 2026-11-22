/**
 * Board creation, randomising, validation and read-only helpers that other
 * features (dice, suggestions) use: pips, what a corner produces, harbors.
 */
import { buildTopology, hexesOf, type Topology } from './geometry';
import { LAYOUTS, totalPorts } from './layouts';
import type { Board, EdgeId, Hex, HexId, LayoutId, Port, PortKind, Terrain, VertexId } from './types';

/** Dots on a number token = ways to roll it out of 36. */
export const pips = (n: number | null | undefined): number => (n ? 6 - Math.abs(7 - n) : 0);

/** Probability of a total on 2d6. */
export const rollChance = (n: number) => pips(n) / 36;

const topoCache = new Map<LayoutId, Topology>();
/** Topology depends only on the layout shape, so it's cached. */
export function topologyFor(layout: LayoutId): Topology {
  let t = topoCache.get(layout);
  if (!t) {
    t = buildTopology(LAYOUTS[layout].hexes);
    topoCache.set(layout, t);
  }
  return t;
}

/** Spread `count` harbors evenly around the coast. */
export function defaultPortEdges(layout: LayoutId, count = totalPorts(LAYOUTS[layout])): EdgeId[] {
  const coast = topologyFor(layout).coast;
  return Array.from({ length: count }, (_, i) => coast[Math.floor((i * coast.length) / count)]);
}

export function emptyBoard(layout: LayoutId = 'standard'): Board {
  const hexes: Record<HexId, Hex> = {};
  for (const id of LAYOUTS[layout].hexes) {
    const [q, r] = id.split(',').map(Number);
    hexes[id] = { id, q, r, terrain: null, number: null };
  }
  return { layout, hexes, ports: [] };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const expand = <K extends string>(counts: Record<K, number>): K[] =>
  (Object.entries(counts) as [K, number][]).flatMap(([k, n]) => Array(n).fill(k));

/**
 * A random legal-looking board: no two red numbers (6/8) touching.
 * Handy for trying the app without a real game in front of you.
 */
export function randomBoard(layout: LayoutId = 'standard', rand: () => number = Math.random): Board {
  const spec = LAYOUTS[layout];
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = emptyBoard(layout);
    const terrains = shuffle(expand(spec.terrain), rand);
    const numbers = shuffle(spec.numbers, rand);
    spec.hexes.forEach((id, i) => {
      board.hexes[id].terrain = terrains[i];
      if (terrains[i] !== 'desert') board.hexes[id].number = numbers.pop()!;
    });
    const kinds = shuffle(expand(spec.ports), rand);
    board.ports = defaultPortEdges(layout).map((edge, i) => ({ edge, kind: kinds[i] }));
    if (validateBoard(board).every((p) => p.level !== 'error' && p.code !== 'red-adjacent')) return board;
  }
  throw new Error('could not generate board');
}

export interface BoardProblem {
  level: 'error' | 'warning';
  code: string;
  message: string;
  hexes?: HexId[];
}

/** Check a board against its layout's counts. Empty array = ready to play. */
export function validateBoard(board: Board): BoardProblem[] {
  const spec = LAYOUTS[board.layout];
  const topo = topologyFor(board.layout);
  const out: BoardProblem[] = [];
  const hexes = Object.values(board.hexes);

  const missingTerrain = hexes.filter((h) => !h.terrain);
  if (missingTerrain.length)
    out.push({ level: 'error', code: 'missing-terrain', message: `${missingTerrain.length} tile(s) have no resource`, hexes: missingTerrain.map((h) => h.id) });

  const missingNumber = hexes.filter((h) => h.terrain && h.terrain !== 'desert' && !h.number);
  if (missingNumber.length)
    out.push({ level: 'error', code: 'missing-number', message: `${missingNumber.length} tile(s) have no number`, hexes: missingNumber.map((h) => h.id) });

  const tc = terrainCounts(board);
  for (const t of Object.keys(spec.terrain) as Terrain[]) {
    if (tc[t] > spec.terrain[t])
      out.push({ level: 'warning', code: 'terrain-count', message: `${tc[t]} ${t} tiles (usually ${spec.terrain[t]})` });
  }
  const nc = numberCounts(board);
  for (const n of new Set(spec.numbers)) {
    const want = spec.numbers.filter((x) => x === n).length;
    if ((nc[n] ?? 0) > want) out.push({ level: 'warning', code: 'number-count', message: `${nc[n]} × ${n} tokens (usually ${want})` });
  }

  const red = hexes.filter((h) => h.number === 6 || h.number === 8);
  const reds = new Set(red.map((h) => h.id));
  const touching = new Set<HexId>();
  for (const e of Object.values(topo.edges))
    if (e.hexes.length === 2 && reds.has(e.hexes[0]) && reds.has(e.hexes[1])) e.hexes.forEach((h) => touching.add(h));
  if (touching.size)
    out.push({ level: 'warning', code: 'red-adjacent', message: '6 and 8 tokens are next to each other (allowed, but unusual)', hexes: [...touching] });

  if (board.ports.length !== totalPorts(spec))
    out.push({ level: 'warning', code: 'port-count', message: `${board.ports.length} harbors placed (usually ${totalPorts(spec)})` });

  return out;
}

export function terrainCounts(board: Board): Record<Terrain, number> {
  const c: Record<Terrain, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, desert: 0 };
  for (const h of Object.values(board.hexes)) if (h.terrain) c[h.terrain]++;
  return c;
}

export function numberCounts(board: Board): Record<number, number> {
  const c: Record<number, number> = {};
  for (const h of Object.values(board.hexes)) if (h.number) c[h.number] = (c[h.number] ?? 0) + 1;
  return c;
}

/** Land hexes touching a corner. */
export function hexesAtVertex(board: Board, v: VertexId): Hex[] {
  return hexesOf(v).map((id) => board.hexes[id]).filter(Boolean);
}

/** Harbor available at a corner, if any. */
export function portAtVertex(board: Board, v: VertexId): Port | undefined {
  const topo = topologyFor(board.layout);
  return board.ports.find((p) => topo.edges[p.edge]?.vertices.includes(v));
}

/** Total pips at a corner: a quick "how productive is this spot" score. */
export const vertexPips = (board: Board, v: VertexId) => hexesAtVertex(board, v).reduce((s, h) => s + pips(h.number), 0);

/** Where the robber should start: the (first) desert. */
export const desertHex = (board: Board): HexId | null =>
  Object.values(board.hexes).find((h) => h.terrain === 'desert')?.id ?? null;

export const PORT_CYCLE: Array<PortKind | null> = [null, 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
