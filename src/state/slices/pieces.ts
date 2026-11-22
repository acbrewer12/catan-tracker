/**
 * Baseline piece + robber actions. The pieces/robber feature thread owns this
 * file and may extend it (e.g. legality checks, piece limits, longest road).
 */
import type { BuildingKind, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../model/types';

export type PiecesAction =
  | { type: 'pieces/setBuilding'; vertex: VertexId; player: PlayerId; kind: BuildingKind }
  | { type: 'pieces/removeBuilding'; vertex: VertexId }
  | { type: 'pieces/setRoad'; edge: EdgeId; player: PlayerId }
  | { type: 'pieces/removeRoad'; edge: EdgeId }
  | { type: 'robber/move'; hex: HexId };

export function piecesReducer(s: GameState, a: PiecesAction): GameState {
  switch (a.type) {
    case 'pieces/setBuilding':
      return { ...s, pieces: { ...s.pieces, buildings: { ...s.pieces.buildings, [a.vertex]: { player: a.player, kind: a.kind } } } };
    case 'pieces/removeBuilding': {
      const buildings = { ...s.pieces.buildings };
      delete buildings[a.vertex];
      return { ...s, pieces: { ...s.pieces, buildings } };
    }
    case 'pieces/setRoad':
      return { ...s, pieces: { ...s.pieces, roads: { ...s.pieces.roads, [a.edge]: a.player } } };
    case 'pieces/removeRoad': {
      const roads = { ...s.pieces.roads };
      delete roads[a.edge];
      return { ...s, pieces: { ...s.pieces, roads } };
    }
    case 'robber/move':
      return s.board.hexes[a.hex] ? { ...s, robber: a.hex } : s;
  }
}
