/**
 * Shared game-state model for the tracker.
 *
 * Every feature (board input, pieces, dice, hands, suggestions) reads and
 * writes this one `GameState` object. See ARCHITECTURE.md for how to extend it.
 *
 * ID conventions (all plain strings so they work as object keys / JSON):
 *   HexId    "q,r"                  axial coordinates of a hex (pointy-top)
 *   VertexId "q,r|q,r|q,r"          the 3 hexes meeting at a corner, sorted
 *   EdgeId   "q,r|q,r"              the 2 hexes on either side of an edge, sorted
 * Sea / off-board hexes take part in IDs too, so coastal corners and edges
 * have stable IDs. See model/geometry.ts.
 */

export type HexId = string;
export type VertexId = string;
export type EdgeId = string;
export type PlayerId = string;

/** The five tradable resources. */
export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];

/**
 * What a land hex produces. 'desert' produces nothing.
 * Room to grow: 'gold' and 'sea' are reserved for a future seafarers-style mode.
 */
export type Terrain = Resource | 'desert';

export type ResourceCounts = Record<Resource, number>;

export interface Hex {
  id: HexId;
  q: number;
  r: number;
  /** null = not entered yet */
  terrain: Terrain | null;
  /** 2..12 (never 7). null = none yet, or desert. */
  number: number | null;
}

/** 'any' = 3:1 generic harbor, a Resource = 2:1 harbor for that resource. */
export type PortKind = 'any' | Resource;

export interface Port {
  /** A coastal edge (one land hex, one sea hex). Its two corners get the trade rate. */
  edge: EdgeId;
  kind: PortKind;
}

/** Board shapes. Each has a fixed set of hex coordinates and piece counts. */
export type LayoutId = 'standard' | 'extended';

export interface Board {
  layout: LayoutId;
  /** Land hexes keyed by HexId. Sea is implicit (anything not in this map). */
  hexes: Record<HexId, Hex>;
  ports: Port[];
}

export interface Player {
  id: PlayerId;
  name: string;
  /** CSS colour used for their pieces. */
  color: string;
  /** True for the person using the app (exactly one player). */
  isMe: boolean;
}

export type BuildingKind = 'settlement' | 'city';

export interface Building {
  player: PlayerId;
  kind: BuildingKind;
}

export interface Pieces {
  /** Settlements and cities on corners. */
  buildings: Record<VertexId, Building>;
  /** Roads (and, later, ships) on edges. */
  roads: Record<EdgeId, PlayerId>;
}

export interface DiceRoll {
  id: string;
  /** 2..12 */
  total: number;
  /** Individual dice if the user entered them, else omitted. */
  dice?: [number, number];
  /** Who rolled, if known. */
  player?: PlayerId;
  /** ms since epoch */
  at: number;
}

/**
 * What we know about one player's hand.
 * For "me" this is exact. For opponents it is an estimate built from rolls,
 * builds and trades; `unknown` counts cards we know exist but can't name
 * (e.g. after a steal we didn't see).
 */
export interface Hand {
  resources: ResourceCounts;
  unknown: number;
  devCards: number;
}

export type Phase = 'setup' | 'placement' | 'playing';

export interface GameState {
  /** Schema version for localStorage migrations. */
  version: 1;
  phase: Phase;
  board: Board;
  players: Player[];
  pieces: Pieces;
  /** HexId the robber sits on (null before the board has a desert). */
  robber: HexId | null;
  /** Oldest first. */
  diceHistory: DiceRoll[];
  hands: Record<PlayerId, Hand>;
}

export const emptyResources = (): ResourceCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const emptyHand = (): Hand => ({ resources: emptyResources(), unknown: 0, devCards: 0 });
