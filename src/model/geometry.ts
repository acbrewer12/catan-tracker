/**
 * Hex-grid geometry and board topology (corners, edges, adjacency).
 *
 * Pointy-top hexes in axial coordinates (q, r). Positions are in "hex units":
 * a hex has circumradius 1, so multiply by a pixel size when drawing.
 *
 * A corner is identified by the three hexes that meet there and an edge by the
 * two hexes it separates, including sea hexes. That gives every corner/edge on
 * any board shape a stable, readable ID without extra bookkeeping.
 */
import type { EdgeId, HexId, VertexId } from './types';

/** Neighbour directions, in order around the hex (consecutive ones touch). */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const hexId = (q: number, r: number): HexId => `${q},${r}`;

export function parseHexId(id: HexId): [number, number] {
  const [q, r] = id.split(',').map(Number);
  return [q, r];
}

export function neighbor(id: HexId, dir: number): HexId {
  const [q, r] = parseHexId(id);
  const [dq, dr] = DIRECTIONS[((dir % 6) + 6) % 6];
  return hexId(q + dq, r + dr);
}

export function hexCenter(id: HexId): { x: number; y: number } {
  const [q, r] = parseHexId(id);
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

export const vertexIdOf = (a: HexId, b: HexId, c: HexId): VertexId => [a, b, c].sort().join('|');
export const edgeIdOf = (a: HexId, b: HexId): EdgeId => [a, b].sort().join('|');

/** The hexes (land or sea) named by a corner or edge ID. */
export const hexesOf = (id: VertexId | EdgeId): HexId[] => id.split('|');

/** Corner k of a hex sits between neighbour k and neighbour k+1. */
export function hexCornerIds(id: HexId): VertexId[] {
  return DIRECTIONS.map((_, k) => vertexIdOf(id, neighbor(id, k), neighbor(id, k + 1)));
}

/** Edge k of a hex is shared with neighbour k. */
export function hexEdgeIds(id: HexId): EdgeId[] {
  return DIRECTIONS.map((_, k) => edgeIdOf(id, neighbor(id, k)));
}

/** A corner's position is the centroid of its three hex centres. */
export function vertexPosition(id: VertexId): { x: number; y: number } {
  const pts = hexesOf(id).map(hexCenter);
  return { x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3 };
}

export interface VertexInfo {
  id: VertexId;
  x: number;
  y: number;
  /** Land hexes touching this corner (1 to 3). */
  hexes: HexId[];
  /** Neighbouring corners along an edge (2 or 3), on-board only. */
  adjacent: VertexId[];
  edges: EdgeId[];
}

export interface EdgeInfo {
  id: EdgeId;
  vertices: [VertexId, VertexId];
  /** Land hexes on either side (1 or 2). */
  hexes: HexId[];
  /** Exactly one side is land: a harbor can go here. */
  coastal: boolean;
}

export interface Topology {
  hexes: HexId[];
  vertices: Record<VertexId, VertexInfo>;
  edges: Record<EdgeId, EdgeInfo>;
  /** Coastal edges walked in order around the island (for harbor placement). */
  coast: EdgeId[];
}

/** Build every corner/edge touching at least one of the given land hexes. */
export function buildTopology(land: HexId[]): Topology {
  const landSet = new Set(land);
  const vertices: Record<VertexId, VertexInfo> = {};
  const edges: Record<EdgeId, EdgeInfo> = {};

  for (const h of land) {
    const corners = hexCornerIds(h);
    corners.forEach((v) => {
      if (!vertices[v]) {
        const { x, y } = vertexPosition(v);
        vertices[v] = { id: v, x, y, hexes: hexesOf(v).filter((x) => landSet.has(x)), adjacent: [], edges: [] };
      }
    });
    hexEdgeIds(h).forEach((e, k) => {
      if (edges[e]) return;
      // Edge k lies between corner k-1 and corner k.
      const a = corners[(k + 5) % 6];
      const b = corners[k];
      const hs = hexesOf(e).filter((x) => landSet.has(x));
      edges[e] = { id: e, vertices: [a, b], hexes: hs, coastal: hs.length === 1 };
    });
  }
  for (const e of Object.values(edges)) {
    const [a, b] = e.vertices;
    vertices[a].edges.push(e.id);
    vertices[b].edges.push(e.id);
    vertices[a].adjacent.push(b);
    vertices[b].adjacent.push(a);
  }

  // Order coastal edges by angle around the board centre.
  const cx = land.reduce((s, h) => s + hexCenter(h).x, 0) / land.length;
  const cy = land.reduce((s, h) => s + hexCenter(h).y, 0) / land.length;
  const coast = Object.values(edges)
    .filter((e) => e.coastal)
    .map((e) => {
      const p = vertexPosition(e.vertices[0]);
      const q = vertexPosition(e.vertices[1]);
      return { id: e.id, a: Math.atan2((p.y + q.y) / 2 - cy, (p.x + q.x) / 2 - cx) };
    })
    .sort((m, n) => m.a - n.a)
    .map((e) => e.id);

  return { hexes: land, vertices, edges, coast };
}
