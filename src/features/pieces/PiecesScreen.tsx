/**
 * Pieces tab: place, upgrade, move and remove every player's settlements,
 * cities and roads, and move the robber.
 *
 * Flow on a phone: pick a player chip, pick a tool, tap a glowing spot.
 * Tap an existing piece to upgrade, move, remove or change its owner.
 * During the opening round it follows the snake order automatically.
 * "Enforce rules" shows only legal spots; turn it off to enter anything
 * (handy for fixing mistakes) and get a warning instead.
 */
import { useMemo, useState } from 'react';
import { HexBoard, S } from '../../components/HexBoard';
import { TERRAIN_STYLE } from '../../components/theme';
import { topologyFor } from '../../model/board';
import {
  PIECE_LIMITS,
  boardPoints,
  buildingsOnHex,
  checkBuilding,
  checkRoad,
  longestRoad,
  longestRoadHolder,
  openingTurn,
  piecesLeft,
  type Problem,
} from '../../model/pieces';
import type { EdgeId, HexId, Player, PlayerId, VertexId } from '../../model/types';
import { useGame } from '../../state/store';
import { StealPicker } from '../dice/StealPicker';
import './pieces.css';

type Tool = 'settlement' | 'city' | 'road' | 'robber';
type Selection = { kind: 'building'; vertex: VertexId } | { kind: 'road'; edge: EdgeId } | null;

const TOOLS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'settlement', icon: '🏠', label: 'Settlement' },
  { id: 'city', icon: '🏙️', label: 'City' },
  { id: 'road', icon: '➖', label: 'Road' },
  { id: 'robber', icon: '🦹', label: 'Robber' },
];

const HOUSE = 'M -17 17 V -4 L 0 -21 L 17 -4 V 17 Z';
const CITY = 'M -27 19 V -4 H -7 V -17 L 8 -31 L 23 -17 V 19 Z';

