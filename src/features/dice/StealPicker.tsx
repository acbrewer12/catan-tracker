/**
 * Inline "who did they steal from" picker, shown under the robber on the
 * Pieces tab. Logs a steal in the card log. When the user is the thief or the
 * victim it asks which card (that changes the user's hand); a steal between
 * two other players is noted but doesn't change anything tracked.
 */
import { useState } from 'react';
import { handEstimates } from '../../model/cards';
import { robberVictims } from '../../model/pieces';
import type { PlayerId, Resource } from '../../model/types';
import { useGame } from '../../state/store';
import { ResourceChoice, Swatch, nameOf } from './ui';

export function StealPicker() {
  const { state, dispatch } = useGame();
  const [thief, setThief] = useState<PlayerId | null>(null);
  const [victim, setVictim] = useState<PlayerId | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!state.robber) return null;
  const lastRoller = state.diceHistory[state.diceHistory.length - 1]?.player;
  const who = thief ?? lastRoller ?? state.players[0].id;
  const est = handEstimates(state);
  const victims = robberVictims(state, state.robber, who).filter((id) => !est[id]?.known || est[id].total > 0);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const meId = state.players.find((p) => p.isMe)?.id;

  function log(v: PlayerId, resource?: Resource) {
    dispatch({ type: 'cards/log', event: { kind: 'steal', thief: who, victim: v, resource } });
    setVictim(null);
    setDone(`${nameOf(byId[who])} stole from ${nameOf(byId[v])}.`);
  }

  return (
    <div className="steal-picker">
      <p className="hint">
        Steal by{' '}
        <select value={who} onChange={(e) => { setThief(e.target.value); setVictim(null); setDone(null); }} aria-label="Who stole">
          {state.players.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)}
            </option>
          ))}
        </select>
        {victims.length ? ' from:' : ': nobody here has cards to steal.'}
      </p>
      {victims.length > 0 && (
        <div className="chips">
          {victims.map((id) => (
            <button
              key={id}
              className={`pchip ${victim === id ? 'on' : ''}`}
              onClick={() => (who === meId || id === meId ? setVictim(id) : log(id))}
            >
              <Swatch p={byId[id]} /> {nameOf(byId[id])}
            </button>
          ))}
        </div>
      )}
      {victim && (
        <>
          <p className="hint">Which card was it?</p>
          <ResourceChoice value={null} onChange={(r) => log(victim, r)} />
        </>
      )}
      {done && <p className="hint">✓ {done} Undo if that's wrong.</p>}
    </div>
  );
}
