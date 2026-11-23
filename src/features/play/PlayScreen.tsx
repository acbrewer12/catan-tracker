/**
 * Play tab: a guided, turn-by-turn front end over the same game log the other
 * tabs use. It focuses on whoever's turn it is: asks what they rolled, shows
 * the pickups, then their hand (exact for you, estimated for others) with one
 * button per thing they can do. Each button opens a pop-up. "Next turn" moves
 * on to the next player. On your own turn it also shows the Tips plan, which
 * updates as you trade and build.
 */
import { useMemo, useState } from 'react';
import { HexBoard } from '../../components/HexBoard';
import { TERRAIN_STYLE } from '../../components/theme';
import { pips } from '../../model/board';
import { BUILD_LABEL, COST, DEV_KINDS, DEV_LABEL, canAfford, discardCount, handEstimates, toCounts, type HandEstimate } from '../../model/cards';
import { boardPoints, legalRoadSpots, legalSettlementSpots, longestRoadHolder, turnOrder } from '../../model/pieces';
import { currentTurn, eventsSince, nextPlayer } from '../../model/turns';
import { RESOURCES, type BuildItem, type CardEvent, type DiceRoll, type Player, type PlayerId, type Resource } from '../../model/types';
import type { NewCardEvent } from '../../state/slices/dice';
import { useGame } from '../../state/store';
import { CardForm, type FormKind } from '../dice/forms';
import { ResList, Swatch, describeEvent, icon, nameOf } from '../dice/ui';
import { FirstPlayer } from '../pieces/FirstPlayer';
import { PlanPanel } from '../tips/Tips';
import { BuildSheet, RobberSheet } from './sheets';
import { PiecesLayer } from './PiecesLayer';
import { AskCard, OfferSheet } from './trades';
import '../dice/dice.css';
import './play.css';

/** Id of the last roll whose turn was ended with "Next turn" (per device). */
const ENDED_KEY = 'catan-tracker:play-ended';

type Popup = { kind: FormKind; player?: PlayerId } | { kind: 'build'; player: PlayerId } | { kind: 'robber'; player: PlayerId } | { kind: 'offer'; player?: PlayerId };
type Declined = { partner: PlayerId; get: Resource };

let rollSeq = 0;
const newRollId = () => `r${Date.now().toString(36)}p${(rollSeq++).toString(36)}`;

function useEnded(): [string | null, (id: string | null) => void] {
  const [ended, setEnded] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ENDED_KEY);
    } catch {
      return null;
    }
  });
  const set = (id: string | null) => {
    setEnded(id);
    try {
      if (id) localStorage.setItem(ENDED_KEY, id);
      else localStorage.removeItem(ENDED_KEY);
    } catch {
      /* ignore */
    }
  };
  return [ended, set];
}

