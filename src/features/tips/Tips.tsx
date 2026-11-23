/**
 * Tips tab: best starting spots during setup, and during play what to build
 * or trade for, where to expand and where to put the robber.
 * All the thinking lives in model/suggestions*.ts; this file only draws it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { HexBoard, S } from '../../components/HexBoard';
import { useBoardRotation } from '../../components/boardRotation';
import { TERRAIN_STYLE } from '../../components/theme';
import { topologyFor, validateBoard } from '../../model/board';
import { hexCenter } from '../../model/geometry';
import { isResource, placementAdvice, placementOrder, vertexProduction } from '../../model/suggestions';
import { openingTurn } from '../../model/pieces';
import { buildOptions, expansionSpots, robberTargets, tradeRates, type BuildKind, type Trade } from '../../model/suggestionsPlay';
import { RESOURCES, type EdgeId, type GameState, type HexId, type PlayerId, type Resource, type ResourceCounts, type VertexId } from '../../model/types';
import { useGame } from '../../state/store';
import { makePlan, type Goal, type Plan, type PlanStep, type Threat } from '../../model/plan';
import { WIN_POINTS, type PlayerOutlook, type Purchase, type StrategyId } from '../../model/strategy';
import { DEV_DECK } from '../../model/cards';
import './tips.css';

type View = 'start' | 'play';

interface Focus {
  vertices?: VertexId[];
  edges?: EdgeId[];
  hex?: HexId;
}

const icon = (r: Resource) => TERRAIN_STYLE[r].icon;

/** "🌾8 ⛰️6 🧱5" for a corner. */
function cornerLabel(state: GameState, v: VertexId): string {
  return topologyFor(state.board.layout)
    .vertices[v].hexes.map((id) => state.board.hexes[id])
    .filter((h) => isResource(h.terrain) && h.number)
    .sort((a, b) => Math.abs(7 - a.number!) - Math.abs(7 - b.number!))
    .map((h) => `${icon(h.terrain as Resource)}${h.number}`)
    .join(' ') || 'coast';
}

const tradeText = (t: Trade) => `${t.count} ${icon(t.give)} → 1 ${icon(t.get)}`;

function Cards({ counts }: { counts: Partial<ResourceCounts> }) {
  const parts = RESOURCES.filter((r) => (counts[r] ?? 0) > 0);
  if (!parts.length) return <span className="muted">none</span>;
  return (
    <span className="cards">
      {parts.map((r) => (
        <span key={r} className="card-chip" style={{ background: TERRAIN_STYLE[r].fill }}>
          {icon(r)}
          {counts[r]! > 1 && <b>×{counts[r]}</b>}
        </span>
      ))}
    </span>
  );
}

