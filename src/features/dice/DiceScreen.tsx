/**
 * Dice tab: enter each roll with one tap, see who picks up what, keep your
 * hand exact and an estimate of everyone else's, and look at roll stats.
 */
import { useMemo, useState } from 'react';
import { TERRAIN_STYLE } from '../../components/theme';
import { BUILD_LABEL, COST, DEV_LABEL, DEV_KINDS, bankLeft, canAfford, devCardsLeft, discardCount, handEstimates, rollPayout, toCounts, type HandEstimate } from '../../model/cards';
import { pips, rollChance } from '../../model/board';
import { RESOURCES, type BuildItem, type CardEvent, type DiceRoll, type PlayerId } from '../../model/types';
import type { NewCardEvent } from '../../state/slices/dice';
import { useGame } from '../../state/store';
import { tradeRates } from '../../model/suggestionsPlay';
import { CardForm, type FormKind } from './forms';
import { ResList, Swatch, describeEvent, icon, nameOf } from './ui';
import './dice.css';

type View = 'roll' | 'cards' | 'stats';
const VIEW_KEY = 'catan-tracker:dice-view';

let rollSeq = 0;
const newRollId = () => `r${Date.now().toString(36)}${(rollSeq++).toString(36)}`;

export function DiceScreen({ go }: { go: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || 'roll';
    } catch {
      return 'roll';
    }
  });
  const [form, setForm] = useState<{ kind: FormKind; player?: PlayerId } | null>(null);
  const est = useMemo(() => handEstimates(state), [state]);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const log = (event: NewCardEvent) => dispatch({ type: 'cards/log', event });

  return (
    <div className="screen dice">
      <div className="segmented full">
        {(['roll', 'cards', 'stats'] as View[]).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => pick(v)}>
            {v === 'roll' ? '🎲 Roll' : v === 'cards' ? '🃏 Cards' : '📊 Stats'}
          </button>
        ))}
      </div>
      {view === 'roll' && <RollView est={est} openForm={(kind, player) => setForm({ kind, player })} go={go} />}
      {view === 'cards' && <CardsView est={est} openForm={(kind, player) => setForm({ kind, player })} />}
      {view === 'stats' && <StatsView est={est} />}
      {form && (
        <CardForm
          kind={form.kind}
          player={form.player}
          players={state.players}
          est={est}
          onLog={log}
          onClose={() => setForm(null)}
          onKnight={(p) => setTimeout(() => setForm({ kind: 'steal', player: p }), 0)}
        />
      )}
    </div>
  );
}

type Open = (kind: FormKind, player?: PlayerId) => void;

// ---------------------------------------------------------------------------

function nextRoller(players: { id: PlayerId }[], history: DiceRoll[]): PlayerId {
  const last = history[history.length - 1]?.player;
  const i = players.findIndex((p) => p.id === last);
  return players[i < 0 ? 0 : (i + 1) % players.length].id;
}