export function PlayScreen({ go }: { go: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const [ended, setEnded] = useEnded();
  const [popup, setPopup] = useState<Popup | null>(null);
  const [roller, setRoller] = useState<PlayerId | null>(null);
  // Player trades refused this turn (cleared when the roll changes).
  const [declined, setDeclined] = useState<{ rollId: string; list: Declined[] }>({ rollId: '', list: [] });
  const est = useMemo(() => handEstimates(state), [state]);
  const me = state.players.find((p) => p.isMe);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const boardEntered = Object.values(state.board.hexes).some((h) => h.terrain);

  if (!boardEntered) {
    return (
      <div className="screen">
        <p className="hint">Enter the board first, then come back here to play.</p>
        <button className="primary" onClick={() => go('board')}>
          Go to Board
        </button>
      </div>
    );
  }

  const turn = currentTurn(state, ended);
  const open = (kind: Popup['kind'], player?: PlayerId) => setPopup({ kind, player } as Popup);
  const log = (event: NewCardEvent) => dispatch({ type: 'cards/log', event });
  const current = 'player' in turn ? byId[turn.player] : undefined;

  function rolled(total: number) {
    if (turn.stage !== 'roll') return;
    dispatch({ type: 'dice/add', roll: { id: newRollId(), total, player: roller ?? turn.player, at: Date.now() } });
    setRoller(null);
  }

  return (
    <div className="screen dice play">
      <TurnBar current={turn.stage === 'roll' && roller ? roller : current?.id} est={est} onPick={turn.stage === 'roll' ? setRoller : undefined} />

      {turn.stage === 'choose-first' && <FirstPlayer go={go} />}

      {turn.stage === 'opening' && <OpeningStep player={turn.player} place={turn.place} go={go} />}

      {turn.stage === 'roll' && (
        <>
          <section className="card turn-card">
            <h2 className="turn-title">
              <Swatch p={byId[roller ?? turn.player]} /> What did {nameOf(byId[roller ?? turn.player])} roll?
            </h2>
            <div className="dice-pad">
              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <button key={n} className={`die-btn ${n === 7 ? 'seven' : ''} ${n === 6 || n === 8 ? 'red' : ''}`} onClick={() => rolled(n)}>
                  {n}
                  <small>{n === 7 ? 'robber' : '•'.repeat(pips(n))}</small>
                </button>
              ))}
            </div>
            <div className="row wrap between">
              <button className="link" onClick={() => open('playDev', roller ?? turn.player)}>
                Played a dev card before rolling?
              </button>
              {state.diceHistory.length > 0 && (
                <button className="link" onClick={() => setEnded(null)}>
                  ↶ Back to the last turn
                </button>
              )}
            </div>
            {roller && <p className="hint">Not their turn by the order, but this roll will be recorded for them.</p>}
          </section>
          <HandCard player={byId[roller ?? turn.player]} est={est[roller ?? turn.player]} />
          {me && (roller ?? turn.player) !== me.id && <MyHandLine me={me} />}
        </>
      )}

      {turn.stage === 'act' && current && (
        <>
          <RollCard roll={turn.roll} player={current} est={est} open={open} />
          <HandCard player={current} est={est[current.id]} />
          {current.isMe && <PlanPanel me={current.id} />}
          {current.isMe && (
            <AskCard
              me={current.id}
              declined={declined.rollId === turn.roll.id ? declined.list : []}
              onDecline={(d) => setDeclined({ rollId: turn.roll.id, list: [...(declined.rollId === turn.roll.id ? declined.list : []), d] })}
            />
          )}
          <section className="card">
            <span className="label">What did {nameOf(current)} do?</span>
            <div className="action-grid play-actions">
              <button onClick={() => open('trade', current.id)}>🤝 Trade with a player</button>
              <button onClick={() => open('bank', current.id)}>🏦 Bank / harbor</button>
              <button onClick={() => open('build', current.id)}>🔨 Build</button>
              <button onClick={() => open('buyDev', current.id)}>🃏 Buy dev card</button>
              <button onClick={() => open('playDev', current.id)}>✨ Play dev card</button>
              <button onClick={() => open('offer', current.isMe ? undefined : current.id)}>🙋 {current.isMe ? 'Someone offers you a trade' : 'They offer you a trade'}</button>
              {current.isMe ? (
                <button onClick={() => go('dice')}>✏️ Fix my cards</button>
              ) : (
                <button onClick={() => open('fixCount', current.id)}>✏️ Correct their count</button>
              )}
            </div>
          </section>
          <TurnLog roll={turn.roll} />
          {!current.isMe && me && <MyHandLine me={me} />}
          <div className="play-next">
            <button className="primary" onClick={() => setEnded(turn.roll.id)}>
              Next turn: {nameOf(byId[nextPlayer(state, current.id)])} ▶
            </button>
          </div>
        </>
      )}

      {popup?.kind === 'build' && <BuildSheet player={popup.player} onClose={() => setPopup(null)} />}
      {popup?.kind === 'robber' && <RobberSheet thief={popup.player} onClose={() => setPopup(null)} />}
      {popup?.kind === 'offer' && <OfferSheet partner={popup.player} onClose={() => setPopup(null)} />}
      {popup && popup.kind !== 'build' && popup.kind !== 'robber' && popup.kind !== 'offer' && (
        <CardForm
          kind={popup.kind}
          player={popup.player}
          players={state.players}
          est={est}
          onLog={log}
          onClose={() => setPopup(null)}
          onKnight={(p) => setPopup({ kind: 'robber', player: p })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Everyone in turn order; the current player stands out. */
function TurnBar({ current, est, onPick }: { current?: PlayerId; est: Record<PlayerId, HandEstimate>; onPick?: (id: PlayerId) => void }) {
  const { state } = useGame();
  const holder = longestRoadHolder(state);
  const order = turnOrder(state);
  return (
    <div className="turn-bar" role="list" aria-label="Turn order">
      {order.map((id) => {
        const p = state.players.find((x) => x.id === id)!;
        return (
          <button key={id} role="listitem" className={`turn-chip ${id === current ? 'on' : ''}`} style={{ borderColor: id === current ? p.color : undefined }} onClick={() => onPick?.(id)} disabled={!onPick && id !== current}>
            <span className="row">
              <Swatch p={p} />
              <b className="name">{nameOf(p)}</b>
            </span>
            <small>
              {boardPoints(state, id, holder)}★ · {cards(est[id]?.total ?? 0)}{est[id]?.devCards ? ` · ${est[id].devCards}🃏` : ''}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function OpeningStep({ player, place, go }: { player: PlayerId; place: 'settlement' | 'road'; go: (id: string) => void }) {
  const { state, dispatch } = useGame();
  const p = state.players.find((x) => x.id === player)!;
  const spots = useMemo(() => new Set(place === 'settlement' ? legalSettlementSpots(state, player) : legalRoadSpots(state, player)), [state, player, place]);
  return (
    <section className="card turn-card">
      <h2 className="turn-title">
        <Swatch p={p} /> Opening round: {p.isMe ? 'place your' : `${p.name} places a`} {place}
      </h2>
      <HexBoard
        board={state.board}
        robber={state.robber}
        onVertexClick={(v) => dispatch({ type: 'pieces/setBuilding', vertex: v, player, kind: 'settlement' })}
        vertexFilter={(v) => place === 'settlement' && spots.has(v.id)}
        onEdgeClick={(e) => dispatch({ type: 'pieces/setRoad', edge: e, player })}
        edgeFilter={(e) => place === 'road' && spots.has(e.id)}
      >
        <PiecesLayer state={state} />
      </HexBoard>
      <p className="hint">Tap a glowing {place === 'settlement' ? 'corner' : 'edge'}. When everyone has placed, play starts with the first roll.</p>
      {p.isMe && (
        <button onClick={() => go('tips')}>💡 See the best starting spots</button>
      )}
    </section>
  );
}

function RollCard({ roll, player, est, open }: { roll: DiceRoll; player: Player; est: Record<PlayerId, HandEstimate>; open: (k: Popup['kind'], p?: PlayerId) => void }) {
  const { state, dispatch } = useGame();
  const prod = state.cardLog.find((e): e is Extract<CardEvent, { kind: 'production' }> => e.kind === 'production' && e.rollId === roll.id);
  const gains = prod?.gains ?? {};
  const since = eventsSince(state, roll);
  const ordered = [...state.players].sort((a, b) => Number(b.id === player.id) - Number(a.id === player.id));

  return (
    <section className={`card last-roll ${roll.total === 7 ? 'seven' : ''}`}>
      <div className="row between">
        <div className="big-roll">
          <span>{roll.total}</span>
          <small>{player.isMe ? 'you rolled' : `${player.name} rolled`}</small>
        </div>
        <button className="icon-btn" onClick={() => dispatch({ type: 'dice/removeLast' })}>
          ↶ Wrong number
        </button>
      </div>
      {roll.total === 7 ? (
        <SevenSteps thief={player.id} est={est} since={since} open={open} />
      ) : Object.keys(gains).length ? (
        <ul className="pickups">
          {ordered
            .filter((p) => gains[p.id])
            .map((p) => (
              <li key={p.id} className={p.isMe ? 'me' : ''}>
                <Swatch p={p} />
                <span className="who">{p.isMe ? 'You pick up' : nameOf(p)}</span>
                <ResList res={gains[p.id]} />
              </li>
            ))}
        </ul>
      ) : (
        <p className="hint">Nobody picks up anything on a {roll.total}.</p>
      )}
    </section>
  );
}

function SevenSteps({ thief, est, since, open }: { thief: PlayerId; est: Record<PlayerId, HandEstimate>; since: CardEvent[]; open: (k: Popup['kind'], p?: PlayerId) => void }) {
  const { state } = useGame();
  const discarded = new Set(since.filter((e) => e.kind === 'lose' && e.reason === 'discard').map((e) => (e as { player: PlayerId }).player));
  // Judge who must discard from their hand before any discard this turn.
  const over = state.players.filter((p) => discarded.has(p.id) || discardCount(est[p.id].total) > 0);
  const stole = since.find((e): e is Extract<CardEvent, { kind: 'steal' }> => e.kind === 'steal' && e.thief === thief);
  const name = (id: PlayerId) => nameOf(state.players.find((p) => p.id === id));
  return (
    <div className="seven-steps">
      <p>
        <b>Robber!</b> Anyone with more than 7 cards discards half.
      </p>
      {over.length > 0 ? (
        <ul className="pickups">
          {over.map((p) => (
            <li key={p.id}>
              <Swatch p={p} />
              <span className="who">{discarded.has(p.id) ? `✓ ${nameOf(p)} discarded` : `${p.isMe ? 'You discard' : `${nameOf(p)} discards`} ${discardCount(est[p.id].total)}`}</span>
              {!discarded.has(p.id) && <button onClick={() => open('discard', p.id)}>Record</button>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nobody holds more than 7 cards, as far as the app knows.</p>
      )}
      {stole ? (
        <p className="hint">
          ✓ {name(thief)} stole {stole.resource ? icon(stole.resource) : 'a card'} from {name(stole.victim)}.
        </p>
      ) : (
        <button className="primary" onClick={() => open('robber', thief)}>
          🦹 Move robber and steal
        </button>
      )}
    </div>
  );
}

const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;
const fmt = (r: { min: number; max: number }) => (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);

/** The focused player's hand: exact for you, a best guess for everyone else. */
function HandCard({ player, est }: { player?: Player; est?: HandEstimate }) {
  if (!player || !est) return null;
  const exact = toCounts(Object.fromEntries(RESOURCES.map((r) => [r, est.resources[r].min])));
  const can = (b: BuildItem) => (player.isMe ? canAfford(exact, b) : RESOURCES.every((r) => est.resources[r].max >= (COST[b][r] ?? 0)));
  const sure = (b: BuildItem) => canAfford(exact, b);
  return (
    <section className="card">
      <div className="row between">
        <span className="label">{player.isMe ? 'Your hand' : `${player.name}'s hand (best guess)`}</span>
        <span>
          <b>{est.total}</b> {est.total === 1 ? 'card' : 'cards'}{est.devCards ? ` · ${est.devCards} dev` : ''}
          {est.knightsPlayed ? ` · ${est.knightsPlayed}⚔️` : ''}
        </span>
      </div>
      <div className="opp-res hand-cells">
        {RESOURCES.map((r: Resource) => (
          <span key={r} className={`opp-cell ${est.resources[r].max === 0 ? 'zero' : ''}`} style={{ background: TERRAIN_STYLE[r].fill }}>
            {icon(r)} {fmt(est.resources[r])}
          </span>
        ))}
      </div>
      {!player.isMe && est.possibilities > 1 && (
        <p className="hint small">
          Likely: {RESOURCES.filter((r) => est.resources[r].max > est.resources[r].min).map((r) => `${icon(r)} ${est.resources[r].expected.toFixed(1)}`).join('  ')}
        </p>
      )}
      <div className="can-build">
        {(['road', 'settlement', 'city', 'devCard'] as BuildItem[]).map((b) => (
          <span key={b} className={`build-chip ${sure(b) ? 'yes' : ''}`}>
            {sure(b) ? '✓' : can(b) ? '?' : '·'} {BUILD_LABEL[b]}
          </span>
        ))}
      </div>
      {player.isMe && est.devCards > 0 && (
        <p className="hint small">
          Dev cards:{' '}
          {DEV_KINDS.filter((k) => est.dev[k])
            .map((k) => `${DEV_LABEL[k]} ×${est.dev[k]}`)
            .join(', ')}
        </p>
      )}
      {est.missedCards && <p className="hint small warning">Spent cards the app didn't see them get. Correct the count if needed.</p>}
    </section>
  );
}

function MyHandLine({ me }: { me: Player }) {
  const { state } = useGame();
  return (
    <p className="hint my-line">
      Your hand: <ResList res={state.hands[me.id]?.resources} empty="no cards" />
    </p>
  );
}

/** What's been recorded since the roll, newest first, each with a delete. */
function TurnLog({ roll }: { roll: DiceRoll }) {
  const { state, dispatch } = useGame();
  const events = eventsSince(state, roll).reverse();
  const who = (id: PlayerId) => nameOf(state.players.find((p) => p.id === id));
  if (!events.length) return null;

  function remove(e: CardEvent) {
    if (e.kind === 'build' && e.spot) {
      // Builds come from the board: take the piece back off it.
      if (e.item === 'road') dispatch({ type: 'pieces/removeRoad', edge: e.spot });
      else if (e.item === 'city') dispatch({ type: 'pieces/setBuilding', vertex: e.spot, player: e.player, kind: 'settlement' });
      else dispatch({ type: 'pieces/removeBuilding', vertex: e.spot });
      return;
    }
    dispatch({ type: 'cards/remove', id: e.id });
  }

  return (
    <section className="card">
      <span className="label">This turn</span>
      <ul className="log">
        {events.map((e) => (
          <li key={e.id}>
            <span className="grow">{describeEvent(e, who)}</span>
            <button className="icon-btn" aria-label="Delete entry" onClick={() => remove(e)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
