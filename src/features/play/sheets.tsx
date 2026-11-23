/**
 * Play tab pop-ups that need the board: building (tap a glowing spot) and
 * the robber (tap a tile, then who was stolen from). Card-only pop-ups
 * (trades, dev cards, discards) reuse the Dice tab's CardForm.
 */
import { useState } from 'react';
import { HexBoard } from '../../components/HexBoard';
import { COST, canAfford, handEstimates, replay } from '../../model/cards';
import { checkBuilding, checkRoad, piecesLeft, robberVictims } from '../../model/pieces';
import { RESOURCES, type PlayerId, type Resource } from '../../model/types';
import { useGame } from '../../state/store';
import { ResList, ResourceChoice, Sheet, Swatch, nameOf } from '../dice/ui';
import { PiecesLayer } from './PiecesLayer';

type BuildKind = 'road' | 'settlement' | 'city';
const BUILD_TABS: Array<{ id: BuildKind; icon: string; label: string }> = [
  { id: 'road', icon: '➖', label: 'Road' },
  { id: 'settlement', icon: '🏠', label: 'Settlement' },
  { id: 'city', icon: '🏙️', label: 'City' },
];

export function BuildSheet({ player, onClose }: { player: PlayerId; onClose: () => void }) {
  const { state, dispatch } = useGame();
  const [kind, setKind] = useState<BuildKind>('road');
  const [built, setBuilt] = useState<string[]>([]);
  const p = state.players.find((x) => x.id === player);
  const est = handEstimates(state)[player];
  const freeRoads = replay(state.cardLog, undefined)[player]?.freeRoads ?? 0;
  const left = piecesLeft(state, player);

  const vertexOk = (v: string) => {
    if (kind === 'settlement') return checkBuilding(state, v, player, 'settlement').length === 0;
    if (kind === 'city') {
      const b = state.pieces.buildings[v];
      return !!b && b.player === player && b.kind === 'settlement' && checkBuilding(state, v, player, 'city').length === 0;
    }
    return false;
  };
  const edgeOk = (e: string) => kind === 'road' && checkRoad(state, e, player).length === 0;

  const free = kind === 'road' && freeRoads > 0;
  const affordable = p?.isMe
    ? canAfford(state.hands[player]?.resources ?? { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }, kind)
    : RESOURCES.every((r) => est.resources[r].max >= (COST[kind][r] ?? 0));

  function done(what: string) {
    setBuilt([...built, what]);
  }

  return (
    <Sheet title={`${nameOf(p)} ${p?.isMe ? 'build' : 'builds'}`} onClose={onClose}>
      <div className="segmented full">
        {BUILD_TABS.map((t) => (
          <button key={t.id} className={kind === t.id ? 'on' : ''} onClick={() => setKind(t.id)}>
            <span>{t.icon}</span>
            <small>
              {t.label} ({left[t.id]} left)
            </small>
          </button>
        ))}
      </div>
      <p className="hint">
        {free ? (
          <>Free road from Road Building ({freeRoads} left).</>
        ) : (
          <>
            Costs <ResList res={COST[kind]} />.{' '}
            {!affordable && (
              <span className="warning">
                {p?.isMe ? "Your hand doesn't cover it; fix your cards if that's wrong." : "The app didn't expect them to have these cards. Build it anyway and their hand estimate adjusts."}
              </span>
            )}
          </>
        )}
      </p>
      <HexBoard
        board={state.board}
        robber={state.robber}
        onVertexClick={(v) => {
          dispatch({ type: 'pieces/setBuilding', vertex: v, player, kind: kind === 'city' ? 'city' : 'settlement' });
          done(kind);
        }}
        vertexFilter={(v) => vertexOk(v.id)}
        onEdgeClick={(e) => {
          dispatch({ type: 'pieces/setRoad', edge: e, player });
          done('road');
        }}
        edgeFilter={(e) => edgeOk(e.id)}
      >
        <PiecesLayer state={state} />
      </HexBoard>
      <p className="hint">
        {built.length
          ? `✓ Built: ${built.join(', ')}. Tap another glowing spot, or Done.`
          : kind === 'city'
            ? 'Tap one of their glowing settlements to upgrade it.'
            : `Tap a glowing ${kind === 'road' ? 'edge' : 'corner'} to place it.`}
      </p>
      <button className="primary" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}

export function RobberSheet({ thief, onClose }: { thief: PlayerId; onClose: () => void }) {
  const { state, dispatch } = useGame();
  const [moved, setMoved] = useState(false);
  const [victim, setVictim] = useState<PlayerId | null>(null);
  const est = handEstimates(state);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const meId = state.players.find((p) => p.isMe)?.id;
  const victims = state.robber && moved ? robberVictims(state, state.robber, thief).filter((id) => id !== meId || est[id]?.total > 0) : [];
  const hex = state.robber ? state.board.hexes[state.robber] : null;

  function steal(v: PlayerId, resource?: Resource) {
    dispatch({ type: 'cards/log', event: { kind: 'steal', thief, victim: v, resource } });
    onClose();
  }

  return (
    <Sheet title={`${nameOf(byId[thief])} ${byId[thief]?.isMe ? 'move' : 'moves'} the robber`} onClose={onClose}>
      <p className="hint">{moved ? 'Robber placed. Tap another tile to change it.' : 'Tap the tile the robber goes to.'}</p>
      <HexBoard
        board={state.board}
        robber={state.robber}
        onHexClick={(h) => {
          if (h !== state.robber) dispatch({ type: 'robber/move', hex: h });
          setMoved(true);
          setVictim(null);
        }}
      >
        <PiecesLayer state={state} />
      </HexBoard>
      {!moved && (
        <button className="link" onClick={() => setMoved(true)}>
          It's already on the right tile
        </button>
      )}
      {moved && hex && (
        <>
          <span className="label">Stole from</span>
          {victims.length ? (
            <div className="chips">
              {victims.map((id) => (
                <button key={id} className={`pchip ${victim === id ? 'on' : ''}`} onClick={() => (thief === meId || id === meId ? setVictim(id) : steal(id))}>
                  <Swatch p={byId[id]} /> {nameOf(byId[id])}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">Nobody on this tile can be stolen from.</p>
          )}
          {victim && (
            <>
              <p className="hint">Which card was it?</p>
              <ResourceChoice value={null} onChange={(r) => steal(victim, r)} />
            </>
          )}
          <button onClick={onClose}>{victims.length ? 'No steal' : 'Done'}</button>
        </>
      )}
    </Sheet>
  );
}