function RollView({ est, openForm, go }: { est: Record<PlayerId, HandEstimate>; openForm: Open; go: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const { players, diceHistory } = state;
  const [roller, setRoller] = useState<PlayerId | null>(null);
  const autoRoller = nextRoller(players, diceHistory);
  const who = players.some((p) => p.id === roller) ? roller! : autoRoller;
  const last = diceHistory[diceHistory.length - 1];
  const me = players.find((p) => p.isMe)!;
  const buildings = Object.keys(state.pieces.buildings).length;

  function add(total: number) {
    dispatch({ type: 'dice/add', roll: { id: newRollId(), total, player: who, at: Date.now() } });
    setRoller(null);
  }

  return (
    <>
      <section className="card">
        <div className="row between">
          <span className="label">Who's rolling</span>
          {roller && (
            <button className="link" onClick={() => setRoller(null)}>
              back to turn order
            </button>
          )}
        </div>
        <div className="chips">
          {players.map((p) => (
            <button key={p.id} className={`pchip ${who === p.id ? 'on' : ''}`} onClick={() => setRoller(p.id)}>
              <Swatch p={p} /> {nameOf(p)}
            </button>
          ))}
        </div>
        <div className="dice-pad">
          {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
            <button key={n} className={`die-btn ${n === 7 ? 'seven' : ''} ${n === 6 || n === 8 ? 'red' : ''}`} onClick={() => add(n)}>
              {n}
              <small>{n === 7 ? 'robber' : '•'.repeat(pips(n))}</small>
            </button>
          ))}
        </div>
        {!buildings && <p className="hint">No settlements on the board yet. Place them on the Pieces tab so rolls can pay out.</p>}
      </section>

      {last && <LastRoll roll={last} est={est} meId={me.id} openForm={openForm} go={go} />}

      {diceHistory.length > 0 && (
        <section className="card">
          <span className="label">Recent rolls (newest first)</span>
          <div className="recent">
            {[...diceHistory]
              .reverse()
              .slice(0, 16)
              .map((r) => {
                const p = players.find((x) => x.id === r.player);
                return (
                  <span key={r.id} className={`recent-roll ${r.total === 7 ? 'seven' : ''}`} style={{ borderColor: p?.color }} title={nameOf(p)}>
                    {r.total}
                  </span>
                );
              })}
          </div>
        </section>
      )}
    </>
  );
}