/** Badges, a road line and a hex ring drawn on top of the board. */
function Overlay({ state, ranked, focus, gone }: { state: GameState; ranked: VertexId[]; focus: Focus; gone?: VertexId[] }) {
  const topo = topologyFor(state.board.layout);
  const sel = new Set(focus.vertices ?? []);
  const color = (id: PlayerId) => state.players.find((p) => p.id === id)?.color ?? '#888';
  const { deg } = useBoardRotation();
  return (
    <g pointerEvents="none">
      {/* Placed pieces, simply drawn so the tips make sense on their own. */}
      {Object.entries(state.pieces.roads).map(([e, pl]) => {
        const info = topo.edges[e];
        if (!info) return null;
        const [a, b] = info.vertices.map((v) => topo.vertices[v]);
        return (
          <g key={e}>
            <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="#111" strokeWidth={15} strokeLinecap="round" />
            <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke={color(pl)} strokeWidth={10} strokeLinecap="round" />
          </g>
        );
      })}
      {Object.entries(state.pieces.buildings).map(([v, bld]) => {
        const p = topo.vertices[v];
        if (!p) return null;
        const r = bld.kind === 'city' ? 20 : 14;
        return <rect key={v} x={p.x * S - r} y={p.y * S - r} width={r * 2} height={r * 2} rx={bld.kind === 'city' ? 4 : 2} fill={color(bld.player)} stroke="#111" strokeWidth={3} />;
      })}
      {focus.hex && (() => {
        const c = hexCenter(focus.hex);
        return <circle cx={c.x * S} cy={c.y * S} r={78} fill="none" stroke="#111" strokeWidth={10} strokeDasharray="14 10" />;
      })()}
      {(focus.edges ?? []).map((e) => {
        const [a, b] = topo.edges[e].vertices.map((v) => topo.vertices[v]);
        return <line key={e} x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="#111" strokeWidth={16} strokeLinecap="round" strokeDasharray="4 18" />;
      })}
      {(gone ?? []).map((v) => {
        const p = topo.vertices[v];
        return (
          <text key={v} x={p.x * S} y={p.y * S + 2} textAnchor="middle" dominantBaseline="middle" fontSize={34} fontWeight={900} fill="#222" opacity={0.7}>
            ✕
          </text>
        );
      })}
      {ranked.map((v, i) => {
        const p = topo.vertices[v];
        const on = sel.has(v);
        return (
          <g key={v} transform={`translate(${p.x * S} ${p.y * S}) rotate(${-deg})`}>
            <circle r={on ? 30 : 22} fill={on ? '#111' : '#fffdf8'} stroke="#111" strokeWidth={4} />
            <text textAnchor="middle" dominantBaseline="middle" y={1} fontSize={on ? 28 : 22} fontWeight={800} fill={on ? '#fff' : '#111'}>
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function boardProblem(state: GameState): string | null {
  const errors = validateBoard(state.board).filter((p) => p.level === 'error');
  return errors.length ? `Finish the board first (${errors.map((e) => e.message).join(', ')}).` : null;
}

export function Tips({ go }: { go?: (id: string) => void }) {
  const { state } = useGame();
  const me = state.players.find((p) => p.isMe);
  const [view, setView] = useState<View>(state.phase === 'playing' ? 'play' : 'start');
  const problem = boardProblem(state);

  return (
    <div className="screen tips">
      <div className="segmented full">
        <button className={view === 'start' ? 'on' : ''} onClick={() => setView('start')}>
          Starting spots
        </button>
        <button className={view === 'play' ? 'on' : ''} onClick={() => setView('play')}>
          Next move
        </button>
      </div>
      {problem ? (
        <div className="tip-card">
          <p className="hint">{problem}</p>
          {go && <button onClick={() => go('board')}>Go to board</button>}
        </div>
      ) : !me ? (
        <p className="hint">Mark which player is you on the Players tab.</p>
      ) : view === 'start' ? (
        <StartTips state={state} me={me.id} />
      ) : (
        <PlayTips state={state} me={me.id} />
      )}
    </div>
  );
}

function StartTips({ state, me }: { state: GameState; me: PlayerId }) {
  const { dispatch } = useGame();
  const advice = useMemo(() => placementAdvice(state, 6), [state]);
  const [picked, setPicked] = useState(0);
  const name = (id: PlayerId | null) => state.players.find((p) => p.id === id)?.name ?? '?';
  const order = placementOrder(state);
  const sel = advice.ranked[Math.min(picked, advice.ranked.length - 1)];

  if (advice.pickIndex === null)
    return <p className="hint">All starting settlements are placed. Switch to Next move for in-game tips.</p>;
  if (!advice.myPicks.length) return <p className="hint">You've placed both starting settlements. Switch to Next move.</p>;

  const turn = openingTurn(state);
  const myTurn = advice.picksBeforeMine === 0 && (!turn || (turn.player === me && turn.place === 'settlement'));
  const second = advice.myPicks[0] >= state.players.length;
  let status: ReactNode;
  if (myTurn) status = <><b>Your pick</b> ({second ? 'second' : 'first'} settlement).</>;
  else
    status = (
      <>
        Pick {advice.pickIndex + 1} of {order.length}: <b>{name(advice.nextPlayer)}</b> places next. {advice.picksBeforeMine} pick{advice.picksBeforeMine > 1 ? 's' : ''} before yours, ✕ marks spots they'll probably take.
      </>
    );

  return (
    <>
      <p className="hint">{status} Log each placement on the Pieces tab and the tips update.</p>
      <HexBoard board={state.board} robber={state.robber}>
        <Overlay state={state} ranked={advice.ranked.map((r) => r.vertex)} focus={{ vertices: sel ? [sel.vertex] : [], edges: sel?.road ? [sel.road] : [] }} gone={myTurn ? [] : advice.likelyTaken} />
      </HexBoard>
      <ol className="tip-list">
        {advice.ranked.map((c, i) => (
          <li key={c.vertex}>
            <button className={`tip-card ${c === sel ? 'on' : ''}`} onClick={() => setPicked(i)}>
              <div className="tip-head">
                <span className="rank">{i + 1}</span>
                <span className="corner">{cornerLabel(state, c.vertex)}</span>
                <span className="pips">{c.pips} pips</span>
              </div>
              {c.reasons.length > 0 && <div className="why">{c.reasons.join(' · ')}</div>}
              {c.pairedWith && <div className="why">Pairs with {cornerLabel(state, c.pairedWith)} on your next pick, if it's still open.</div>}
              {c.likelyGone && <div className="why warning">Probably taken before your turn.</div>}
            </button>
          </li>
        ))}
      </ol>
      {myTurn && sel && (
        <button
          className="primary"
          onClick={() => {
            dispatch({ type: 'pieces/setBuilding', vertex: sel.vertex, player: me, kind: 'settlement' });
            if (sel.road) dispatch({ type: 'pieces/setRoad', edge: sel.road, player: me });
            setPicked(0);
          }}
        >
          Place #{advice.ranked.indexOf(sel) + 1} and its road
        </button>
      )}
      <p className="hint small">
        Scores weigh pips, scarce resources, new resources for you, and harbors. The dotted line is the suggested road, pointing at your next good spot.
      </p>
    </>
  );
}


const WHEN_LABEL = { now: 'This turn', next: 'Next', later: 'After that', if7: 'On a 7' } as const;
const STRATEGY_LABEL: Record<StrategyId, string> = { cities: 'Cities first', expand: 'Expand first', devCards: 'Dev cards and Largest Army', longestRoad: 'Longest Road' };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => (Math.round(x * 10) / 10).toString();

function goalText(state: GameState, g: Goal): string {
  const at = g.where ? cornerLabel(state, g.where) : '';
  if (g.item === 'city') return `City on ${at}`;
  if (g.item === 'settlement') return `Settlement on ${at}${g.roads ? ` (${g.roads} road${g.roads > 1 ? 's' : ''} first)` : ''}`;
  if (g.item === 'road') return 'Roads for Longest Road';
  return 'A dev card';
}

function buyText(state: GameState, b: Purchase): string {
  if (b.item === 'city') return `City on ${cornerLabel(state, b.where!)}`;
  if (b.item === 'settlement') return `Settlement on ${cornerLabel(state, b.where!)}${b.roads ? ` (+${b.roads} road${b.roads > 1 ? 's' : ''})` : ''}`;
  if (b.item === 'road') return 'Another road (Longest Road)';
  return 'A dev card';
}

function devOdds(state: GameState, o: PlayerOutlook | null): string {
  const deck = DEV_DECK[state.board.layout];
  const size = Object.values(deck).reduce((x, y) => x + y, 0);
  const army = o && o.knightsForArmy > 0 ? ` You need ${o.knightsForArmy} more knight${o.knightsForArmy > 1 ? 's' : ''} for Largest Army.` : '';
  return `${pct(deck.victoryPoint / size)} chance of a hidden point, ${pct(deck.knight / size)} a knight.${army}`;
}

function stepView(state: GameState, plan: Plan, s: PlanStep, name: (id?: PlayerId) => string): { title: ReactNode; why?: string; focus: Focus } {
  const n = Math.max(2, state.players.length);
  switch (s.kind) {
    case 'playDev': {
      if (s.card === 'knight' && s.why === 'robberOnYou') {
        const h = state.board.hexes[s.hex!];
        return { title: 'Play a Knight before you roll', why: `The robber is blocking your ${isResource(h.terrain) ? icon(h.terrain) : ''}${h.number}. Move it to an opponent (see "On a 7") and steal a card.`, focus: { hex: s.hex } };
      }
      if (s.card === 'knight') return { title: 'Play a Knight', why: `That takes Largest Army: +2 points.`, focus: {} };
      if (s.card === 'roadBuilding') return { title: 'Play Road Building', why: `2 free roads toward your goal, saving 2 ${icon('wood')} and 2 ${icon('brick')}.`, focus: {} };
      if (s.card === 'yearOfPlenty')
        return {
          title: (
            <>
              Play Year of Plenty: take <Cards counts={s.take ?? {}} />
            </>
          ),
          why: 'Those are the cards you are missing, so you can build right after.',
          focus: {},
        };
      return { title: `Play Monopoly on ${icon(s.resource!)}`, why: `Opponents hold about ${s.haul} ${icon(s.resource!)} between them, more than you need.`, focus: {} };
    }
    case 'trade':
      return {
        title: `Trade ${s.trade.count} ${icon(s.trade.give)} for ${s.trade.count / { bank: 4, '3:1': 3, '2:1': 2 }[s.rate]} ${icon(s.trade.get)} (${s.rate === 'bank' ? 'bank 4:1' : `${s.rate} harbor`})`,
        focus: {},
      };
    case 'build': {
      const focus: Focus = s.item === 'road' ? { edges: s.where ? [s.where] : [] } : s.where ? { vertices: [s.where] } : {};
      if (s.item === 'road') {
        if (plan.goal?.item === 'road') return { title: 'Build a road here', why: `Longest Road needs ${plan.outlook?.roadsForLongest ?? '?'} more road${(plan.outlook?.roadsForLongest ?? 0) > 1 ? 's' : ''} in a row (+2 points).`, focus };
        return { title: `Build ${s.count && s.count > 1 ? `${s.count} roads` : 'a road'} here`, why: s.count && s.count > 1 ? 'Start at the dotted edge.' : undefined, focus };
      }
      const pipsWhy = s.pips ? `, +${s.pips} pips (about ${num((s.pips * n) / 36)} more cards per round)` : '';
      if (s.item === 'city') return { title: `Upgrade ${cornerLabel(state, s.where!)} to a city`, why: `+1 point${pipsWhy}.`, focus };
      if (s.item === 'settlement')
        return { title: `Build a settlement on ${cornerLabel(state, s.where!)}`, why: `+1 point${pipsWhy}${s.newResources?.length ? `, adds ${s.newResources.map(icon).join(' ')}` : ''}.`, focus };
      return { title: 'Buy a dev card', why: devOdds(state, plan.outlook), focus };
    }
    case 'save':
      return {
        title: (
          <>
            Save up: still need <Cards counts={s.need} />
          </>
        ),
        why: `${pct(s.odds.byTurn[1] ?? 0)} chance you have it by your next turn, ${pct(s.odds.byTurn[2] ?? 0)} within 2 turns, ${s.odds.median < 99 ? `and usually within ${s.odds.median} turn${s.odds.median > 1 ? 's' : ''}` : 'and likely more than 8 turns without trading with players'} (simulated dice, 7s and bank trades included).`,
        focus: {},
      };
    case 'ask':
      return {
        title: `Ask ${name(s.partner)} for 1 ${icon(s.get)}${s.give ? `, offer 1 ${icon(s.give)}` : ''}`,
        why: `${s.sure ? `They definitely hold ${icon(s.get)}` : `They probably hold about ${s.theyHave} ${icon(s.get)}`}${s.give ? `, and they're short of ${icon(s.give)}` : ''}. A 1-for-1 trade beats the bank's 4-for-1.`,
        focus: {},
      };
    case 'tooMany':
      return { title: `You hold ${s.cards} cards`, why: `${pct(s.risk)} chance of a 7 before your next turn, which would cost you ${Math.floor(s.cards / 2)}. Build or trade down to 7.`, focus: {} };
    case 'then':
      return {
        title: buyText(state, s.buy),
        why: `In about ${s.buy.round} round${s.buy.round === 1 ? '' : 's'}, putting you at about ${num(s.buy.points)} points.`,
        focus: s.buy.where ? { vertices: [s.buy.where] } : {},
      };
    case 'robber': {
      const h = state.board.hexes[s.target.hex];
      return {
        title: `Robber on ${isResource(h.terrain) ? icon(h.terrain) : ''}${h.number}, steal from ${name(s.target.stealFrom)}`,
        why: `Blocks ${s.target.hits.map((x) => `${name(x.player)} (${x.pips} pips)`).join(', ')}.`,
        focus: { hex: s.target.hex },
      };
    }
  }
}

function threatView(state: GameState, t: Threat, name: (id?: PlayerId) => string): { text: string; focus: Focus } {
  switch (t.kind) {
    case 'nearWin':
      return { text: `${name(t.player)} has ${t.points} points${t.devCards ? ` and ${t.devCards} dev card${t.devCards > 1 ? 's' : ''} (maybe hidden points)` : ''}. Don't trade with them, and rob them.`, focus: {} };
    case 'race':
      return { text: `${name(t.player)} is close to ${cornerLabel(state, t.where)}. Get there first.`, focus: { vertices: [t.where] } };
    case 'longestRoad':
      return {
        text: t.holds
          ? `${name(t.player)} holds Longest Road (${t.length}). You'd need ${t.length + 1} in a row (you have ${t.mine}).`
          : `${name(t.player)}'s road is ${t.length} long (yours: ${t.mine}). At 5 they take Longest Road (+2).`,
        focus: {},
      };
    case 'largestArmy':
      return {
        text: t.holds
          ? `${name(t.player)} holds Largest Army (${t.knights} knights; you've played ${t.mine}).`
          : `${name(t.player)} has played ${t.knights} knights (you: ${t.mine}). At 3 they take Largest Army (+2).`,
        focus: {},
      };
  }
}

function PlanCard({ state, me, focus, setFocus }: { state: GameState; me: PlayerId; focus: Focus; setFocus: (f: Focus) => void }) {
  const plan = useMemo(() => makePlan(state, me), [state, me]);
  const name = (id?: PlayerId) => state.players.find((p) => p.id === id)?.name ?? '?';
  if (!plan.goal) return null;
  const o = plan.outlook;
  const st = plan.strategy;
  const n = Math.max(2, state.players.length);
  let lastWhen = '';
  return (
    <section className="tip-section plan">
      <h2>Your plan: {goalText(state, plan.goal)}</h2>
      {st && o && (
        <p className="hint small">
          <b>{STRATEGY_LABEL[st.id]}.</b>{' '}
          {st.rounds <= 40
            ? `About ${st.rounds} rounds to ${WIN_POINTS} points`
            : `${WIN_POINTS} points is a long way off; this path gets you about ${num(st.pointsAt10)} points in 10 rounds`}{' '}
          (you have {o.points}
          {o.hiddenPoints ? `, ${o.hiddenPoints} hidden` : ''}).
        </p>
      )}
      <ol className="plan-steps">
        {plan.steps.map((s, i) => {
          const v = stepView(state, plan, s, name);
          const head = s.when !== lastWhen ? WHEN_LABEL[s.when] : null;
          lastWhen = s.when;
          const on = JSON.stringify(v.focus) === JSON.stringify(focus) && Object.keys(v.focus).length > 0;
          return (
            <li key={i}>
              {head && <div className={`when ${s.when}`}>{head}</div>}
              <button className={`tip-card ${on ? 'on' : ''}`} onClick={() => setFocus(v.focus)}>
                <div className="tip-head">
                  <span className="rank">{i + 1}</span>
                  <span className="step">{v.title}</span>
                </div>
                {v.why && <div className="why">{v.why}</div>}
              </button>
            </li>
          );
        })}
      </ol>
      {plan.threats.length > 0 && (
        <>
          <div className="when threat">Watch out</div>
          <ul className="threats">
            {plan.threats.map((t, i) => {
              const v = threatView(state, t, name);
              return (
                <li key={i}>
                  <button className="tip-card threat" onClick={() => setFocus(v.focus)}>
                    <span className="why">⚠️ {v.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {o && plan.strategies.length > 1 && (
        <details className="why-plan">
          <summary>Why this plan</summary>
          <table>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Rounds to {WIN_POINTS}</th>
                <th>Points in 10 rounds</th>
              </tr>
            </thead>
            <tbody>
              {plan.strategies.map((r) => (
                <tr key={r.id} className={r === st ? 'on' : ''}>
                  <td>{STRATEGY_LABEL[r.id]}</td>
                  <td>{r.rounds <= 40 ? `~${r.rounds}` : '40+'}</td>
                  <td>{num(Math.min(r.pointsAt10, WIN_POINTS))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint small">
            Each strategy is played out on your expected income ({RESOURCES.map((r) => `${icon(r)} ${num((o.income[r] * n) / 36)}`).join('  ')} cards per round), with
            bank and harbor trades. Settlement spots an opponent can reach first drop out after a couple of rounds.
          </p>
        </details>
      )}
    </section>
  );
}

/** Your step-by-step plan, for other screens (the Play tab shows it on your turn). Tap a step to see it on the board. */
export function PlanPanel({ me }: { me: PlayerId }) {
  const { state } = useGame();
  const [focus, setFocus] = useState<Focus>({});
  const spots = useMemo(() => expansionSpots(state, me, 3), [state, me]);
  const hasGoal = useMemo(() => !!makePlan(state, me).goal, [state, me]);
  if (!hasGoal) return null;
  return (
    <div className="tips plan-panel">
      <PlanCard state={state} me={me} focus={focus} setFocus={(f) => setFocus(JSON.stringify(f) === JSON.stringify(focus) ? {} : f)} />
      {Object.keys(focus).length > 0 && (
        <HexBoard board={state.board} robber={state.robber}>
          <Overlay state={state} ranked={spots.map((s) => s.vertex)} focus={focus} />
        </HexBoard>
      )}
    </div>
  );
}

const BUILD_LABEL: Record<BuildKind, string> = { city: '🏙️ City', settlement: '🏠 Settlement', road: '🛣️ Road', devCard: '🃏 Dev card' };
const STATUS_LABEL = { now: 'Ready', trade: 'With trades', need: 'Need cards', blocked: 'Not possible' };

function PlayTips({ state, me }: { state: GameState; me: PlayerId }) {
  const builds = useMemo(() => buildOptions(state, me), [state, me]);
  const spots = useMemo(() => expansionSpots(state, me, 3), [state, me]);
  const robber = useMemo(() => robberTargets(state, me, 3), [state, me]);
  const rates = tradeRates(state, me);
  const [focus, setFocus] = useState<Focus>({});
  const name = (id?: PlayerId) => state.players.find((p) => p.id === id)?.name ?? '?';
  const hand = state.hands[me]?.resources;
  const hasBuildings = Object.values(state.pieces.buildings).some((b) => b.player === me);

  if (!hasBuildings) return <p className="hint">Place your starting settlements (Pieces tab) to get in-game tips.</p>;

  const income: ResourceCounts = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  for (const [v, b] of Object.entries(state.pieces.buildings))
    if (b.player === me) {
      const p = vertexProduction(state.board, v, state.robber);
      for (const r of RESOURCES) income[r] += p[r] * (b.kind === 'city' ? 2 : 1);
    }

  const focusOn = (f: Focus) => setFocus(f);
  const isFocus = (f: Focus) => JSON.stringify(f) === JSON.stringify(focus);

  return (
    <>
      <PlanCard state={state} me={me} focus={focus} setFocus={focusOn} />

      <HexBoard board={state.board} robber={state.robber}>
        <Overlay state={state} ranked={spots.map((s) => s.vertex)} focus={focus} />
      </HexBoard>

      <section className="tip-section">
        <h2>All build options</h2>
        <p className="hint small">
          Your hand: <Cards counts={hand ?? {}} />
          {!RESOURCES.some((r) => hand?.[r]) && ' (enter your cards on the Dice tab)'}
        </p>
        {builds.map((b) => {
          const f: Focus = b.where ? (b.kind === 'road' ? { edges: [b.where] } : { vertices: [b.where] }) : {};
          return (
            <button key={b.kind} className={`tip-card ${isFocus(f) && b.where ? 'on' : ''}`} onClick={() => focusOn(f)} disabled={b.status === 'blocked'}>
              <div className="tip-head">
                <span className="corner">{BUILD_LABEL[b.kind]}</span>
                <span className={`badge ${b.status}`}>{STATUS_LABEL[b.status]}</span>
              </div>
              <div className="why">{b.why}</div>
              {b.status === 'trade' && <div className="why">Trade: {b.trades.map(tradeText).join(', ')}</div>}
              {b.status === 'need' && (
                <div className="why">
                  Missing: <Cards counts={b.missing} />
                </div>
              )}
            </button>
          );
        })}
        <p className="hint small">
          Bank rates: {RESOURCES.map((r) => `${icon(r)} ${rates[r]}:1`).join('  ')}
        </p>
      </section>

      <section className="tip-section">
        <h2>Expand toward</h2>
        {spots.length === 0 && <p className="hint">No open spots within reach of your roads.</p>}
        {spots.map((s, i) => {
          const f: Focus = { vertices: [s.vertex], edges: s.nextRoad ? [s.nextRoad] : [] };
          return (
            <button key={s.vertex} className={`tip-card ${isFocus(f) ? 'on' : ''}`} onClick={() => focusOn(f)}>
              <div className="tip-head">
                <span className="rank">{i + 1}</span>
                <span className="corner">{cornerLabel(state, s.vertex)}</span>
                <span className="pips">{s.roads ? `${s.roads} road${s.roads > 1 ? 's' : ''}` : 'build now'}</span>
              </div>
              <div className="why">
                {[`${s.pips} pips`, ...s.reasons.filter((r) => !r.endsWith('pips')), s.contested ? 'an opponent is as close' : ''].filter(Boolean).join(' · ')}
              </div>
            </button>
          );
        })}
      </section>

      <section className="tip-section">
        <h2>If you move the robber</h2>
        {robber.length === 0 && <p className="hint">No opponent buildings to block yet.</p>}
        {robber.map((t) => {
          const h = state.board.hexes[t.hex];
          const f: Focus = { hex: t.hex };
          return (
            <button key={t.hex} className={`tip-card ${isFocus(f) ? 'on' : ''}`} onClick={() => focusOn(f)}>
              <div className="tip-head">
                <span className="corner">
                  {isResource(h.terrain) ? icon(h.terrain) : ''} {h.number}
                </span>
                <span className="pips">steal from {name(t.stealFrom)}</span>
              </div>
              <div className="why">
                Blocks {t.hits.map((x) => `${name(x.player)} (${x.pips} pips)`).join(', ')}
                {t.selfPips ? ` · also blocks ${t.selfPips} of your pips` : ''}
              </div>
            </button>
          );
        })}
      </section>

      <section className="tip-section">
        <h2>Your income</h2>
        <p className="hint small">Expected cards per 36 rolls (robbed tile excluded):</p>
        <div className="cards">
          {RESOURCES.map((r) => (
            <span key={r} className="card-chip" style={{ background: TERRAIN_STYLE[r].fill }}>
              {icon(r)} <b>{income[r]}</b>
            </span>
          ))}
        </div>
      </section>
    </>
  );
}
