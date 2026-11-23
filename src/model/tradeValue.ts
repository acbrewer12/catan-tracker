/**
 * Is a player trade good for you? One evaluation shared by the Tips plan and
 * the Play tab's trade card.
 *
 * Both sides are scored the same way: how many rounds the cards save toward
 * that player's next goals, and whether the trade lets them build a point
 * right away (or take Longest Road, or win). Your gain must clearly beat
 * theirs, weighted up the closer they are to winning. A trade that lets
 * someone build a point when they're near 10, or win outright, is refused.
 *
 * Only public information is used for opponents: how many cards they hold
 * (visible at the table) and what their buildings produce. Their exact cards
 * are never assumed.
 */
import { add, goals, total, type Goal } from './goals';
import { boardPoints, longestRoad, longestRoadHolder } from './pieces';
import { affordOdds, WIN_POINTS, type AffordOdds } from './strategy';
import { playerProduction, typicalHandSize } from './suggestions';
import { largestArmyHolder, tradeRates, tradesFor } from './suggestionsPlay';
import { COST } from './cards';
import { rivalFactor } from './learning';
import { RESOURCES, emptyResources, type GameState, type PlayerId, type Resource, type ResourceCounts } from './types';

type Counts = Partial<ResourceCounts>;

/** Visible points: buildings, Longest Road, Largest Army (no hidden cards). */
export function visiblePoints(state: GameState, p: PlayerId): number {
  return boardPoints(state, p, longestRoadHolder(state)) + (largestArmyHolder(state) === p ? 2 : 0);
}

/**
 * How many resource cards a player holds. Exact for the user. Opponents' cards
 * aren't tracked, so for them it's a guess from public info: about a round
 * and a half of what their buildings produce, between 1 and 7 (0 if they
 * produce nothing).
 */
export function handCount(state: GameState, p: PlayerId): number {
  const h = state.hands[p];
  if (state.players.find((x) => x.id === p)?.isMe) return h ? RESOURCES.reduce((s, r) => s + h.resources[r], 0) : 0;
  return typicalHandSize(state, p);
}

/** Share of a player's income per resource (a little smoothing so nothing is impossible). */
function incomeShare(state: GameState, p: PlayerId): ResourceCounts {
  const inc = playerProduction(state, p, true);
  const w = emptyResources();
  let sum = 0;
  for (const r of RESOURCES) sum += w[r] = inc[r] + 0.5;
  for (const r of RESOURCES) w[r] /= sum;
  return w;
}

/**
 * A guess at an opponent's hand from public info only: a typical card count
 * (see handCount) spread over what their buildings produce. For you it's your real hand.
 */
export function publicHand(state: GameState, p: PlayerId, me: PlayerId): ResourceCounts {
  if (p === me) return { ...(state.hands[p]?.resources ?? emptyResources()) };
  const n = handCount(state, p);
  const share = incomeShare(state, p);
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = n * share[r];
  return out;
}

/** Chance an opponent holds at least one `r`, from what they produce. */
export function likelyHas(state: GameState, p: PlayerId, r: Resource): number {
  const n = handCount(state, p);
  return 1 - Math.pow(1 - incomeShare(state, p)[r], n);
}

/** Fractional rounds until `cost` is affordable with trades (quarter-round steps). */
function etaFrac(hand: ResourceCounts, cost: ResourceCounts, perRound: ResourceCounts, rates: ResourceCounts): number {
  for (let t = 0; t <= 20; t += 0.25) {
    const h = emptyResources();
    for (const r of RESOURCES) h[r] = Math.floor(hand[r] + perRound[r] * t + 1e-9);
    if (tradesFor(h, cost, rates)) return t;
  }
  return 20;
}

const roundAll = (c: ResourceCounts) => {
  const o = emptyResources();
  for (const r of RESOURCES) o[r] = Math.max(0, Math.round(c[r]));
  return o;
};
const floorAll = (c: ResourceCounts) => {
  const o = emptyResources();
  for (const r of RESOURCES) o[r] = Math.max(0, Math.floor(c[r] + 1e-9));
  return o;
};
const withHand = (state: GameState, p: PlayerId, resources: ResourceCounts): GameState => ({
  ...state,
  hands: { ...state.hands, [p]: { ...state.hands[p], resources, unknown: 0 } },
});

