/**
 * Board input screen. Tap a tile, then tap what it is; the selection jumps to
 * the next empty tile so a whole board takes ~40 taps. Same for numbers.
 * Harbors: tap a coastal edge, then pick the harbor type.
 */
import { useMemo, useState } from 'react';
import { HexBoard } from '../../components/HexBoard';
import { PORT_LABEL, TERRAIN_STYLE } from '../../components/theme';
import { numberCounts, terrainCounts, topologyFor, validateBoard } from '../../model/board';
import { LAYOUTS, totalPorts } from '../../model/layouts';
import { RESOURCES, type EdgeId, type HexId, type LayoutId, type PortKind, type Terrain } from '../../model/types';
import { useGame } from '../../state/store';

type Mode = 'tiles' | 'numbers' | 'harbors';
const TERRAINS: Terrain[] = [...RESOURCES, 'desert'];
const PORT_KINDS: PortKind[] = ['any', ...RESOURCES];

export function BoardInput({ onDone }: { onDone?: () => void }) {
  const { state, dispatch } = useGame();
  const { board } = state;
  const spec = LAYOUTS[board.layout];
  const topo = topologyFor(board.layout);
  const [mode, setMode] = useState<Mode>('tiles');
  const [hex, setHex] = useState<HexId | null>(spec.hexes[0]);
  const [edge, setEdge] = useState<EdgeId | null>(null);

  const problems = useMemo(() => validateBoard(board), [board]);
  const flagged = useMemo(() => new Set(problems.filter((p) => p.code === 'red-adjacent').flatMap((p) => p.hexes ?? [])), [problems]);
  const tCount = terrainCounts(board);
  const nCount = numberCounts(board);
  const portCount = (k: PortKind) => board.ports.filter((p) => p.kind === k).length;
  const portAt = (e: EdgeId | null) => board.ports.find((p) => p.edge === e)?.kind ?? null;

  /** Next tile (in reading order, wrapping) that still needs input for this mode. */
  function nextNeeding(from: HexId, m: Mode, override?: { id: HexId; terrain?: Terrain }): HexId | null {
    const order = spec.hexes;
    const start = order.indexOf(from);
    for (let i = 1; i <= order.length; i++) {
      const id = order[(start + i) % order.length];
      const h = board.hexes[id];
      const terrain = override?.id === id && override.terrain ? override.terrain : h.terrain;
      if (m === 'tiles' && !terrain && id !== from) return id;
      if (m === 'numbers' && terrain !== 'desert' && !h.number && id !== from) return id;
    }
    return null;
  }

  function pickTerrain(t: Terrain) {
    if (!hex) return;
    dispatch({ type: 'board/setTerrain', hex, terrain: t });
    const next = nextNeeding(hex, 'tiles', { id: hex, terrain: t });
    if (next) setHex(next);
    else {
      setMode('numbers');
      setHex(spec.hexes.find((id) => (id === hex ? t : board.hexes[id].terrain) !== 'desert') ?? null);
    }
  }

  function pickNumber(n: number) {
    if (!hex || board.hexes[hex].terrain === 'desert') return;
    dispatch({ type: 'board/setNumber', hex, number: n });
    const next = nextNeeding(hex, 'numbers');
    if (next) setHex(next);
    else setMode('harbors');
  }

  function pickPort(k: PortKind | null) {
    if (!edge) return;
    dispatch({ type: 'board/setPort', edge, kind: k });
  }

  function changeLayout(l: LayoutId) {
    if (l === board.layout) return;
    const filled = Object.values(board.hexes).some((h) => h.terrain || h.number);
    if (filled && !window.confirm('Switching board size clears the tiles you entered. Continue?')) return;
    dispatch({ type: 'board/setLayout', layout: l });
    setHex(LAYOUTS[l].hexes[0]);
    setEdge(null);
  }

  const selected = hex ? board.hexes[hex] : null;
  const numberValues = [...new Set(spec.numbers)];
  const errors = problems.filter((p) => p.level === 'error');

  return (
    <div className="screen board-input">
      <div className="segmented layout" role="tablist" aria-label="Board size">
          {(Object.keys(LAYOUTS) as LayoutId[]).map((l) => (
            <button key={l} className={board.layout === l ? 'on' : ''} onClick={() => changeLayout(l)}>
              {LAYOUTS[l].players} <small>{LAYOUTS[l].hexes.length} tiles</small>
            </button>
          ))}
      </div>

      <div className="segmented full" role="tablist" aria-label="What to enter">
        <button className={mode === 'tiles' ? 'on' : ''} onClick={() => setMode('tiles')}>
          1. Tiles <small>{Object.values(tCount).reduce((a, b) => a + b, 0)}/{spec.hexes.length}</small>
        </button>
        <button className={mode === 'numbers' ? 'on' : ''} onClick={() => setMode('numbers')}>
          2. Numbers <small>{Object.values(nCount).reduce((a, b) => a + b, 0)}/{spec.numbers.length}</small>
        </button>
        <button className={mode === 'harbors' ? 'on' : ''} onClick={() => setMode('harbors')}>
          3. Harbors <small>{board.ports.length}/{totalPorts(spec)}</small>
        </button>
      </div>

      <HexBoard
        board={board}
        robber={state.robber}
        selectedHex={mode === 'harbors' ? null : hex}
        flaggedHexes={flagged}
        onHexClick={mode === 'harbors' ? undefined : setHex}
        onEdgeClick={mode === 'harbors' ? setEdge : undefined}
        edgeFilter={(e) => e.coastal}
        selectedEdge={edge}
      />

      <div className="palette">
        {mode === 'tiles' && (
          <>
            <p className="hint">{selected ? 'What resource is the highlighted tile?' : 'Tap a tile on the board.'}</p>
            <div className="grid3">
              {TERRAINS.map((t) => {
                const left = spec.terrain[t] - tCount[t];
                const s = TERRAIN_STYLE[t];
                return (
                  <button key={t} className={`chip ${selected?.terrain === t ? 'on' : ''}`} style={{ background: s.fill }} disabled={!hex} onClick={() => pickTerrain(t)}>
                    <span className="icon">{s.icon}</span>
                    {s.label}
                    <small className={left < 0 ? 'over' : ''}>{left} left</small>
                  </button>
                );
              })}
            </div>
            {selected?.terrain && (
              <button className="link" onClick={() => hex && dispatch({ type: 'board/setTerrain', hex, terrain: null })}>
                Clear this tile
              </button>
            )}
          </>
        )}

        {mode === 'numbers' && (
          <>
            <p className="hint">
              {!selected ? 'Tap a tile on the board.' : selected.terrain === 'desert' ? 'The desert has no number. Tap another tile.' : 'What number is on the highlighted tile?'}
            </p>
            <div className="grid5">
              {numberValues.map((n) => {
                const left = spec.numbers.filter((x) => x === n).length - (nCount[n] ?? 0);
                return (
                  <button
                    key={n}
                    className={`num ${n === 6 || n === 8 ? 'red' : ''} ${selected?.number === n ? 'on' : ''}`}
                    disabled={!selected || selected.terrain === 'desert'}
                    onClick={() => pickNumber(n)}
                  >
                    {n}
                    <small className={left < 0 ? 'over' : ''}>{left} left</small>
                  </button>
                );
              })}
            </div>
            {selected?.number && (
              <button className="link" onClick={() => hex && dispatch({ type: 'board/setNumber', hex, number: null })}>
                Clear this number
              </button>
            )}
          </>
        )}

        {mode === 'harbors' && (
          <>
            <p className="hint">{edge ? 'What harbor is on the highlighted edge?' : 'Tap a dashed coastline edge where a harbor is.'}</p>
            <div className="grid3">
              {PORT_KINDS.map((k) => {
                const left = spec.ports[k] - portCount(k);
                return (
                  <button
                    key={k}
                    className={`chip ${portAt(edge) === k ? 'on' : ''}`}
                    style={{ background: k === 'any' ? '#f5ecd6' : TERRAIN_STYLE[k].fill }}
                    disabled={!edge}
                    onClick={() => pickPort(k)}
                  >
                    {PORT_LABEL[k]}
                    <small className={left < 0 ? 'over' : ''}>{left} left</small>
                  </button>
                );
              })}
            </div>
            <div className="row">
              {edge && portAt(edge) && (
                <button className="link" onClick={() => pickPort(null)}>
                  Remove this harbor
                </button>
              )}
              <button
                className="link"
                onClick={() => {
                  const occupied = new Set(board.ports.map((p) => p.edge));
                  const kinds = PORT_KINDS.flatMap((k) => Array(Math.max(0, spec.ports[k] - portCount(k))).fill(k) as PortKind[]);
                  if (!kinds.length) return;
                  const step = topo.coast.length / totalPorts(spec);
                  for (let i = 0; i < totalPorts(spec) && kinds.length; i++) {
                    const e = topo.coast[Math.floor(i * step)];
                    if (!occupied.has(e)) dispatch({ type: 'board/setPort', edge: e, kind: kinds.shift()! });
                  }
                }}
              >
                Fill remaining harbors evenly
              </button>
            </div>
          </>
        )}
      </div>

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p.code + p.message} className={p.level}>
              {p.level === 'error' ? '✗' : '⚠'} {p.message}
            </li>
          ))}
        </ul>
      )}

      <div className="row actions">
        <button
          onClick={() => {
            if (Object.values(board.hexes).some((h) => h.terrain) && !window.confirm('Replace the board with a random one?')) return;
            dispatch({ type: 'board/randomize' });
          }}
        >
          🎲 Random board
        </button>
        <button
          onClick={() => {
            if (!window.confirm('Clear all tiles, numbers and harbors?')) return;
            dispatch({ type: 'board/clear' });
            setHex(spec.hexes[0]);
            setMode('tiles');
          }}
        >
          Clear
        </button>
        {onDone && (
          <button className="primary" disabled={errors.length > 0} onClick={onDone}>
            Board done →
          </button>
        )}
      </div>
    </div>
  );
}