function LastRoll({ roll, est, meId, openForm, go }: { roll: DiceRoll; est: Record<PlayerId, HandEstimate>; meId: PlayerId; openForm: Open; go: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const { players } = state;
  const prod = state.cardLog.find((e): e is Extract<CardEvent, { kind: 'production' }> => e.kind === 'production' && e.rollId === roll.id);
  const gains = prod?.gains ?? {};
  // What the robber blocked / bank couldn't pay, judged from the board as it is now.
  const { blocked, shortages } = useMemo(() => rollPayout(state, roll.total, bankLeft(state)), [state, roll.total]);
  const roller = players.find((p) => p.id === roll.player);

  return (
    <section className={`card last-roll ${roll.total === 7 ? 'seven' : ''}`}>
      <div className="row between">
        <div className="big-roll">
          <span>{roll.total}</span>
          <small>{roller ? `${nameOf(roller)} rolled` : 'rolled'}</small>
        </div>
        <button className="icon-btn" onClick={() => dispatch({ type: 'dice/removeLast' })}>
          ↶ Remove roll
        </button>
      </div>

      {roll.total === 7 ? (
        <SevenSteps est={est} roller={roll.player} openForm={openForm} go={go} />
      ) : (
        <ul className="pickups">
          <li className="me">
            <span className="who">You pick up</span>
            <ResList res={gains[meId]} empty="nothing this time" />
            {blocked[meId] && (
              <span className="blocked">
                🚫 robber blocked <ResList res={blocked[meId]} />
              </span>
            )}
          </li>
        </ul>
      )}
      {shortages.length > 0 && (
        <p className="hint warning">Bank ran short of {shortages.map(icon).join(' ')}, so it paid less than usual.</p>
      )}
      {gains[meId] && <p className="hint">Added to your hand on the Cards tab.</p>}
    </section>
  );
}

function SevenSteps({ est, roller, openForm, go }: { est: Record<PlayerId, HandEstimate>; roller?: PlayerId; openForm: Open; go: (id: string) => void }) {
  const { state } = useGame();
  const me = state.players.find((p) => p.isMe)!;
  const mine = discardCount(est[me.id].total);
  return (
    <div className="seven-steps">
      <p>
        <b>Robber!</b> Everyone with more than 7 cards discards half.
      </p>
      {mine ? (
        <ul className="pickups">
          <li className="me">
            <span className="who">You discard {mine}</span>
            <button onClick={() => openForm('discard', me.id)}>Record</button>
          </li>
        </ul>
      ) : (
        <p className="hint">You hold 7 or fewer, so you keep your cards.</p>
      )}
      <div className="row wrap">
        <button onClick={() => go('pieces')}>Move robber</button>
        <button className="primary" onClick={() => openForm('steal', roller)}>
          Record steal
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------


function CardsView({ est, openForm }: { est: Record<PlayerId, HandEstimate>; openForm: Open }) {
  const { state, dispatch } = useGame();
  const me = state.players.find((p) => p.isMe)!;
  const mine = est[me.id];
  const hand = toCounts(Object.fromEntries(RESOURCES.map((r) => [r, mine.resources[r].min])));
  const set = (r: (typeof RESOURCES)[number], d: number) =>
    dispatch({ type: 'cards/log', event: { kind: 'set', player: me.id, resources: { ...hand, [r]: Math.max(0, hand[r] + d) } } });
  const who = (id: PlayerId) => nameOf(state.players.find((p) => p.id === id));
  const [showAll, setShowAll] = useState(false);
  const rates = tradeRates(state, me.id);
  // Only what touches your hand, plus dev cards played in the open (older saves also logged others' cards).
  const mineOnly = (e: CardEvent) => {
    switch (e.kind) {
      case 'production':
        return !!e.gains[me.id];
      case 'trade':
        return e.player === me.id || e.with === me.id;
      case 'steal':
        return e.thief === me.id || e.victim === me.id;
      case 'build':
      case 'playDev':
        return true;
      default:
        return e.player === me.id;
    }
  };
  const log = state.cardLog.filter(mineOnly).reverse();

  return (
    <>
      <section className="card">
        <div className="row between">
          <span className="label">Your hand · {mine.total} cards</span>
          {mine.missedCards && <span className="warning small">didn't add up, check it</span>}
        </div>
        <div className="my-hand">
          {RESOURCES.map((r) => (
            <div key={r} className="res-step" style={{ background: TERRAIN_STYLE[r].fill }}>
              <button className="plus" aria-label={`Add ${r}`} onClick={() => set(r, 1)}>
                {icon(r)}
                <b>{hand[r]}</b>
              </button>
              <button className="minus" aria-label={`Remove ${r}`} disabled={!hand[r]} onClick={() => set(r, -1)}>
                −
              </button>
            </div>
          ))}
        </div>
        <div className="can-build">
          {(['road', 'settlement', 'city', 'devCard'] as BuildItem[]).map((b) => (
            <span key={b} className={`build-chip ${canAfford(hand, b) ? 'yes' : ''}`}>
              {canAfford(hand, b) ? '✓' : '·'} {BUILD_LABEL[b]} <ResList res={COST[b]} />
            </span>
          ))}
        </div>
        {mine.devCards > 0 && (
          <div className="row wrap">
            <span className="label">Dev cards:</span>
            {DEV_KINDS.filter((k) => mine.dev[k]).map((k) => (
              <span key={k} className="build-chip yes">
                {DEV_LABEL[k]} ×{mine.dev[k]}
              </span>
            ))}
          </div>
        )}
        <p className="hint">
          Bank trades:{' '}
          {RESOURCES.map((r) => `${icon(r)} ${rates[r]}:1`).join('  ')}
          {RESOURCES.every((r) => rates[r] === 4) ? ' (no harbor yet)' : ''}
        </p>
        <p className="hint">Rolls and builds update this on their own. Tap a card to fix a count.</p>
      </section>

      <section className="card">
        <span className="label">Record</span>
        <div className="action-grid">
          <button onClick={() => openForm('trade')}>🤝 Trade</button>
          <button onClick={() => openForm('bank')}>🏦 Bank / harbor</button>
          <button onClick={() => openForm('steal')}>🥷 Steal</button>
          <button onClick={() => openForm('discard')}>🗑️ Discard</button>
          <button onClick={() => openForm('buyDev')}>🃏 Buy dev card</button>
          <button onClick={() => openForm('playDev')}>✨ Play dev card</button>
        </div>
        <p className="hint">Roads, settlements and cities are charged when you place them on the Pieces tab.</p>
      </section>

      <section className="card">
        <span className="label">Opponents</span>
        <p className="hint">Only your own cards are tracked. For others the app counts what's played in the open: dev cards bought and knights.</p>
        <ul className="opponents">
          {state.players
            .filter((p) => !p.isMe)
            .map((p) => {
              const e = est[p.id];
              return (
                <li key={p.id}>
                  <div className="row between">
                    <span className="row">
                      <Swatch p={p} /> <b>{p.name}</b>
                    </span>
                    <span>
                      {e.devCards} dev · {e.knightsPlayed}⚔️
                    </span>
                  </div>
                </li>
              );
            })}
        </ul>
      </section>

      <section className="card">
        <span className="label">Card log</span>
        {log.length === 0 && <p className="hint">Nothing yet.</p>}
        <ul className="log">
          {(showAll ? log : log.slice(0, 12)).map((e) => (
            <li key={e.id}>
              <span className="grow">{describeEvent(e, who)}</span>
              <button className="icon-btn" aria-label="Delete entry" onClick={() => dispatch({ type: 'cards/remove', id: e.id })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        {log.length > 12 && (
          <button className="link" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'show less' : `show all ${log.length}`}
          </button>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function StatsView({ est }: { est: Record<PlayerId, HandEstimate> }) {
  const { state } = useGame();
  const rolls = state.diceHistory;
  const counts = Array.from({ length: 13 }, (_, n) => rolls.filter((r) => r.total === n).length);
  const nums = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const top = Math.max(1, ...nums.map((n) => Math.max(counts[n], rollChance(n) * rolls.length)));
  const [sel, setSel] = useState<number | null>(null);

  return (
    <>
      <section className="card">
        <div className="row between">
          <span className="label">Rolls so far: {rolls.length}</span>
          <span className="legend">
            <i className="bar-key" /> rolled <i className="exp-key" /> expected
          </span>
        </div>
        <div className="histo" role="img" aria-label="How often each number was rolled compared with the odds">
          {nums.map((n) => {
            const exp = rollChance(n) * rolls.length;
            return (
              <button key={n} className={`histo-col ${sel === n ? 'on' : ''}`} onClick={() => setSel(sel === n ? null : n)} aria-label={`${n}: rolled ${counts[n]}, expected ${exp.toFixed(1)}`}>
                <div className="histo-plot">
                  <div className={`histo-bar ${n === 7 ? 'seven' : ''}`} style={{ height: `${(counts[n] / top) * 100}%` }} />
                  <div className="histo-exp" style={{ bottom: `${(exp / top) * 100}%` }} />
                </div>
                <span className={n === 6 || n === 8 ? 'red' : ''}>{n}</span>
              </button>
            );
          })}
        </div>
        <p className="hint">
          {sel
            ? `${sel}: rolled ${counts[sel]} time${counts[sel] === 1 ? '' : 's'}, about ${(rollChance(sel) * rolls.length).toFixed(1)} expected.`
            : 'Tap a number for details.'}
        </p>
      </section>

      <section className="card">
        <span className="label">You picked up from rolls</span>
        <table className="table">
          <thead>
            <tr>
              <th />
              {RESOURCES.map((r) => (
                <th key={r}>{icon(r)}</th>
              ))}
              <th>All</th>
            </tr>
          </thead>
          <tbody>
            {state.players.filter((p) => p.isMe).map((p) => {
              const got = est[p.id].produced;
              return (
                <tr key={p.id}>
                  <td>
                    <Swatch p={p} /> {nameOf(p)}
                  </td>
                  {RESOURCES.map((r) => (
                    <td key={r}>{got[r]}</td>
                  ))}
                  <td>
                    <b>{RESOURCES.reduce((s, r) => s + got[r], 0)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <span className="label">Deck</span>
        <p className="hint">Dev cards left in the deck: {devCardsLeft(state)}</p>
      </section>
    </>
  );
}
