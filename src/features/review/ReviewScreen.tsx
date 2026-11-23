/**
 * Review tab: finish and save games, look back at one game's decisions, see
 * patterns across saved games, and control what the planner learned.
 *
 * Analysis is in model/review.ts, saving in state/archive.tsx, learning in
 * model/learning.ts. Only the user's own decisions are judged; opponents show
 * up only through public information (points, trades, robber).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HexBoard, S } from '../../components/HexBoard';
import { topologyFor } from '../../model/board';
import { gameId, hasPlay, type ArchivedGame } from '../../model/archive';
import { openingEnd, stateAt } from '../../model/history';
import { finalPoints, reviewGame, type GameReview, type LessonId, type Moment, type Tone } from '../../model/review';
import type { GameState, PlayerId, VertexId } from '../../model/types';
import { useArchive } from '../../state/archive';
import { useGame } from '../../state/store';
import { PiecesLayer } from '../play/PiecesLayer';
import './review.css';

type View = { kind: 'home' } | { kind: 'game'; id: 'current' | string };

const TONE_ICON: Record<Tone, string> = { good: '✅', tip: '💡', mistake: '⚠️' };
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const dateText = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Imported');
const nameOf = (s: GameState, id: PlayerId | null | undefined) => s.players.find((p) => p.id === id)?.name ?? '?';
const meOf = (s: GameState) => s.players.find((p) => p.isMe)?.id;

export function ReviewScreen() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const { state } = useGame();
  const { archive } = useArchive();
  if (view.kind === 'game') {
    const saved = view.id === 'current' ? null : archive.games.find((g) => g.id === view.id);
    // The live game keeps the winner it was saved with, if it was finished.
    const liveSaved = view.id === 'current' ? archive.games.find((g) => g.id === gameId(state) && g.finished) : null;
    if (view.id === 'current' || saved)
      return (
        <GameReviewView
          game={saved ? saved.state : state}
          winner={saved ? saved.winner : liveSaved ? liveSaved.winner : undefined}
          live={!saved}
          onBack={() => setView({ kind: 'home' })}
        />
      );
  }
  return <Home open={(id) => setView({ kind: 'game', id })} />;
}

// ---------------------------------------------------------------------------
// Home: this game, saved games, patterns, learning, backup

function Home({ open }: { open: (id: 'current' | string) => void }) {
  const { state } = useGame();
  const { archive, storageError } = useArchive();
  const finishedGames = archive.games.filter((g) => g.finished);
  return (
    <div className="screen review">
      {storageError && <p className="review-error">{storageError}</p>}
      {hasPlay(state) ? <ThisGame open={open} /> : <p className="hint">Play a game with the Play or Dice tab, then come back here to review it and save it.</p>}
      {finishedGames.length > 0 && <Patterns games={finishedGames} />}
      <LearningCard />
      <section className="review-section">
        <h2>Saved games</h2>
        {archive.games.length ? (
          <ul className="game-list">
            {archive.games.map((g) => (
              <SavedGameRow key={g.id} g={g} open={() => open(g.id)} />
            ))}
          </ul>
        ) : (
          <p className="hint">No saved games yet. Finish a game above to save it. Starting a new game also keeps the old one here.</p>
        )}
      </section>
      <Backup />
    </div>
  );
}

function ThisGame({ open }: { open: (id: 'current') => void }) {
  const { state } = useGame();
  const { save, archive } = useArchive();
  const [finishing, setFinishing] = useState(false);
  const me = meOf(state);
  const points = useMemo(() => finalPoints(state), [state]);
  const saved = archive.games.find((g) => g.id === gameId(state));
  return (
    <section className="review-section this-game">
      <h2>This game</h2>
      <p className="hint">
        Turn {state.diceHistory.length}. You have {me ? points[me] : 0} points.
        {saved?.finished ? ` Saved: ${saved.winner ? `${nameOf(state, saved.winner)} won` : 'no winner'}.` : ''}
      </p>
      <div className="row wrap">
        <button className="primary" onClick={() => open('current')}>
          📈 Review this game
        </button>
        <button onClick={() => setFinishing((f) => !f)}>🏁 Finish and save…</button>
      </div>
      {finishing && (
        <div className="finish">
          <b>Who won?</b>
          <div className="winner-grid">
            {state.players.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  save(state, p.id, true);
                  setFinishing(false);
                  open('current');
                }}
              >
                <span className="swatch small" style={{ background: p.color }} />
                <span className="grow">{p.isMe ? `${p.name} (you)` : p.name}</span>
                <small>{points[p.id]} pts</small>
              </button>
            ))}
          </div>
          <button
            className="link"
            onClick={() => {
              save(state, null, true);
              setFinishing(false);
            }}
          >
            Nobody: we stopped early
          </button>
          <p className="hint small">Points shown are what's on the board (plus your own VP cards). Saving keeps the game in this phone's storage.</p>
        </div>
      )}
    </section>
  );
}

function SavedGameRow({ g, open }: { g: ArchivedGame; open: () => void }) {
  const { remove } = useArchive();
  const s = g.state;
  const me = meOf(s);
  const order = [...s.players].sort((a, b) => Number(b.id === g.winner) - Number(a.id === g.winner) || (g.points[b.id] ?? 0) - (g.points[a.id] ?? 0));
  const place = order.findIndex((p) => p.id === me) + 1;
  const result = !g.finished ? 'Not finished' : g.winner === me ? '🏆 You won' : g.winner ? `${nameOf(s, g.winner)} won · you ${ordinal(place)}` : 'No winner';
  return (
    <li className="game-row">
      <button className="tip-card" onClick={open}>
        <div className="tip-head">
          <span className="grow">
            <b>{dateText(g.savedAt)}</b> · {s.players.length} players · {s.diceHistory.length} turns
          </span>
        </div>
        <div className="why">
          {result} · you {me ? g.points[me] ?? 0 : 0} pts
        </div>
      </button>
      <button
        className="icon-btn"
        aria-label="Delete saved game"
        onClick={() => {
          if (window.confirm('Delete this saved game? It will also stop counting toward what the planner learned.')) remove(g.id);
        }}
      >
        🗑️
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Patterns across games

const LESSON_SHORT: Record<LessonId, string> = {
  opening: 'Starting spots weaker than what was open',
  sevens: 'Cards lost to 7s',
  missedBuilds: 'Turns ended with an unbuilt city or settlement',
  trades: 'Trades that helped the other player as much or more',
  bank: 'Bank trades that skipped your harbor rate',
  robber: "Robber on someone who wasn't leading",
  devCards: 'Dev cards left unplayed',
};

function Patterns({ games }: { games: ArchivedGame[] }) {
  const sum = useMemo(() => {
    const reviews = games.map((g) => reviewGame(g.state, g.winner, { quick: true })).filter((r): r is GameReview => !!r);
    const counts = new Map<LessonId, number>();
    for (const r of reviews) for (const l of r.lessons) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
    const wins = reviews.filter((r) => r.winner === r.me).length;
    const withWinner = reviews.filter((r) => r.winner).length;
    const avgPlace = withWinner ? reviews.filter((r) => r.winner).reduce((s, r) => s + r.place, 0) / withWinner : 0;
    const avgPts = reviews.length ? reviews.reduce((s, r) => s + (r.points[r.me] ?? 0), 0) / reviews.length : 0;
    const lost = reviews.reduce((s, r) => s + r.stats.cardsLostToSevens, 0);
    return { n: reviews.length, wins, avgPlace, avgPts, lost, recurring: [...counts.entries()].filter(([, c]) => c >= 2 || reviews.length === 1).sort((a, b) => b[1] - a[1]) };
  }, [games]);
  return (
    <section className="review-section">
      <h2>Across your games</h2>
      <div className="stat-row">
        <div className="stat">
          <b>
            {sum.wins} / {sum.n}
          </b>
          <small>wins</small>
        </div>
        <div className="stat">
          <b>{sum.avgPlace ? sum.avgPlace.toFixed(1) : '–'}</b>
          <small>avg place</small>
        </div>
        <div className="stat">
          <b>{sum.avgPts.toFixed(1)}</b>
          <small>avg points</small>
        </div>
        <div className="stat">
          <b>{sum.lost}</b>
          <small>cards lost to 7s</small>
        </div>
      </div>
      {sum.recurring.length > 0 && (
        <>
          <p className="hint small">Keeps coming up:</p>
          <ul className="plain-list">
            {sum.recurring.slice(0, 4).map(([id, c]) => (
              <li key={id}>
                💡 {LESSON_SHORT[id]}: <b>{c} of {sum.n}</b> game{sum.n > 1 ? 's' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// What the planner learned

function LearningCard() {
  const { archive, learning, setSettings } = useArchive();
  const on = archive.settings.learn;
  const counted = archive.games.filter((g) => g.finished && g.winner && g.savedAt >= archive.settings.learnSince).length;
  return (
    <section className="review-section learning">
      <h2>What the planner learned</h2>
      {learning ? (
        <>
          <p className="hint small">
            From {learning.games} finished game{learning.games > 1 ? 's' : ''}. Small nudges only: a strategy moves at most one round, and rival weights only make trades stricter.
          </p>
          {learning.notes.length ? (
            <ul className="plain-list">
              {learning.notes.map((n, i) => (
                <li key={i} className={on ? '' : 'off'}>
                  {n.kind === 'strategy' ? '🧭' : '🤝'} {n.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint small">Nothing stands out yet, so the planner is unchanged.</p>
          )}
        </>
      ) : (
        <p className="hint small">
          Save {Math.max(1, 2 - counted)} more finished game{2 - counted === 1 ? '' : 's'} with a winner and the planner starts learning what wins in your group.
        </p>
      )}
      <div className="row wrap">
        <label className="toggle">
          <input type="checkbox" checked={on} onChange={(e) => setSettings({ learn: e.target.checked })} />
          Use it in Tips and Play
        </label>
        <button
          className="link"
          onClick={() => {
            if (window.confirm('Reset what the planner learned? Your saved games stay for review; only games saved from now on will count.'))
              setSettings({ learnSince: Date.now() });
          }}
        >
          Reset learning
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Backup

function Backup() {
  const { exportText, importText, archive } = useArchive();
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const download = () => {
    const blob = new Blob([exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catan-games-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`Exported ${archive.games.length} game${archive.games.length === 1 ? '' : 's'}.`);
  };
  return (
    <section className="review-section">
      <h2>Backup</h2>
      <p className="hint small">Saved games live on this phone only. Export a file to keep a copy or move them to another phone.</p>
      <div className="row wrap">
        <button onClick={download} disabled={!archive.games.length}>
          ⬇️ Export games
        </button>
        <button onClick={() => file.current?.click()}>⬆️ Import games</button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const r = importText(await f.text());
            setMsg('error' in r ? r.error : r.added ? `Imported ${r.added} new game${r.added === 1 ? '' : 's'}.` : 'Those games are already here.');
          }}
        />
      </div>
      {msg && <p className="hint small">{msg}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One game's review

function GameReviewView({ game, winner, live, onBack }: { game: GameState; winner: PlayerId | null | undefined; live: boolean; onBack: () => void }) {
  const [review, setReview] = useState<GameReview | null | 'pending'>('pending');
  const [filter, setFilter] = useState<'all' | 'improve'>('improve');
  useEffect(() => {
    setReview('pending');
    // Let the "Looking back" message paint first: the replay runs the planner once per turn.
    const t = setTimeout(() => setReview(reviewGame(game, winner)), 30);
    return () => clearTimeout(t);
  }, [game, winner]);

  const head = (
    <div className="row">
      <button className="icon-btn" onClick={onBack}>
        ‹ Back
      </button>
      <h2 className="grow review-title">{live ? 'This game' : 'Saved game'}</h2>
    </div>
  );
  if (review === 'pending')
    return (
      <div className="screen review">
        {head}
        <p className="hint">Looking back over every turn…</p>
      </div>
    );
  if (!review)
    return (
      <div className="screen review">
        {head}
        <p className="hint">Mark which player is you on the Players tab to get a review.</p>
      </div>
    );

  const { me, points, place } = review;
  const result =
    review.winner === me
      ? `🏆 You won with ${points[me]} points.`
      : review.winner
        ? `${nameOf(game, review.winner)} won. You finished ${ordinal(place)} with ${points[me]} points.`
        : live
          ? `In progress: you have ${points[me]} points.`
          : `No winner recorded. You had ${points[me]} points.`;
  // Opening picks have their own board section above.
  const shown = review.moments.filter((m) => m.topic !== 'opening' && (filter === 'all' || m.tone !== 'good'));
  return (
    <div className="screen review">
      {head}
      <section className="review-section">
        <p className="result">{result}</p>
        <div className="score-chips">
          {[...game.players]
            .sort((a, b) => points[b.id] - points[a.id])
            .map((p) => (
              <span key={p.id} className={`score-chip ${p.id === me ? 'me' : ''}`}>
                <span className="swatch small" style={{ background: p.color }} />
                {p.name} <b>{points[p.id]}</b>
              </span>
            ))}
        </div>
        <p className="hint small">Opponents' points are what was on the board; hidden VP cards aren't counted.</p>
      </section>

      <section className="review-section">
        <h2>Work on these</h2>
        {review.lessons.length ? (
          <ol className="lessons">
            {review.lessons.slice(0, 3).map((l) => (
              <li key={l.id} className="tip-card">
                <b>{l.text}</b>
                <span className="why">{l.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">Nothing big to fix in this game. Keep it up.</p>
        )}
      </section>

      {review.strengths.length > 0 && (
        <section className="review-section">
          <h2>What went well</h2>
          <ul className="plain-list">
            {review.strengths.map((s, i) => (
              <li key={i}>✅ {s}</li>
            ))}
          </ul>
        </section>
      )}

      <OpeningBoard game={game} moments={review.moments.filter((m) => m.topic === 'opening')} />

      <section className="review-section">
        <div className="row">
          <h2 className="grow">Turn by turn</h2>
          <div className="segmented">
            <button className={filter === 'improve' ? 'on' : ''} onClick={() => setFilter('improve')}>
              To improve
            </button>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              All
            </button>
          </div>
        </div>
        {shown.length ? (
          <ul className="moments">
            {shown.map((m, i) => (
              <MomentRow key={i} m={m} />
            ))}
          </ul>
        ) : (
          <p className="hint">No moments to show.</p>
        )}
      </section>

      <details className="why-plan">
        <summary>Numbers</summary>
        <ul className="plain-list small">
          <li>Your turns: {review.stats.myTurns}</li>
          <li>
            Starting pips: {review.stats.openingPips} (others averaged {Math.round(review.stats.tableOpeningPips)})
          </li>
          <li>Cards lost to 7s: {review.stats.cardsLostToSevens}; turns ended with 8+ cards: {review.stats.bigHandTurns}</li>
          <li>Cards stolen from you: {review.stats.cardsStolenFromMe}</li>
          <li>
            Player trades: {review.stats.playerTrades} ({review.stats.badTrades} not in your favour)
          </li>
          <li>
            Dev cards: bought {review.stats.devBought}, played {review.stats.devPlayed}
          </li>
        </ul>
        <p className="hint small">Judged with the same planner as the Tips tab, using the board as it was at each moment. The robber's past position isn't recorded, so it's left out.</p>
      </details>
    </div>
  );
}

function MomentRow({ m }: { m: Moment }) {
  return (
    <li className={`moment ${m.tone}`}>
      <span className="moment-icon">{TONE_ICON[m.tone]}</span>
      <div className="grow">
        <div className="moment-title">{m.title}</div>
        {m.detail && <div className="why">{m.detail}</div>}
      </div>
    </li>
  );
}

/** The board after the opening, with your picks and any better spot marked. */
function OpeningBoard({ game, moments }: { game: GameState; moments: Moment[] }) {
  const opened = useMemo(() => stateAt(game, openingEnd(game), 0), [game]);
  if (!moments.length) return null;
  const topo = topologyFor(game.board.layout);
  const ring = (v: VertexId | undefined, cls: string, key: string) => {
    const p = v && topo.vertices[v];
    return p ? <circle key={key} className={cls} cx={p.x * S} cy={p.y * S} r={34} /> : null;
  };
  const better = moments.some((m) => m.better);
  return (
    <section className="review-section">
      <h2>Your opening</h2>
      <HexBoard board={game.board} rotatable={false}>
        <PiecesLayer state={opened} />
        <g pointerEvents="none">
          {moments.map((m, i) => ring(m.vertex, 'ring-mine', `m${i}`))}
          {moments.map((m, i) => ring(m.better, 'ring-better', `b${i}`))}
        </g>
      </HexBoard>
      <p className="hint small">
        <span className="key mine" /> your settlements{better && (
          <>
            {' '}
            <span className="key better" /> a better spot that was open
          </>
        )}
      </p>
      <ul className="moments">
        {moments.map((m, i) => (
          <MomentRow key={i} m={m} />
        ))}
      </ul>
    </section>
  );
}
