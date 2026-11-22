/**
 * Board shapes and the tile / number / harbor counts each one uses.
 * Add a new layout here (e.g. a seafarers scenario) and the rest of the app
 * picks it up: the editor, topology and validation are all data-driven.
 */
import { hexId } from './geometry';
import type { HexId, LayoutId, PortKind, Terrain } from './types';

export interface LayoutSpec {
  id: LayoutId;
  label: string;
  players: string;
  /** Land hexes in reading order (top row left to right, then down). */
  hexes: HexId[];
  terrain: Record<Terrain, number>;
  /** Number tokens, one entry per token. */
  numbers: number[];
  ports: Record<PortKind, number>;
}

/** Rows of a board: [r, firstQ, length]. */
function rows(spec: Array<[number, number, number]>): HexId[] {
  return spec.flatMap(([r, q0, n]) => Array.from({ length: n }, (_, i) => hexId(q0 + i, r)));
}

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    players: '3-4 players',
    hexes: rows([[-2, 0, 3], [-1, -1, 4], [0, -2, 5], [1, -2, 4], [2, -2, 3]]),
    terrain: { wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3, desert: 1 },
    numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    ports: { any: 4, wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 },
  },
  extended: {
    id: 'extended',
    label: 'Extended',
    players: '5-6 players',
    hexes: rows([[-3, 0, 3], [-2, -1, 4], [-1, -2, 5], [0, -3, 6], [1, -3, 5], [2, -3, 4], [3, -3, 3]]),
    terrain: { wood: 6, brick: 5, sheep: 6, wheat: 6, ore: 5, desert: 2 },
    numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    ports: { any: 5, wood: 1, brick: 1, sheep: 2, wheat: 1, ore: 1 },
  },
};

export const totalPorts = (l: LayoutSpec) => Object.values(l.ports).reduce((a, b) => a + b, 0);
