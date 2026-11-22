/**
 * "Who goes first?" before the opening round: the top of the Players list
 * (e.g. oldest first), or everyone rolls and the highest goes first, with
 * tied players rolling again. The opening then goes round the table from
 * that player and back (see openingSequence in model/pieces.ts).
 */
import { firstPlayer, rulesOf } from '../../model/pieces';
import { useGame } from '../../state/store';

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function FirstPlayer({ go }: { go?: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const { firstPlayerBy, startRolls } = rulesOf(state);
  const status = firstPlayer(state);
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?';
  const color = (id: string) => state.players.find((p) => p.id === id)?.color;
  const rolling = !status.decided ? status.waiting[0] : null;
  const anyRolls = Object.values(startRolls).some((r) => r.length);

  return (
    <div className="palette first-player">
      <div className="row">
        <b>Who goes first?</b>
      </div>
      <div className="segmented full" role="tablist" aria-label="How to pick the first player">
        <button className={firstPlayerBy === 'list' ? 'on' : ''} onClick={() => dispatch({ type: 'game/setRules', rules: { firstPlayerBy: 'list' } })}>
          Top of player list
        </button>
        <button className={firstPlayerBy === 'dice' ? 'on' : ''} onClick={() => dispatch({ type: 'game/setRules', rules: { firstPlayerBy: 'dice' } })}>
          🎲 Roll for it
        </button>
      </div>

      {firstPlayerBy === 'list' ? (
        <p className="hint">
          {status.decided && <><b>{name(status.player)}</b> goes first. </>}
          Put the oldest player (or whoever starts) at the top of the{' '}
          {go ? (
            <button className="link inline" onClick={() => go('players')}>
              Players list
            </button>
          ) : (
            'Players list'
          )}
          , then the rest in seating order.
        </p>
      ) : (
        <>
          <ul className="start-rolls">
            {state.players.map((p) => (
              <li key={p.id} className={p.id === rolling ? 'on' : ''}>
                <span className="swatch" style={{ background: p.color }} />
                <span className="name">{p.name}</span>
                <span className="rolls">{(startRolls[p.id] ?? []).join(' → ') || '–'}</span>
              </li>
            ))}
          </ul>
          {status.decided ? (
            <p>
              <b>{name(status.player)}</b> goes first.
            </p>
          ) : (
            <>
              {status.tied.length > 0 && (
                <p className="warning">Tie! {status.tied.map(name).join(' and ')} roll again.</p>
              )}
              <p>
                <span className="dot" style={{ background: color(rolling!) }} />
                What did <b>{name(rolling!)}</b> roll?
              </p>
              <div className="roll-grid">
                {TOTALS.map((t) => (
                  <button key={t} className="num" onClick={() => dispatch({ type: 'game/addStartRoll', player: rolling!, total: t })}>
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}
          {anyRolls && (
            <button className="link" onClick={() => dispatch({ type: 'game/clearStartRolls' })}>
              Clear rolls
            </button>
          )}
        </>
      )}
    </div>
  );
}
