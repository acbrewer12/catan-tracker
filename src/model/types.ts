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
  /** Development cards held, not yet played. */
  devCards: number;
  /** Knight cards played so far (largest army). */
  knightsPlayed: number;
}

export type DevCardKind = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint';
export type BuildItem = 'road' | 'settlement' | 'city' | 'devCard';

/**
 * One thing that moved resource cards. `GameState.cardLog` is the record of
 * these; `hands` is rebuilt from it (see model/cards.ts). Spots point at the
 * board corner / edge a build was placed on, so piece corrections can find it.
 */
export type CardEvent = { id: string; at: number } & (
  | { kind: 'production'; rollId: string; gains: Record<PlayerId, Partial<ResourceCounts>> }
  | { kind: 'gain'; player: PlayerId; resources: Partial<ResourceCounts> }
  | { kind: 'lose'; player: PlayerId; resources: Partial<ResourceCounts>; reason?: 'discard' | 'other' }
  | {
      kind: 'build';
      player: PlayerId;
      item: BuildItem;
      spot?: VertexId | EdgeId;
      /** Opening placement or Road Building: no cost. */
      free?: boolean;
      /** Resources from a second opening settlement. */
      startGain?: Partial<ResourceCounts>;
      /** Which card was drawn, when it's the user's own. */
      devCard?: DevCardKind;
    }
  | { kind: 'trade'; player: PlayerId; with: PlayerId | 'bank'; give: Partial<ResourceCounts>; get: Partial<ResourceCounts> }
  | { kind: 'steal'; thief: PlayerId; victim: PlayerId; resource?: Resource }
  | {
      kind: 'playDev';
      player: PlayerId;
      card: DevCardKind;
      /** Year of Plenty: what they took. */
      take?: Partial<ResourceCounts>;
      /** Monopoly: the resource and how many each other player handed over. */
      resource?: Resource;
      taken?: Record<PlayerId, number>;
    }
  /** Correction: this is exactly the hand (e.g. the user's own cards). */
  | { kind: 'set'; player: PlayerId; resources: ResourceCounts }
  /** Correction: they hold this many cards (types unknown for any change). */
  | { kind: 'setTotal'; player: PlayerId; total: number }
);

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
  /** Every card movement, oldest first. `hands` is derived from it. */
  cardLog: CardEvent[];
}

export const emptyResources = (): ResourceCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const emptyHand = (): Hand => ({ resources: emptyResources(), unknown: 0, devCards: 0, knightsPlayed: 0 });