export interface SideImpact {
  player: PlayerId;
  /** Rounds saved toward their next goals (next goal counts fully, the one after by half). */
  roundsSaved: number;
  /** The goal these rounds are measured against. */
  goal: Goal | null;
  /** A point they can build right after the trade but couldn't before. */
  enablesNow: 'city' | 'settlement' | 'longestRoad' | null;
  /** Points that build is worth. */
  pointsNow: number;
  points: number;
  winsNow: boolean;
}

function impact(state: GameState, p: PlayerId, before: ResourceCounts, after: ResourceCounts): SideImpact {
  const s = withHand(state, p, floorAll(before));
  const gs = goals(s, p).filter((g) => g.eta < 99);
  const rates = tradeRates(state, p);
  const n = Math.max(2, state.players.length);
  const inc = playerProduction(state, p);
  const perRound = emptyResources();
  for (const r of RESOURCES) perRound[r] = (inc[r] * n) / 36;
  let saved = 0;
  gs.slice(0, 2).forEach((g, i) => {
    saved += (i === 0 ? 1 : 0.5) * (etaFrac(before, g.cost, perRound, rates) - etaFrac(after, g.cost, perRound, rates));
  });

  // Points they could build right away after the trade but not before.
  const can = (h: ResourceCounts, cost: ResourceCounts) => !!tradesFor(floorAll(h), cost, rates);
  let enablesNow: SideImpact['enablesNow'] = null;
  for (const g of gs) {
    if ((g.item === 'city' || (g.item === 'settlement' && g.roads === 0)) && can(after, g.cost) && !can(before, g.cost)) {
      enablesNow = g.item;
      break;
    }
  }
  let pointsNow = enablesNow ? 1 : 0;
  // A road that would take Longest Road is worth 2.
  const holder = longestRoadHolder(state);
  if (holder !== p) {
    const best = Math.max(4, ...state.players.filter((x) => x.id !== p).map((x) => longestRoad(state, x.id)));
    const road = add(COST.road, {});
    if (longestRoad(state, p) + 1 > best && can(after, road) && !can(before, road)) {
      enablesNow = 'longestRoad';
      pointsNow = 2;
    }
  }
  const points = visiblePoints(state, p);
  return { player: p, roundsSaved: saved, goal: gs[0] ?? null, enablesNow, pointsNow, points, winsNow: points + pointsNow >= WIN_POINTS };
}

export interface TradeEval {
  verdict: 'good' | 'bad' | 'dangerous';
  /** Your gain minus their weighted gain; higher is better for you. */
  value: number;
  mine: SideImpact;
  theirs: SideImpact;
  reasons: string[];
}

const NAMES: Record<Resource, string> = { wood: 'wood', brick: 'brick', sheep: 'sheep', wheat: 'wheat', ore: 'ore' };
const r1 = (x: number) => Math.round(x * 10) / 10;
const WHAT: Record<string, string> = { city: 'a city', settlement: 'a settlement', longestRoad: 'Longest Road (+2)' };

/**
 * `me` gives `give` to `partner` and gets `get` back. `partnerName` is only
 * used in the reasons.
 */
