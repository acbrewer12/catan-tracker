/**
 * "Who goes first?" before the opening round.
 * Oldest first: rank players by age; the opening goes oldest to youngest,
 * then youngest to oldest, and play starts with the oldest going clockwise.
 * Roll for it: highest roll starts (ties re-roll); the opening goes clockwise
 * from them and back. See openingSequence in model/pieces.ts.
 */
import { ageOrderOf, firstPlayer, rulesOf } from '../../model/pieces';
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
  const ages = ageOrderOf(state);
  function moveAge(i: number, delta: -1 | 1) {
    const next = [...ages];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    dispatch({ type: 'game/setRules', rules: { ageOrder: next } });
  }

  return (
    <div className="palette first-player">
      <div className="row">
        <b>Who goes first?</b>
      </div>
      <div className="segmented full" role="tablist" aria-label="How to pick the first player">
        <button className={firstPlayerBy === 'list' ? 'on' : ''} onClick={() => dispatch({ type: 'game/setRules', rules: { firstPlayerBy: 'list' } })}>
          👴 Oldest first
        </button>
        <button className={firstPlayerBy === 'dice' ? 'on' : ''} onClick={() => dispatch({ type: 'game/setRules', rules: { firstPlayerBy: 'dice' } })}>
          🎲 Roll for it
        </button>
      </div>

      {firstPlayerBy === 'list' ? (
        <>
          <p className="hint">Order by age, oldest at the top:</p>
          <ol className="age-order">
            {ages.map((id, i) => (
              <li key={id}>
                <span className="swatch" style={{ background: color(id) }} />
                <span className="name">{name(id)}</span>
                <button className="icon-btn" aria-label={`${name(id)} is older`} disabled={i === 0} onClick={() => moveAge(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn" aria-label={`${name(id)} is younger`} disabled={i === ages.length - 1} onClick={() => moveAge(i, 1)}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p className="hint">
            Opening: oldest to youngest, then youngest to oldest. Then <b>{name(ages[0])}</b> starts and play goes clockwise in the{' '}
            {go ? (
              <button className="link inline" onClick={() => go('players')}>
                seating order on Players
              </button>
            ) : (
              'seating order on Players'
            )}
            .
          </p>
        </>
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
