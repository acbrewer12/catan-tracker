/**
 * Post-game review: go back through one game and judge the user's own
 * decisions against what the planner would have said at that moment.
 *
 *   reviewGame(game, winner?) -> moments (turn by turn), the top lessons to
 *                                work on, strengths, and stats
 *
 * Only the user's own decisions are judged. Opponents appear only through
 * public information (points on the board, trades made at the table, who
 * robbed whom); their hidden cards are never shown or assumed.
 */
import { hexesAtVertex, pips, portAtVertex } from './board';
import { countTotal, handEstimates } from './cards';
import { openingEnd, stateAt, turnsOf, type TurnInfo } from './history';
import { longestRoadHolder, pieceCounts } from './pieces';
import { makePlan } from './plan';
import { WIN_POINTS, type StrategyId } from './strategy';
import { isResource, rankCorners, vertexProduction } from './suggestions';
import { largestArmyHolder, tradeRates } from './suggestionsPlay';
import { evaluateTrade, visiblePoints } from './tradeValue';
import type { CardEvent, GameState, PlayerId, ResourceCounts, VertexId } from './types';
import { RESOURCES } from './types';

export type Tone = 'good' | 'tip' | 'mistake';
export type LessonId = 'opening' | 'sevens' | 'missedBuilds' | 'trades' | 'bank' | 'robber' | 'devCards';

export interface Moment {
  /** 1-based turn number, or null for the opening placements. */
  turn: number | null;
  round?: number;
  topic: LessonId;
  tone: Tone;
  title: string;
  detail?: string;
  /** How much it mattered (used to rank lessons). */
  weight: number;
  /** Board corners to show: what you picked and what was better. */
  vertex?: VertexId;
  better?: VertexId;
}

export interface Lesson {
  id: LessonId;
  /** One line: what to do differently. */
  text: string;
  /** The evidence from this game. */
  detail: string;
  weight: number;
}

export interface ReviewStats {
  myTurns: number;
  openingPips: number;
  /** Average opening pips of the other players. */
  tableOpeningPips: number;
  cardsLostToSevens: number;
  /** Turns you ended holding more than 7 cards. */
  bigHandTurns: number;
  cardsStolenFromMe: number;
  playerTrades: number;
  badTrades: number;
  devBought: number;
  devPlayed: number;
  /** Non-VP dev cards still in hand at the end. */
  devUnplayed: number;
  missedBuilds: number;
}

/** How a player scored, from the final board (public info). */
export interface Style {
  player: PlayerId;
  points: number;
  cities: number;
  settlements: number;
  longestRoad: boolean;
  largestArmy: boolean;
  devBought: number;
  /** Which planner strategies this matches, each with a share (sums to 1). */
  strategies: Partial<Record<StrategyId, number>>;
}

export interface GameReview {
  me: PlayerId;
  winner: PlayerId | null;
  /** Final points: visible for everyone, plus your own hidden VP cards. */
  points: Record<PlayerId, number>;
  /** Your finishing place (1 = won). */
  place: number;
  moments: Moment[];
  lessons: Lesson[];
  strengths: string[];
  stats: ReviewStats;
  styles: Style[];
}

const NAMES: Record<string, string> = { wood: 'wood', brick: 'brick', sheep: 'sheep', wheat: 'wheat', ore: 'ore' };
const ITEM: Record<string, string> = { road: 'a road', settlement: 'a settlement', city: 'a city', devCard: 'a dev card' };

/** "2 ore + 1 wheat" */
export function cardsText(c: Partial<ResourceCounts>): string {
  const parts = RESOURCES.filter((r) => (c[r] ?? 0) > 0).map((r) => `${c[r]} ${NAMES[r]}`);
  return parts.length ? parts.join(' + ') : 'nothing';
}

/** "6 ore, 8 wheat, 9 sheep (3:1 harbor)" */
export function cornerText(state: GameState, v: VertexId): string {
  const hexes = hexesAtVertex(state.board, v)
    .filter((h) => isResource(h.terrain) && h.number)
    .sort((a, b) => pips(b.number) - pips(a.number))
    .map((h) => `${h.number} ${NAMES[h.terrain as string]}`);
  const port = portAtVertex(state.board, v);
  const harbor = port ? ` (${port.kind === 'any' ? '3:1' : `2:1 ${NAMES[port.kind]}`} harbor)` : '';
  return (hexes.join(', ') || 'coast') + harbor;
}

const cornerPips = (state: GameState, v: VertexId) => RESOURCES.reduce((s, r) => s + vertexProduction(state.board, v)[r], 0);

