/** Roads, settlements and cities drawn simply on a <HexBoard>, for the Play tab's boards. */
import { S } from '../../components/HexBoard';
import { useBoardRotation } from '../../components/boardRotation';
import { topologyFor } from '../../model/board';
import type { GameState } from '../../model/types';

const HOUSE = 'M -15 15 V -4 L 0 -19 L 15 -4 V 15 Z';
const CITY = 'M -24 17 V -4 H -6 V -15 L 7 -28 L 20 -15 V 17 Z';

export function PiecesLayer({ state }: { state: GameState }) {
  const topo = topologyFor(state.board.layout);
  const { deg } = useBoardRotation();
  const color = (id: string) => state.players.find((p) => p.id === id)?.color ?? '#888';
  return (
    <g pointerEvents="none">
      {Object.entries(state.pieces.roads).map(([e, pl]) => {
        const info = topo.edges[e];
        if (!info) return null;
        const [a, b] = info.vertices.map((v) => topo.vertices[v]);
        const k = 0.2;
        const x1 = (a.x + (b.x - a.x) * k) * S;
        const y1 = (a.y + (b.y - a.y) * k) * S;
        const x2 = (b.x + (a.x - b.x) * k) * S;
        const y2 = (b.y + (a.y - b.y) * k) * S;
        return (
          <g key={e}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1d1710" strokeWidth={19} strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color(pl)} strokeWidth={12} strokeLinecap="round" />
          </g>
        );
      })}
      {Object.entries(state.pieces.buildings).map(([v, b]) => {
        const p = topo.vertices[v];
        if (!p) return null;
        return (
          <path
            key={v}
            d={b.kind === 'city' ? CITY : HOUSE}
            transform={`translate(${p.x * S} ${p.y * S}) rotate(${-deg})`}
            fill={color(b.player)}
            stroke="#1d1710"
            strokeWidth={3.5}
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}