export function evaluateTrade(state: GameState, me: PlayerId, partner: PlayerId, give: Counts, get: Counts, partnerName = 'they'): TradeEval {
  const myBefore = publicHand(state, me, me);
  const myAfter = { ...myBefore };
  for (const r of RESOURCES) myAfter[r] += (get[r] ?? 0) - (give[r] ?? 0);
  // Their side: a public guess, but they must at least hold what they hand over.
  const theirBefore = roundAll(publicHand(state, partner, me));
  for (const r of RESOURCES) theirBefore[r] = Math.max(theirBefore[r], get[r] ?? 0);
  const theirAfter = { ...theirBefore };
  for (const r of RESOURCES) theirAfter[r] += (give[r] ?? 0) - (get[r] ?? 0);

  const mine = impact(state, me, myBefore, myAfter);
  const theirs = impact(state, partner, theirBefore, theirAfter);
  const lead = Math.max(0, theirs.points - mine.points);
  const near = theirs.points >= WIN_POINTS - 3;
  // Opponents who often win in this group count extra (learned; 1 when nothing is learned).
  const w = (1 + 0.25 * lead + (near ? 1 : 0)) * rivalFactor(state.players.find((p) => p.id === partner)?.name);
  const myGain = mine.roundsSaved + (mine.enablesNow ? 1 + mine.pointsNow : 0);
  const theirGain = theirs.roundsSaved + (theirs.enablesNow ? 1 + theirs.pointsNow : 0);
  const value = myGain - w * theirGain;

  const reasons: string[] = [];
  const Who = partnerName === 'they' ? 'They' : partnerName;
  let verdict: TradeEval['verdict'];
  if (theirs.winsNow) {
    verdict = 'dangerous';
    reasons.push(`${Who} could build ${WHAT[theirs.enablesNow!]} right after and win.`);
  } else if (theirs.points >= WIN_POINTS - 2 && !mine.winsNow) {
    // At 8+ you can't see their hand well enough to know a card is harmless.
    verdict = 'dangerous';
    reasons.push(`${Who} ${Who === 'They' ? 'have' : 'has'} ${theirs.points} points: one good turn and they win. Only trade with them if it wins you the game.`);
  } else if (near && (theirs.enablesNow || theirs.roundsSaved > 0.2)) {
    verdict = 'dangerous';
    reasons.push(`${Who} ${Who === 'They' ? 'have' : 'has'} ${theirs.points} points. Don't help them at all.`);
  } else if (theirs.pointsNow >= 2) {
    verdict = 'dangerous';
    reasons.push(`It gives ${partnerName === 'they' ? 'them' : partnerName} a road for Longest Road (+2 points).`);
  } else if (myGain <= 0.2) {
    verdict = 'bad';
    reasons.push(mine.roundsSaved < -0.2 ? 'It costs you cards your plan needs.' : "It doesn't bring your next build any closer.");
  } else if (value <= 0.25) {
    verdict = 'bad';
    reasons.push(`It helps ${partnerName === 'they' ? 'them' : partnerName} as much as you or more${lead ? `, and they're ahead of you` : ''}.`);
  } else verdict = 'good';

  if (mine.enablesNow) reasons.push(`You can build ${WHAT[mine.enablesNow]} right after.`);
  else if (mine.roundsSaved > 0.2) reasons.push(`Saves you about ${r1(mine.roundsSaved)} rounds${mine.goal ? ` toward ${goalName(mine.goal)}` : ''}.`);
  if (theirs.enablesNow && !theirs.winsNow) reasons.push(`It lets ${partnerName === 'they' ? 'them' : partnerName} build ${WHAT[theirs.enablesNow]}.`);
  else if (verdict === 'good') reasons.push(theirs.roundsSaved > 0.2 ? `It helps ${partnerName === 'they' ? 'them' : partnerName} less (about ${r1(theirs.roundsSaved)} rounds).` : `It barely helps ${partnerName === 'they' ? 'them' : partnerName}.`);
  return { verdict, value, mine, theirs, reasons };
}

const goalName = (g: Goal) => (g.item === 'city' ? 'your city' : g.item === 'settlement' ? 'your settlement' : g.item === 'road' ? 'Longest Road' : 'a dev card');

export interface Offer {
  partner: PlayerId;
  give: ResourceCounts;
  get: ResourceCounts;
  eval: TradeEval;
  /** Chance they hold the card at all (public guess). */
  likely: number;
}

/**
 * Good player trades for one card you need, best first: each opponent who
 * probably has it, offering 1 (or, if needed, 2) spare cards. Players near
 * winning, and trades that help them as much as you, are left out.
 */
export function playerOffers(state: GameState, me: PlayerId, get: Resource, spare: ResourceCounts, exclude: PlayerId[] = []): Offer[] {
  const out: Offer[] = [];
  const name = (id: PlayerId) => state.players.find((p) => p.id === id)?.name ?? 'they';
  const singles = RESOURCES.filter((r) => r !== get && spare[r] >= 1);
  for (const p of state.players) {
    if (p.id === me || exclude.includes(p.id)) continue;
    const likely = likelyHas(state, p.id, get);
    if (likely < 0.4) continue;
    const want = { ...emptyResources(), [get]: 1 };
    const tries: ResourceCounts[] = singles.map((r) => ({ ...emptyResources(), [r]: 1 }));
    for (let i = 0; i < singles.length; i++)
      for (let j = i; j < singles.length; j++) {
        const g = { ...emptyResources() };
        g[singles[i]]++;
        g[singles[j]]++;
        if (g[singles[i]] <= spare[singles[i]] && g[singles[j]] <= spare[singles[j]]) tries.push(g);
      }
    let best: Offer | null = null;
    for (const give of tries) {
      const e = evaluateTrade(state, me, p.id, give, want, name(p.id));
      if (e.verdict !== 'good') continue;
      // Prefer giving fewer cards, then the best value.
      const score = e.value - 0.3 * (total(give) - 1);
      if (!best || score > best.eval.value - 0.3 * (total(best.give) - 1)) best = { partner: p.id, give, get: want, eval: e, likely };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.likely * b.eval.value - a.likely * a.eval.value);
}

export type Backup =
  | { kind: 'askOther'; partner: PlayerId; give: ResourceCounts; why: string }
  /** Trade `count` of `give` for count / rate of the card you need. */
  | { kind: 'bank'; give: Resource; count: number; rate: number; why: string }
  | { kind: 'switchGoal'; goal: Goal; why: string }
  | { kind: 'save'; odds: AffordOdds; why: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * What to do for a card you need, ranked: player trades that are good for
 * you, then a bank or harbor trade from spare cards, then a different build
 * you can make now, then saving (with the odds). Each comes with a reason.
 */
export function cardOptions(state: GameState, me: PlayerId, get: Resource, goal: Goal, declined: PlayerId[] = [], keep: Counts = goal.cost, amount = 1): Backup[] {
  const hand = state.hands[me]?.resources ?? emptyResources();
  const spare = emptyResources();
  for (const r of RESOURCES) spare[r] = Math.max(0, hand[r] - (keep[r] ?? 0));
  const out: Backup[] = [];

  for (const o of playerOffers(state, me, get, spare, declined).slice(0, 2)) {
    out.push({ kind: 'askOther', partner: o.partner, give: o.give, why: o.eval.reasons.join(' ') });
  }

  const rates = tradeRates(state, me);
  const bank = RESOURCES.filter((r) => r !== get && spare[r] >= rates[r]).sort((a, b) => rates[a] - rates[b] || spare[b] - spare[a])[0];
  if (bank) {
    const times = Math.max(1, Math.min(amount, Math.floor(spare[bank] / rates[bank])));
    const count = rates[bank] * times;
    out.push({
      kind: 'bank',
      give: bank,
      count,
      rate: rates[bank],
      why: `Uses ${count} of your ${spare[bank]} spare ${NAMES[bank]}${rates[bank] < 4 ? ` at your ${rates[bank]}:1 harbor` : ''}${times < amount ? `, which covers ${times} of the ${amount} you need` : ''}. Costs more cards, but helps nobody else.`,
    });
  }

  // A different build you can afford now beats sitting on cards.
  const now = goals(state, me).filter((g) => g.eta === 0 && !(g.item === goal.item && g.where === goal.where) && g.item !== 'road');
  const alt = now.sort((a, b) => Number(b.item !== 'devCard') - Number(a.item !== 'devCard') || b.value - a.value)[0];
  if (alt)
    out.push({
      kind: 'switchGoal',
      goal: alt,
      why: alt.item === 'devCard' ? 'You can afford it now; a knight or a hidden point keeps you moving.' : `You can afford it now: +1 point${alt.pips ? `, +${alt.pips} pips` : ''}.`,
    });

  const odds = affordOdds(state, me, goal.cost, 6);
  out.push({
    kind: 'save',
    odds,
    why: `${pct(odds.byTurn[1] ?? 0)} chance you roll into it by your next turn, ${pct(odds.byTurn[3] ?? 0)} within 3.${total(hand) > 7 ? ` Careful: you hold ${total(hand)} cards.` : ''}`,
  });
  return out;
}