/** Your hidden victory-point cards (only ever known for you). */
const myHiddenVp = (state: GameState, me: PlayerId) => handEstimates(state)[me]?.dev?.victoryPoint ?? 0;

/** Final points per player: visible, plus your own VP cards. A recorded winner gets at least 10. */
export function finalPoints(game: GameState, winner?: PlayerId | null): Record<PlayerId, number> {
  const me = game.players.find((p) => p.isMe)?.id;
  const out: Record<PlayerId, number> = {};
  for (const p of game.players) {
    out[p.id] = visiblePoints(game, p.id) + (p.id === me ? myHiddenVp(game, p.id) : 0);
    if (p.id === winner) out[p.id] = Math.max(out[p.id], WIN_POINTS);
  }
  return out;
}

/** The winner if someone has reached 10 points we can see. */
export function detectWinner(game: GameState): PlayerId | null {
  const pts = finalPoints(game);
  const top = Object.entries(pts).filter(([, n]) => n >= WIN_POINTS).sort((a, b) => b[1] - a[1]);
  return top[0]?.[0] ?? null;
}

/** How each player scored, mapped onto the planner's strategies. */
export function stylesOf(game: GameState, winner?: PlayerId | null): Style[] {
  const holder = longestRoadHolder(game);
  const army = largestArmyHolder(game);
  const pts = finalPoints(game, winner);
  return game.players.map((p) => {
    const c = pieceCounts(game, p.id);
    const devBought = game.cardLog.filter((e) => e.kind === 'build' && e.item === 'devCard' && e.player === p.id).length;
    const s: Style = {
      player: p.id,
      points: pts[p.id],
      cities: c.city,
      settlements: c.settlement,
      longestRoad: holder === p.id,
      largestArmy: army === p.id,
      devBought,
      strategies: {},
    };
    const tags: StrategyId[] = [];
    if (s.longestRoad) tags.push('longestRoad');
    if (s.largestArmy || devBought >= 4) tags.push('devCards');
    if (c.city >= 2 && c.city >= c.settlement) tags.push('cities');
    if (c.settlement + c.city >= 5 && c.settlement > c.city) tags.push('expand');
    if (!tags.length) tags.push(c.city > c.settlement ? 'cities' : 'expand');
    for (const t of tags) s.strategies[t] = 1 / tags.length;
    return s;
  });
}

/** Normalise a trade event to the user's side: what you gave, what you got, and who with. */
function mySide(e: Extract<CardEvent, { kind: 'trade' }>, me: PlayerId) {
  if (e.player === me) return { partner: e.with, give: e.give, get: e.get };
  if (e.with === me) return { partner: e.player as PlayerId | 'bank', give: e.get, get: e.give };
  return null;
}

/** Corner reasons that are selling points (scoreCorner also lists drawbacks). */
const goodReasons = (rs: string[]) => rs.filter((r) => !/repeats|same numbers|make no|little /.test(r));

const isPointBuild = (e: CardEvent, me: PlayerId) => e.kind === 'build' && e.player === me && !e.free && (e.item === 'city' || e.item === 'settlement');

export interface ReviewOptions {
  /** Skip the per-turn planner replay (faster; used for cross-game stats). */
  quick?: boolean;
}

