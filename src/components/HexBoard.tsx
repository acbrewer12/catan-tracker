/**
 * SVG board renderer, reusable by every feature.
 *
 * Coordinates: everything is drawn in "hex units × S" (S = 100), so a feature
 * that wants to draw pieces can do:
 *
 *   const { x, y } = topo.vertices[vertexId];       // hex units
 *   <circle cx={x * S} cy={y * S} r={14} />           // inside <HexBoard>{...}</HexBoard>
 *
 * Interaction is opt-in: pass onHexClick / onVertexClick / onEdgeClick and the
 * matching click targets are drawn on top. `vertexFilter` / `edgeFilter` limit
 * which targets are shown (e.g. only legal settlement spots).
 */
import type { ReactNode } from 'react';
import { pips, topologyFor } from '../model/board';
import { hexCenter, type EdgeInfo, type VertexInfo } from '../model/geometry';
import type { Board, EdgeId, HexId, VertexId } from '../model/types';
import { SEA, TERRAIN_STYLE } from './theme';

export const S = 100;

const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${(Math.cos(a) * S * 0.97).toFixed(2)},${(Math.sin(a) * S * 0.97).toFixed(2)}`;
}).join(' ');

export interface HexBoardProps {
  board: Board;
  robber?: HexId | null;
  selectedHex?: HexId | null;
  /** Hexes to outline as a warning (e.g. validation problems). */
  flaggedHexes?: Set<HexId>;
  onHexClick?: (id: HexId) => void;
  onVertexClick?: (id: VertexId) => void;
  vertexFilter?: (v: VertexInfo) => boolean;
  onEdgeClick?: (id: EdgeId) => void;
  edgeFilter?: (e: EdgeInfo) => boolean;
  selectedEdge?: EdgeId | null;
  /** Extra SVG drawn above the board and below click targets. */
  children?: ReactNode;
  className?: string;
}

export function HexBoard(props: HexBoardProps) {
  const { board, robber, selectedHex, flaggedHexes, onHexClick, onVertexClick, onEdgeClick, selectedEdge, children } = props;
  const topo = topologyFor(board.layout);
  const verts = Object.values(topo.vertices);
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const pad = 0.75;
  const minX = (Math.min(...xs) - pad) * S;
  const minY = (Math.min(...ys) - pad) * S;
  const w = (Math.max(...xs) - Math.min(...xs) + pad * 2) * S;
  const h = (Math.max(...ys) - Math.min(...ys) + pad * 2) * S;

  return (
    <svg className={props.className ?? 'hex-board'} viewBox={`${minX} ${minY} ${w} ${h}`} role="img" aria-label="Game board">
      <rect x={minX} y={minY} width={w} height={h} rx={40} fill={SEA} />

      {board.ports.map((p) => {
        const e = topo.edges[p.edge];
        if (!e) return null;
        const a = topo.vertices[e.vertices[0]];
        const b = topo.vertices[e.vertices[1]];
        const land = hexCenter(e.hexes[0]);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Push the marker out to sea, away from the land hex.
        const px = mx + (mx - land.x) * 0.55;
        const py = my + (my - land.y) * 0.55;
        return (
          <g key={p.edge} className="port">
            <line x1={a.x * S} y1={a.y * S} x2={px * S} y2={py * S} stroke="#f5ecd6" strokeWidth={6} />
            <line x1={b.x * S} y1={b.y * S} x2={px * S} y2={py * S} stroke="#f5ecd6" strokeWidth={6} />
            <circle cx={px * S} cy={py * S} r={34} fill={p.kind === 'any' ? '#f5ecd6' : TERRAIN_STYLE[p.kind].fill} stroke="#5a4630" strokeWidth={3} />
            {p.kind === 'any' ? (
              <text x={px * S} y={py * S + 1} textAnchor="middle" dominantBaseline="middle" fontSize={22} fontWeight={800} fill="#2b2118">
                3:1
              </text>
            ) : (
              <>
                <text x={px * S} y={py * S - 9} textAnchor="middle" dominantBaseline="middle" fontSize={22}>
                  {TERRAIN_STYLE[p.kind].icon}
                </text>
                <text x={px * S} y={py * S + 17} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={800} fill="#1d1710">
                  2:1
                </text>
              </>
            )}
          </g>
        );
      })}

      {topo.hexes.map((id) => {
        const hex = board.hexes[id];
        const { x, y } = hexCenter(id);
        const style = hex.terrain ? TERRAIN_STYLE[hex.terrain] : null;
        const red = hex.number === 6 || hex.number === 8;
        const selected = selectedHex === id;
        return (
          <g
            key={id}
            transform={`translate(${x * S} ${y * S})`}
            className={onHexClick ? 'hex clickable' : 'hex'}
            onClick={onHexClick ? () => onHexClick(id) : undefined}
          >
            <polygon
              points={HEX_POINTS}
              fill={style?.fill ?? '#f4f1ea'}
              stroke={selected ? '#111' : flaggedHexes?.has(id) ? '#d11' : '#efe6cf'}
              strokeWidth={selected ? 9 : flaggedHexes?.has(id) ? 7 : 4}
              strokeDasharray={style ? undefined : '10 8'}
            />
            {style ? (
              <text y={hex.number ? -42 : 8} textAnchor="middle" dominantBaseline="middle" fontSize={hex.number ? 30 : 48}>
                {style.icon}
              </text>
            ) : (
              <text y={4} textAnchor="middle" dominantBaseline="middle" fontSize={22} fill="#999">
                tap
              </text>
            )}
            {hex.number && (
              <g transform="translate(0 12)">
                <circle r={31} fill="#fbf6e6" stroke="#6b5a3e" strokeWidth={2} />
                <text y={-3} textAnchor="middle" dominantBaseline="middle" fontSize={30} fontWeight={800} fill={red ? '#c0221b' : '#222'}>
                  {hex.number}
                </text>
                <text y={18} textAnchor="middle" fontSize={14} fill={red ? '#c0221b' : '#444'} letterSpacing={-1}>
                  {'•'.repeat(pips(hex.number))}
                </text>
              </g>
            )}
            {robber === id && (
              <g transform="translate(46 -40)" className="robber">
                <circle r={17} fill="#222" stroke="#fff" strokeWidth={3} />
                <text textAnchor="middle" dominantBaseline="middle" fontSize={17} y={1}>
                  🦹
                </text>
              </g>
            )}
          </g>
        );
      })}

      {children}

      {onEdgeClick &&
        Object.values(topo.edges)
          .filter((e) => (props.edgeFilter ? props.edgeFilter(e) : true))
          .map((e) => {
            const a = topo.vertices[e.vertices[0]];
            const b = topo.vertices[e.vertices[1]];
            const sel = selectedEdge === e.id;
            return (
              <g key={e.id} className="edge-target" onClick={() => onEdgeClick(e.id)}>
                <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke={sel ? '#111' : '#ffe27a'} strokeWidth={sel ? 14 : 9} strokeDasharray={sel ? undefined : '8 6'} strokeLinecap="round" />
                <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="transparent" strokeWidth={40} />
              </g>
            );
          })}

      {onVertexClick &&
        verts
          .filter((v) => (props.vertexFilter ? props.vertexFilter(v) : true))
          .map((v) => (
            <circle key={v.id} className="vertex-target" cx={v.x * S} cy={v.y * S} r={18} fill="#ffffff55" stroke="#fff" strokeWidth={2} onClick={() => onVertexClick(v.id)} />
          ))}
    </svg>
  );
}