export function PiecesScreen({ go }: { go?: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const { board, players, pieces } = state;
  const topo = topologyFor(board.layout);

  const [chosenPlayer, setChosenPlayer] = useState<PlayerId | null>(null);
  const [chosenTool, setChosenTool] = useState<Tool>('settlement');
  const [follow, setFollow] = useState(true);
  const [strict, setStrict] = useState(true);
  const [selected, setSelected] = useState<Selection>(null);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const turn = openingTurn(state);
  const following = follow && !!turn;
  const playerId = following ? turn!.player : players.some((p) => p.id === chosenPlayer) ? chosenPlayer! : players[0]?.id;
  const tool: Tool = following && chosenTool !== 'robber' ? turn!.place : chosenTool;
  const player = players.find((p) => p.id === playerId);
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const holder = longestRoadHolder(state);
  const boardEntered = Object.values(board.hexes).some((h) => h.terrain);

  // Drop a selection that no longer exists (e.g. after undo).
  const sel: Selection =
    selected?.kind === 'building' && pieces.buildings[selected.vertex]
      ? selected
      : selected?.kind === 'road' && pieces.roads[selected.edge]
        ? selected
        : null;
  const isMoving = moving && !!sel;

  function warn(problems: Problem[], what: string) {
    setNotice(problems.length ? `${what} placed, but: ${problems.map((p) => p.message).join(' ')}` : null);
  }
  function clearSelection() {
    setSelected(null);
    setMoving(false);
  }

  // ---- what can be tapped ----------------------------------------------------
  function vertexOk(v: VertexId): boolean {
    if (!playerId) return false;
    if (isMoving && sel?.kind === 'building') {
      const b = pieces.buildings[sel.vertex];
      if (pieces.buildings[v]) return false;
      // A correction, so the piece limit doesn't matter; spacing and connection still do.
      return !strict || checkBuilding(state, v, b.player, 'settlement', sel.vertex).every((p) => p.code === 'no-pieces');
    }
    if (sel || tool === 'road' || tool === 'robber') return false;
    if (tool === 'settlement') return !pieces.buildings[v] && (!strict || checkBuilding(state, v, playerId, 'settlement').length === 0);
    // city: upgrade one of this player's settlements
    const b = pieces.buildings[v];
    return !!b && b.kind === 'settlement' && b.player === playerId && (!strict || checkBuilding(state, v, playerId, 'city').length === 0);
  }
  function edgeOk(e: EdgeId): boolean {
    if (!playerId) return false;
    if (isMoving && sel?.kind === 'road') {
      if (pieces.roads[e]) return false;
      return !strict || checkRoad(state, e, pieces.roads[sel.edge], sel.edge).length === 0;
    }
    if (sel || tool !== 'road') return false;
    return !pieces.roads[e] && (!strict || checkRoad(state, e, playerId).length === 0);
  }

  // ---- taps ----------------------------------------------------------------
  function tapVertex(v: VertexId) {
    if (!playerId) return;
    if (isMoving && sel?.kind === 'building') {
      dispatch({ type: 'pieces/moveBuilding', from: sel.vertex, to: v });
      setSelected({ kind: 'building', vertex: v });
      setMoving(false);
      setNotice(null);
      return;
    }
    if (tool === 'settlement') {
      const problems = checkBuilding(state, v, playerId, 'settlement');
      dispatch({ type: 'pieces/setBuilding', vertex: v, player: playerId, kind: 'settlement' });
      warn(problems, 'Settlement');
    } else if (tool === 'city') {
      const problems = checkBuilding(state, v, playerId, 'city');
      dispatch({ type: 'pieces/setBuilding', vertex: v, player: playerId, kind: 'city' });
      warn(problems, 'City');
    }
  }
  function tapEdge(e: EdgeId) {
    if (!playerId) return;
    if (isMoving && sel?.kind === 'road') {
      dispatch({ type: 'pieces/moveRoad', from: sel.edge, to: e });
      setSelected({ kind: 'road', edge: e });
      setMoving(false);
      setNotice(null);
      return;
    }
    const problems = checkRoad(state, e, playerId);
    dispatch({ type: 'pieces/setRoad', edge: e, player: playerId });
    warn(problems, 'Road');
  }
  function tapHex(h: HexId) {
    if (h === state.robber) return;
    dispatch({ type: 'robber/move', hex: h });
    setNotice(null);
  }
  function tapPiece(s: Selection) {
    if (tool === 'robber' || isMoving) return;
    // In city mode, tapping your own settlement upgrades it (handled by the target on top).
    setSelected(s);
    setMoving(false);
    setNotice(null);
  }

  // ---- drawing -------------------------------------------------------------
  const roadEls = Object.entries(pieces.roads).map(([e, pid]) => {
    const edge = topo.edges[e];
    const p = byId[pid];
    if (!edge || !p) return null;
    const a = topo.vertices[edge.vertices[0]];
    const b = topo.vertices[edge.vertices[1]];
    // Inset so buildings at the ends stay visible.
    const k = 0.2;
    const x1 = (a.x + (b.x - a.x) * k) * S;
    const y1 = (a.y + (b.y - a.y) * k) * S;
    const x2 = (b.x + (a.x - b.x) * k) * S;
    const y2 = (b.y + (a.y - b.y) * k) * S;
    const isSel = sel?.kind === 'road' && sel.edge === e;
    return (
      <g key={e} className="piece" onClick={() => tapPiece({ kind: 'road', edge: e })}>
        {isSel && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={32} strokeLinecap="round" />}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1d1710" strokeWidth={21} strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={p.color} strokeWidth={14} strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={36} />
      </g>
    );
  });
  const buildingEls = Object.entries(pieces.buildings).map(([v, b]) => {
    const vert = topo.vertices[v];
    const p = byId[b.player];
    if (!vert || !p) return null;
    const isSel = sel?.kind === 'building' && sel.vertex === v;
    return (
      <g key={v} className="piece" transform={`translate(${vert.x * S} ${vert.y * S})`} onClick={() => tapPiece({ kind: 'building', vertex: v })}>
        {isSel && <circle r={38} fill="#fff" stroke="#1d1710" strokeWidth={4} strokeDasharray="8 5" />}
        <path d={b.kind === 'city' ? CITY : HOUSE} fill={p.color} stroke="#1d1710" strokeWidth={3.5} strokeLinejoin="round" />
        <circle r={30} fill="transparent" />
      </g>
    );
  });

  // ---- panels --------------------------------------------------------------
  const robberHex = state.robber ? board.hexes[state.robber] : null;
  const blocked = state.robber ? buildingsOnHex(state, state.robber) : [];

  const spotsLeft =
    tool === 'settlement' ? Object.keys(topo.vertices).filter(vertexOk).length : tool === 'road' ? Object.keys(topo.edges).filter(edgeOk).length : -1;

  function hint(): string {
    if (isMoving) return 'Tap the new spot for this piece.';
    if (tool === 'robber') return 'Tap a tile to move the robber there.';
    const who = player ? player.name : 'this player';
    const none = strict && spotsLeft === 0;
    if (tool === 'settlement' && none) return `No legal settlement spots for ${who} right now. Turn off the rules check below to place one anyway.`;
    if (tool === 'road' && none) return `No legal road spots for ${who} right now. Turn off the rules check below to place one anyway.`;
    if (tool === 'settlement') return `Tap a glowing corner to place ${who}'s settlement.`;
    if (tool === 'city') return `Tap one of ${who}'s settlements to upgrade it. Tap any piece to edit it.`;
    return `Tap a glowing edge to place ${who}'s road.`;
  }

  if (!boardEntered) {
    return (
      <div className="screen">
        <p className="hint">Enter the board first, then come back here to track pieces.</p>
        {go && (
          <button className="primary" onClick={() => go('board')}>
            Go to Board
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="screen pieces">
      <div className="player-chips" role="tablist" aria-label="Player">
        {players.map((p) => (
          <PlayerChip
            key={p.id}
            p={p}
            on={p.id === playerId}
            points={boardPoints(state, p.id, holder)}
            left={piecesLeft(state, p.id)}
            road={longestRoad(state, p.id)}
            holder={holder === p.id}
            onClick={() => {
              setChosenPlayer(p.id);
              setFollow(false);
              clearSelection();
            }}
          />
        ))}
      </div>

      <div className="segmented full" role="tablist" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'on' : ''}
            onClick={() => {
              setChosenTool(t.id);
              if (t.id !== 'robber') setFollow(false);
              clearSelection();
              setNotice(null);
            }}
          >
            <span className="tool-icon">{t.icon}</span>
            <small>{t.label}</small>
          </button>
        ))}
      </div>

      {turn && (
        <div className={`opening ${following ? 'on' : ''}`}>
          {following ? (
            <>
              <span>
                Opening round: <b>{byId[turn.player]?.name}</b> places a {turn.place}.
              </span>
              <button className="link" onClick={() => setFollow(false)}>
                Pick manually
              </button>
            </>
          ) : (
            <>
              <span>Opening round in progress.</span>
              <button
                className="link"
                onClick={() => {
                  setFollow(true);
                  if (chosenTool === 'robber') setChosenTool('settlement');
                  clearSelection();
                }}
              >
                Follow turn order
              </button>
            </>
          )}
        </div>
      )}

      <HexBoard
        board={board}
        robber={state.robber}
        onHexClick={tool === 'robber' && !sel ? tapHex : undefined}
        onVertexClick={tapVertex}
        vertexFilter={(v) => vertexOk(v.id)}
        onEdgeClick={tapEdge}
        edgeFilter={(e) => edgeOk(e.id)}
      >
        {roadEls}
        {buildingEls}
      </HexBoard>

      <div className="palette">
        {sel ? (
          <SelectionPanel
            sel={sel}
            players={players}
            moving={isMoving}
            onMove={() => setMoving((m) => !m)}
            onClose={clearSelection}
            onNotice={setNotice}
          />
        ) : (
          <p className="hint">{hint()}</p>
        )}

        {notice && <p className="warning notice">⚠️ {notice}</p>}

        {tool === 'robber' && !sel && (
          <div className="robber-info">
            {robberHex ? (
              <>
                <p>
                  Robber on{' '}
                  <b>
                    {robberHex.terrain ? `${TERRAIN_STYLE[robberHex.terrain].icon} ${TERRAIN_STYLE[robberHex.terrain].label}` : 'a tile'}
                    {robberHex.number ? ` ${robberHex.number}` : ''}
                  </b>
                  .
                </p>
                {blocked.length ? (
                  <p className="hint">
                    Blocking{' '}
                    {blocked.map((b, i) => (
                      <span key={b.vertex}>
                        {i > 0 && ', '}
                        <span className="dot" style={{ background: byId[b.player]?.color }} />
                        {byId[b.player]?.name} ({b.kind})
                      </span>
                    ))}
                    . Anyone listed can be stolen from.
                  </p>
                ) : (
                  <p className="hint">Nobody has a building on this tile.</p>
                )}
                {blocked.length > 0 && <StealPicker />}
              </>
            ) : (
              <p className="hint">The robber isn't on the board yet.</p>
            )}
          </div>
        )}

        <label className="strict">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} /> Enforce placement rules
        </label>
      </div>

      <p className="hint">
        Longest road:{' '}
        {holder ? (
          <>
            <b>{byId[holder]?.name}</b> ({longestRoad(state, holder)})
          </>
        ) : (
          'nobody yet (needs 5)'
        )}
        . Points shown are from the board only (not dev cards or largest army).
      </p>
    </div>
  );
}