export function reviewGame(game: GameState, recordedWinner?: PlayerId | null, opts: ReviewOptions = {}): GameReview | null {
  const me = game.players.find((p) => p.isMe)?.id;
  if (!me) return null;
  const name = (id: PlayerId | 'bank') => (id === 'bank' ? 'the bank' : game.players.find((p) => p.id === id)?.name ?? '?');
  const winner = recordedWinner === undefined ? detectWinner(game) : recordedWinner;
  const points = finalPoints(game, winner);
  const order = [...game.players].sort((a, b) => Number(b.id === winner) - Number(a.id === winner) || points[b.id] - points[a.id]);
  const place = order.findIndex((p) => p.id === me) + 1;
  const turns = turnsOf(game);
  const turnOfEvent = (i: number): TurnInfo | null => {
    let t: TurnInfo | null = null;
    for (const x of turns) if (x.start <= i) t = x;
    return t;
  };
  const rollsBefore = (i: number) => {
    const t = turnOfEvent(i);
    return t ? t.index + 1 : 0;
  };
  const at = (i: number) => stateAt(game, i, rollsBefore(i));
  const moments: Moment[] = [];
  const stats: ReviewStats = {
    myTurns: turns.filter((t) => t.player === me).length,
    openingPips: 0,
    tableOpeningPips: 0,
    cardsLostToSevens: 0,
    bigHandTurns: 0,
    cardsStolenFromMe: 0,
    playerTrades: 0,
    badTrades: 0,
    devBought: 0,
    devPlayed: 0,
    devUnplayed: 0,
    missedBuilds: 0,
  };
  const leaderAmong = (s: GameState, except: PlayerId[]) =>
    game.players.filter((p) => !except.includes(p.id)).map((p) => ({ id: p.id, pts: visiblePoints(s, p.id) })).sort((a, b) => b.pts - a.pts)[0];

  // --- Opening placements -------------------------------------------------
  const openEnd = openingEnd(game);
  const openingPips: Record<PlayerId, number> = {};
  game.cardLog.slice(0, openEnd).forEach((e, i) => {
    if (e.kind !== 'build' || e.item !== 'settlement' || !e.spot) return;
    openingPips[e.player] = (openingPips[e.player] ?? 0) + cornerPips(game, e.spot);
    if (e.player !== me) return;
    const before = at(i);
    const ranked = rankCorners(before, me);
    const rank = ranked.findIndex((c) => c.vertex === e.spot);
    const mine = ranked[rank];
    const best = ranked[0];
    const which = Object.values(before.pieces.buildings).some((b) => b.player === me) ? 'Second settlement' : 'First settlement';
    if (!best || rank < 0) return;
    const pickedPips = cornerPips(game, e.spot);
    const bestPips = cornerPips(game, best.vertex);
    if (rank <= 1 || (mine && best.score - mine.score < 0.8)) {
      moments.push({
        turn: null,
        topic: 'opening',
        tone: 'good',
        title: `${which}: ${cornerText(game, e.spot)}${rank === 0 ? ', the best spot open' : `, one of the best spots open`}.`,
        weight: 0,
        vertex: e.spot,
      });
    } else {
      const gap = best.score - (mine?.score ?? 0);
      moments.push({
        turn: null,
        topic: 'opening',
        tone: gap >= 2.5 ? 'mistake' : 'tip',
        title: `${which}: you took ${cornerText(game, e.spot)} (${pickedPips} pips). ${cornerText(game, best.vertex)} (${bestPips} pips) was open.`,
        detail: goodReasons(best.reasons).length
          ? `It ranked #${rank + 1} of the open spots. The better spot had ${goodReasons(best.reasons).slice(0, 3).join(', ')}.`
          : `It ranked #${rank + 1} of the open spots.`,
        weight: Math.min(4, gap),
        vertex: e.spot,
        better: best.vertex,
      });
    }
  });
  stats.openingPips = openingPips[me] ?? 0;
  const others = game.players.filter((p) => p.id !== me);
  stats.tableOpeningPips = others.length ? others.reduce((s, p) => s + (openingPips[p.id] ?? 0), 0) / others.length : 0;

  // --- Events during play ---------------------------------------------------
  game.cardLog.forEach((e, i) => {
    if (i < openEnd) return;
    const t = turnOfEvent(i);
    const turn = t ? t.index + 1 : null;
    const round = t?.round;
    if (e.kind === 'trade') {
      const side = mySide(e, me);
      if (!side) return;
      const before = at(i);
      if (side.partner === 'bank') {
        const rates = tradeRates(before, me);
        const gave = RESOURCES.filter((r) => (side.give[r] ?? 0) > 0);
        const got = countTotal(side.get);
        if (gave.length === 1 && got > 0) {
          const r = gave[0];
          const over = (side.give[r] ?? 0) - got * rates[r];
          if (over > 0)
            moments.push({
              turn,
              round,
              topic: 'bank',
              tone: 'tip',
              title: `Turn ${turn}: you gave ${cardsText(side.give)} to the bank for ${cardsText(side.get)}.`,
              detail: `Your ${rates[r] === 2 ? '2:1' : '3:1'} harbor rate for ${NAMES[r]} would have done it for ${got * rates[r]}, saving ${over} card${over > 1 ? 's' : ''}.`,
              weight: over,
            });
        }
        return;
      }
      stats.playerTrades++;
      const ev = evaluateTrade(before, me, side.partner, side.give, side.get, name(side.partner));
      const theirPts = visiblePoints(before, side.partner);
      const head = `Turn ${turn}: you traded ${cardsText(side.give)} to ${name(side.partner)} (${theirPts} points) for ${cardsText(side.get)}.`;
      if (ev.verdict === 'good') {
        moments.push({ turn, round, topic: 'trades', tone: 'good', title: head, detail: ev.reasons.join(' '), weight: 0 });
      } else {
        stats.badTrades++;
        moments.push({
          turn,
          round,
          topic: 'trades',
          tone: ev.verdict === 'dangerous' ? 'mistake' : 'tip',
          title: head,
          detail: ev.reasons.join(' '),
          weight: ev.verdict === 'dangerous' ? 3 : 1,
        });
      }
      return;
    }
    if (e.kind === 'lose' && e.player === me && e.reason === 'discard') {
      const n = countTotal(e.resources);
      stats.cardsLostToSevens += n;
      const held = countTotal(at(i).hands[me]?.resources);
      moments.push({
        turn,
        round,
        topic: 'sevens',
        tone: n >= 4 ? 'mistake' : 'tip',
        title: `Turn ${turn}: a 7 made you discard ${n} cards (${cardsText(e.resources)}).`,
        detail: held > 7 ? `You were holding ${held}. Trading or building down to 7 before passing the dice avoids this.` : undefined,
        weight: n * 0.6,
      });
      return;
    }
    if (e.kind === 'steal' && e.victim === me) {
      stats.cardsStolenFromMe++;
      return;
    }
    if (e.kind === 'steal' && e.thief === me) {
      const before = at(i);
      const victimPts = visiblePoints(before, e.victim);
      const lead = leaderAmong(before, [me]);
      if (lead && lead.id !== e.victim && lead.pts >= victimPts + 2)
        moments.push({
          turn,
          round,
          topic: 'robber',
          tone: 'tip',
          title: `Turn ${turn}: you robbed ${name(e.victim)} (${victimPts} points) while ${name(lead.id)} led with ${lead.pts}.`,
          detail: `Blocking and robbing the leader slows the player most likely to beat you, when one of their tiles is open.`,
          weight: 1 + (lead.pts - victimPts) * 0.3,
        });
      else if (lead && lead.id === e.victim) moments.push({ turn, round, topic: 'robber', tone: 'good', title: `Turn ${turn}: you robbed the leader, ${name(e.victim)}.`, weight: 0 });
      return;
    }
    if (e.kind === 'build' && e.player === me && e.item === 'devCard') stats.devBought++;
    if (e.kind === 'playDev' && e.player === me) stats.devPlayed++;
  });

  // --- Turn by turn: missed builds and big hands ---------------------------
  for (const t of turns) {
    if (t.player !== me) continue;
    const endState = stateAt(game, t.end, t.index + 1);
    const held = countTotal(endState.hands[me]?.resources);
    // Ending your turn with 8+ cards is what makes a 7 hurt.
    if (held > 7 && t.index + 1 < turns.length) stats.bigHandTurns++;
    if (opts.quick) continue;
    // Judge the hand you ended the turn with: anything the planner would still build now was left unbuilt.
    const plan = makePlan(endState, me);
    const turnEvents = game.cardLog.slice(t.start, t.end);
    const builtPoint = turnEvents.some((e) => isPointBuild(e, me));
    const win = plan.steps.find((x) => x.kind === 'win');
    if (win && winner !== me) {
      stats.missedBuilds++;
      moments.push({
        turn: t.index + 1,
        round: t.round,
        topic: 'missedBuilds',
        tone: 'mistake',
        title: `Turn ${t.index + 1}: you could have reached ${WIN_POINTS} points this turn.`,
        detail: 'The planner had a winning line from your hand. Check the Tips plan at the start of every turn late in the game.',
        weight: 5,
      });
      continue;
    }
    const nowBuild = plan.steps.find((x) => x.kind === 'build' && x.when === 'now' && (x.item === 'city' || x.item === 'settlement'));
    if (nowBuild && nowBuild.kind === 'build') {
      stats.missedBuilds++;
      const instead = turnEvents.filter((e) => e.kind === 'build' && e.player === me && !e.free).map((e) => (e.kind === 'build' ? ITEM[e.item] : ''));
      const where = nowBuild.where ? ` on ${cornerText(endState, nowBuild.where)}` : '';
      moments.push({
        turn: t.index + 1,
        round: t.round,
        topic: 'missedBuilds',
        tone: 'tip',
        title: `Turn ${t.index + 1}: you ended your turn with the cards for ${ITEM[nowBuild.item]}${where}.`,
        detail: instead.length && !builtPoint
          ? `You built ${instead.join(' and ')} instead. A point now usually beats a road or a card.`
          : `Cards in hand can be stolen or lost to a 7; a point on the board can't.`,
        weight: 1.5,
        vertex: nowBuild.where,
      });
    }
  }

  // --- Dev cards left at the end ------------------------------------------
  const dev = handEstimates(game)[me]?.dev;
  if (dev) stats.devUnplayed = dev.knight + dev.roadBuilding + dev.yearOfPlenty + dev.monopoly;
  if (stats.devUnplayed > 0 && winner && winner !== me) {
    const army = largestArmyHolder(game);
    const myKnights = game.hands[me]?.knightsPlayed ?? 0;
    const theirKnights = army ? game.hands[army]?.knightsPlayed ?? 0 : 0;
    const closeArmy = dev.knight > 0 && (army ? theirKnights - myKnights <= dev.knight : myKnights + dev.knight >= 3);
    moments.push({
      turn: null,
      topic: 'devCards',
      tone: closeArmy ? 'mistake' : 'tip',
      title: `You finished with ${stats.devUnplayed} unplayed dev card${stats.devUnplayed > 1 ? 's' : ''}.`,
      detail: closeArmy
        ? `Your ${dev.knight} knight${dev.knight > 1 ? 's' : ''} would have reached Largest Army (+2 points). Play knights as soon as they help.`
        : 'Cards in hand score nothing. Play them on your turn as soon as they help.',
      weight: closeArmy ? 3 : 1,
    });
  }

  // --- Lessons --------------------------------------------------------------
  const weightOf = (id: LessonId) => moments.filter((m) => m.topic === id && m.tone !== 'good').reduce((s, m) => s + m.weight, 0);
  const lessons: Lesson[] = [];
  const add = (id: LessonId, text: string, detail: string, extra = 0) => {
    const w = weightOf(id) + extra;
    if (w > 0.5) lessons.push({ id, text, detail, weight: w });
  };
  const openTips = moments.filter((m) => m.topic === 'opening' && m.tone !== 'good').length;
  add(
    'opening',
    'Start on stronger spots. Check the Tips ranking before each opening pick.',
    `${openTips} of your 2 starting settlements had a clearly better spot open. You started on ${stats.openingPips} pips; the others averaged ${Math.round(stats.tableOpeningPips)}.`,
  );
  add(
    'sevens',
    'Spend down to 7 cards before you pass the dice.',
    `You lost ${stats.cardsLostToSevens} cards to 7s and ended ${stats.bigHandTurns} of your turns holding 8 or more.`,
    stats.bigHandTurns >= 3 ? stats.bigHandTurns * 0.3 : 0,
  );
  add('missedBuilds', 'Build points as soon as you can afford them.', `${stats.missedBuilds} of your turns had a city or settlement in hand that you didn't build.`);
  add('trades', "Don't trade with the leader, and only trade when you gain more than they do.", `${stats.badTrades} of your ${stats.playerTrades} player trades helped the other side as much as you, or more.`);
  add('bank', 'Use your harbors for bank trades.', 'Some bank trades paid 4:1 when your harbor gave a better rate.');
  add('robber', 'Put the robber on the leader.', "Your steals went to players who weren't leading.");
  add('devCards', 'Play dev cards when they help, not at the end.', `You held ${stats.devUnplayed} unplayed at the end.`);
  lessons.sort((a, b) => b.weight - a.weight);

  // --- Strengths ------------------------------------------------------------
  const strengths: string[] = [];
  if (winner === me) strengths.push('You won!');
  if (moments.some((m) => m.topic === 'opening') && !openTips) strengths.push('Strong opening: both settlements were among the best spots open.');
  else if (stats.openingPips > stats.tableOpeningPips + 2) strengths.push(`Your start out-produced the table (${stats.openingPips} pips vs ${Math.round(stats.tableOpeningPips)}).`);
  if (stats.myTurns >= 5 && !stats.cardsLostToSevens) strengths.push('You never lost cards to a 7.');
  if (stats.playerTrades >= 2 && !stats.badTrades) strengths.push(`All ${stats.playerTrades} of your player trades favoured you.`);
  if (!opts.quick && stats.myTurns >= 5 && !stats.missedBuilds) strengths.push('You built every point as soon as you could afford it.');
  if (moments.some((m) => m.topic === 'robber' && m.tone === 'good') && !moments.some((m) => m.topic === 'robber' && m.tone !== 'good')) strengths.push('You kept the robber on the leader.');

  // Opening first, then turn by turn, then end-of-game notes.
  const key = (m: Moment) => (m.turn ?? (m.topic === 'opening' ? -1 : 1e9));
  moments.sort((a, b) => key(a) - key(b));
  return { me, winner, points, place, moments, lessons, strengths, stats, styles: stylesOf(game, winner) };
}
