/**
 * Piece + robber actions. Owned by the pieces feature (features/pieces).
 * The reducer only stores what the user entered; rule checks live in
 * model/pieces.ts so the UI can warn without blocking real-table mistakes.
 *
 * moveBuilding / moveRoad are corrections (a piece was entered on the wrong
 * spot), not new builds.
 */
import type { BuildingKind, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../model/types';

export type PiecesAction =
  | { type: 'pieces/setBuilding'; vertex: VertexId; player: PlayerId; kind: BuildingKind }
  | { type: 'pieces/removeBuilding'; vertex: VertexId }
  | { type: 'pieces/moveBuilding'; from: VertexId; to: VertexId }
  | { type: 'pieces/setRoad'; edge: EdgeId; player: PlayerId }
  | { type: 'pieces/removeRoad'; edge: EdgeId }
  | { type: 'pieces/moveRoad'; from: EdgeId; to: EdgeId }
  | { type: 'robber/move'; hex: HexId };

export function piecesReducer(s: GameState, a: PiecesAction): GameState {
  const { buildings, roads } = s.pieces;
  switch (a.type) {
    case 'pieces/setBuilding': {
      const cur = buildings[a.vertex];
      if (cur && cur.player === a.player && cur.kind === a.kind) return s;
      return { ...s, pieces: { ...s.pieces, buildings: { ...buildings, [a.vertex]: { player: a.player, kind: a.kind } } } };
    }
    case 'pieces/removeBuilding': {
      if (!buildings[a.vertex]) return s;
      const next = { ...buildings };
      delete next[a.vertex];
      return { ...s, pieces: { ...s.pieces, buildings: next } };
    }
    case 'pieces/moveBuilding': {
      const b = buildings[a.from];
      if (!b || a.from === a.to || buildings[a.to]) return s;
      const next = { ...buildings, [a.to]: b };
      delete next[a.from];
      return { ...s, pieces: { ...s.pieces, buildings: next } };
    }
    case 'pieces/setRoad':
      if (roads[a.edge] === a.player) return s;
      return { ...s, pieces: { ...s.pieces, roads: { ...roads, [a.edge]: a.player } } };
    case 'pieces/removeRoad': {
      if (!roads[a.edge]) return s;
      const next = { ...roads };
      delete next[a.edge];
      return { ...s, pieces: { ...s.pieces, roads: next } };
    }
    case 'pieces/moveRoad': {
      const p = roads[a.from];
      if (!p || a.from === a.to || roads[a.to]) return s;
      const next = { ...roads, [a.to]: p };
      delete next[a.from];
      return { ...s, pieces: { ...s.pieces, roads: next } };
    }
    case 'robber/move':
      // Logged with the time so the review can tell who moved it and where it sat.
      return s.board.hexes[a.hex] && s.robber !== a.hex
        ? { ...s, robber: a.hex, robberMoves: [...(s.robberMoves ?? []), { hex: a.hex, at: Date.now(), rolls: s.diceHistory.length, events: s.cardLog.length }] }
        : s;
  }
}
