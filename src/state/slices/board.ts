/** Board input: tiles, numbers, harbors, layout. Owned by the board-input feature. */
import { desertHex, emptyBoard, randomBoard } from '../../model/board';
import type { Board, EdgeId, GameState, HexId, LayoutId, PortKind, Terrain } from '../../model/types';

export type BoardAction =
  | { type: 'board/setLayout'; layout: LayoutId }
  | { type: 'board/setTerrain'; hex: HexId; terrain: Terrain | null }
  | { type: 'board/setNumber'; hex: HexId; number: number | null }
  | { type: 'board/setPort'; edge: EdgeId; kind: PortKind | null }
  | { type: 'board/clear' }
  | { type: 'board/randomize' }
  | { type: 'board/replace'; board: Board };

/** While setting up, keep the robber on the desert automatically. */
const withRobber = (s: GameState): GameState => (s.phase === 'setup' ? { ...s, robber: desertHex(s.board) } : s);

export function boardReducer(s: GameState, a: BoardAction): GameState {
  switch (a.type) {
    case 'board/setLayout':
      return withRobber({ ...s, board: emptyBoard(a.layout) });
    case 'board/clear':
      return withRobber({ ...s, board: emptyBoard(s.board.layout) });
    case 'board/randomize':
      return withRobber({ ...s, board: randomBoard(s.board.layout) });
    case 'board/replace':
      return withRobber({ ...s, board: a.board });
    case 'board/setTerrain': {
      const hex = s.board.hexes[a.hex];
      if (!hex) return s;
      const number = a.terrain === 'desert' ? null : hex.number;
      return withRobber({ ...s, board: { ...s.board, hexes: { ...s.board.hexes, [a.hex]: { ...hex, terrain: a.terrain, number } } } });
    }
    case 'board/setNumber': {
      const hex = s.board.hexes[a.hex];
      if (!hex || a.number === 7) return s;
      return { ...s, board: { ...s.board, hexes: { ...s.board.hexes, [a.hex]: { ...hex, number: a.number } } } };
    }
    case 'board/setPort': {
      const ports = s.board.ports.filter((p) => p.edge !== a.edge);
      if (a.kind) ports.push({ edge: a.edge, kind: a.kind });
      return { ...s, board: { ...s.board, ports } };
    }
  }
}
