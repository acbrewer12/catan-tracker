/** Who's playing, their colours, turn order, and which one is you. */
import { PLAYER_COLORS, COLOR_NAMES } from '../../state/slices/players';
import { useGame } from '../../state/store';

export function PlayersSetup() {
  const { state, dispatch } = useGame();
  const max = state.board.layout === 'extended' ? 6 : 4;
  return (
    <div className="screen players">
      <p className="hint">List players in seating order, going clockwise. Mark which one is you so the app can track your cards exactly.</p>
      <ul className="player-list">
        {state.players.map((p, i) => (
          <li key={p.id} className={p.isMe ? 'me' : ''}>
            <div className="row">
              <span className="swatch" style={{ background: p.color }} />
              <input aria-label="Player name" value={p.name} onChange={(e) => dispatch({ type: 'players/rename', id: p.id, name: e.target.value })} />
              <label className="me-toggle">
                <input type="radio" name="me" checked={p.isMe} onChange={() => dispatch({ type: 'players/setMe', id: p.id })} /> Me
              </label>
            </div>
            <div className="row">
              <div className="colors">
                {PLAYER_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={COLOR_NAMES[c]}
                    className={`color ${p.color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    onClick={() => dispatch({ type: 'players/setColor', id: p.id, color: c })}
                  />
                ))}
              </div>
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => dispatch({ type: 'players/move', id: p.id, delta: -1 })}>↑</button>
              <button className="icon-btn" aria-label="Move down" disabled={i === state.players.length - 1} onClick={() => dispatch({ type: 'players/move', id: p.id, delta: 1 })}>↓</button>
              <button className="icon-btn" aria-label="Remove player" disabled={state.players.length <= 2} onClick={() => dispatch({ type: 'players/remove', id: p.id })}>✕</button>
            </div>
          </li>
        ))}
      </ul>
      {state.players.length < max && <button onClick={() => dispatch({ type: 'players/add' })}>+ Add player</button>}
      {state.players.length > max && <p className="warning">This board size is usually played with up to {max} players.</p>}
    </div>
  );
}