function PlayerChip(props: {
  p: Player;
  on: boolean;
  points: number;
  left: { settlement: number; city: number; road: number };
  road: number;
  holder: boolean;
  onClick: () => void;
}) {
  const { p, on, points, left } = props;
  return (
    <button className={`player-chip ${on ? 'on' : ''}`} onClick={props.onClick} aria-pressed={on}>
      <span className="row">
        <span className="swatch" style={{ background: p.color }} />
        <b className="name">{p.name}</b>
        <span className="vp" title="Points on the board">
          {points}★
        </span>
      </span>
      <small className="left" title="Pieces left to place">
        🏠{left.settlement} 🏙️{left.city} ➖{left.road}
        {props.holder ? ' 🛣️' : ''}
      </small>
    </button>
  );
}

function SelectionPanel(props: {
  sel: NonNullable<Selection>;
  players: Player[];
  moving: boolean;
  onMove: () => void;
  onClose: () => void;
  onNotice: (s: string | null) => void;
}) {
  const { state, dispatch } = useGame();
  const { sel, players, moving } = props;
  const owner = sel.kind === 'building' ? state.pieces.buildings[sel.vertex].player : state.pieces.roads[sel.edge];
  const b = sel.kind === 'building' ? state.pieces.buildings[sel.vertex] : null;
  const what = b ? b.kind : 'road';
  const ownerP = players.find((p) => p.id === owner);

  function setOwner(pid: PlayerId) {
    if (sel.kind === 'building') dispatch({ type: 'pieces/setBuilding', vertex: sel.vertex, player: pid, kind: b!.kind });
    else dispatch({ type: 'pieces/setRoad', edge: sel.edge, player: pid });
  }
  function toggleCity() {
    if (sel.kind !== 'building' || !b) return;
    const kind = b.kind === 'city' ? 'settlement' : 'city';
    if (kind === 'city') {
      const problems = checkBuilding(state, sel.vertex, b.player, 'city');
      props.onNotice(problems.length ? `Upgraded, but: ${problems.map((p) => p.message).join(' ')}` : null);
    } else props.onNotice(null);
    dispatch({ type: 'pieces/setBuilding', vertex: sel.vertex, player: b.player, kind });
  }
  function remove() {
    if (sel.kind === 'building') dispatch({ type: 'pieces/removeBuilding', vertex: sel.vertex });
    else dispatch({ type: 'pieces/removeRoad', edge: sel.edge });
    props.onClose();
  }

  return (
    <div className="selection">
      <div className="row">
        <span className="swatch" style={{ background: ownerP?.color }} />
        <b>
          {ownerP?.name}'s {what}
        </b>
        <button className="link close" onClick={props.onClose}>
          Done
        </button>
      </div>
      {moving ? (
        <p className="hint">Tap the new spot on the board.</p>
      ) : (
        <div className="row wrap">
          {b && (
            <button onClick={toggleCity}>
              {b.kind === 'city' ? '🏠 Make settlement' : `🏙️ Upgrade to city`}
            </button>
          )}
          <button onClick={props.onMove}>✋ Move</button>
          <button onClick={remove}>🗑️ Remove</button>
        </div>
      )}
      {moving && (
        <button onClick={props.onMove} className="cancel-move">
          Cancel move
        </button>
      )}
      {!moving && (
        <div className="owners" aria-label="Change owner">
          <small className="hint">Owner:</small>
          {players.map((p) => (
            <button
              key={p.id}
              aria-label={`Give to ${p.name}`}
              className={`color ${p.id === owner ? 'on' : ''}`}
              style={{ background: p.color }}
              onClick={() => setOwner(p.id)}
            />
          ))}
        </div>
      )}
      <small className="hint">Limits per player: {PIECE_LIMITS.settlement} settlements, {PIECE_LIMITS.city} cities, {PIECE_LIMITS.road} roads.</small>
    </div>
  );
}
