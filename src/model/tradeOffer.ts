/**
 * Player trades from the user's side, for the Play tab:
 *  - judgeOffer: someone offers you a trade. Accept, decline, or counter?
 *  - askBackups: you asked a player for a card (a plan "ask" step) and they
 *    said no. Who else to ask, or which bank / harbor trade gets it instead.
 *
 * "Helps" is measured with the same look-ahead as the Tips plan
 * (strategy.ts + plan.ts goals): expected rounds to win and rounds until the
 * next goal, before and after the swap, for you and for them.
 */
import { handEstimates } from './cards';
import { goals, threats } from './plan';
import { compareStrategies } from './strategy';
import { tradeRates } from './suggestionsPlay';
import { RESOURCES, emptyResources, type GameState, type PlayerId, type Resource, type ResourceCounts } from './types';

type Counts = Partial<ResourceCounts>;
const total = (c: Counts) => RESOURCES.reduce((s, r) => s + (c[r] ?? 0), 0);

function withHand(state: GameState, p: PlayerId, resources: ResourceCounts): GameState {
  const h = state.hands[p];
  return { ...state, hands: { ...state.hands, [p]: { ...h, resources } } };
}

/** Lower is better: rounds to win, plus a little for rounds to the next goal. */
function progress(state: GameState, p: PlayerId): number {
  const best = compareStrategies(state, p).results[0];
  const g = goals(state, p)[0];
  return (best?.rounds ?? 41) + 0.3 * Math.min(20, g?.eta ?? 20) - 0.2 * (best?.pointsAt10 ?? 0);
}

/** How much a hand change speeds `p` up (positive = helps). */
function gain(state: GameState, p: PlayerId, from: ResourceCounts, to: ResourceCounts): number {
  return progress(withHand(state, p, from), p) - progress(withHand(state, p, to), p);
}

export interface OfferVerdict {
  verdict: 'accept' | 'decline' | 'either' | 'cantAfford';
  /** Plain-language reasons, most important first. */
  reasons: string[];
  /** A tweak worth proposing instead, when the offer as made isn't good. */
  counter?: { give: ResourceCounts; get: ResourceCounts };
  mine: number;
  theirs: number;
}

const EPS = 0.1;

/**
 * `partner` offers `me` a trade: I hand over `give` and receive `get`.
 * Their hand is the app's estimate (cards they certainly hold).
 */
export function judgeOffer(state: GameState, me: PlayerId, partner: PlayerId, give: Counts, get: Counts): OfferVerdict {
  const mine = state.hands[me]?.resources ?? emptyResources();
  const theirs = state.hands[partner]?.resources ?? emptyResources();
  const short = RESOURCES.filter((r) => (give[r] ?? 0) > mine[r]);
  if (short.length) return { verdict: 'cantAfford', reasons: [`You don't have enough to give that.`], mine: 0, theirs: 0 };

  const after = (h: ResourceCounts, out: Counts, inn: Counts) => {
    const o = { ...h };
    for (const r of RESOURCES) o[r] = Math.max(0, o[r] - (out[r] ?? 0) + (inn[r] ?? 0));
    return o;
  };
  const score = (g: Counts, t: Counts) => ({
    mine: gain(state, me, mine, after(mine, g, t)),
    theirs: gain(state, partner, theirs, after(theirs, t, g)),
  });
  const s = score(give, get);
  const leaders = new Set(threats(state, me, null).filter((t) => t.kind === 'nearWin').map((t) => t.player));
  const leader = leaders.has(partner);

  // Plain card check against your next goal, so coarse simulations can't talk you into a bad swap.
  const goal = goals(state, me)[0];
  const missing = (h: ResourceCounts) => (goal ? RESOURCES.reduce((n, r) => n + Math.max(0, goal.cost[r] - h[r]), 0) : 0);
  const before = missing(mine);
  const afterMissing = missing(after(mine, give, get));
  const uneven = total(give) > total(get);

  const reasons: string[] = [];
  let verdict: OfferVerdict['verdict'];
  if (afterMissing > before) {
    verdict = 'decline';
    reasons.push('You would give away cards your next build needs.');
  } else if (s.mine < -EPS) {
    verdict = 'decline';
    reasons.push('It sets your plan back: you give away cards you need.');
  } else if (s.mine <= EPS) {
    verdict = leader || s.theirs > EPS ? 'decline' : 'either';
    reasons.push(s.theirs > EPS ? "It doesn't speed you up, but it helps them." : "It barely changes anything for you.");
  } else if (leader && s.theirs >= s.mine) {
    verdict = 'decline';
    reasons.push('It helps you, but it helps them more, and they are close to winning.');
  } else if (uneven && afterMissing === before) {
    verdict = 'either';
    reasons.push(`You give ${total(give)} for ${total(get)} and it doesn't bring your next build closer.`);
  } else {
    verdict = 'accept';
    reasons.push(s.theirs > s.mine ? 'It gets you closer to your goal (it helps them a bit more, though).' : 'It gets you closer to your goal.');
  }
  if (leader && verdict !== 'decline') reasons.push('Careful: they are close to winning.');
  const cardsAfter = total(after(mine, give, get));
  if (cardsAfter > 7 && verdict !== 'decline') reasons.push(`You'd hold ${cardsAfter} cards, so a 7 would cost you half.`);

  let counter: OfferVerdict['counter'];
  if (verdict !== 'accept') {
    // Try asking for one more card, or giving one fewer.
    const tries: Array<{ give: ResourceCounts; get: ResourceCounts }> = [];
    const g0 = { ...emptyResources(), ...give } as ResourceCounts;
    const t0 = { ...emptyResources(), ...get } as ResourceCounts;
    for (const r of RESOURCES) {
      if (theirs[r] > t0[r]) tries.push({ give: g0, get: { ...t0, [r]: t0[r] + 1 } });
      if (g0[r] > 0 && total(g0) > 1) tries.push({ give: { ...g0, [r]: g0[r] - 1 }, get: t0 });
    }
    let best: { c: (typeof tries)[number]; m: number } | null = null;
    for (const c of tries) {
      const sc = score(c.give, c.get);
      const ok = sc.mine > EPS && !(leader && sc.theirs >= sc.mine) && missing(after(mine, c.give, c.get)) < before;
      if (ok && (!best || sc.mine > best.m)) best = { c, m: sc.mine };
    }
    if (best) counter = best.c;
  }
  return { verdict, reasons, counter, mine: s.mine, theirs: s.theirs };
}

export type Backup =
  | { kind: 'askOther'; partner: PlayerId; theyHave: number; sure: boolean }
  | { kind: 'bank'; give: Resource; count: number; rate: number }
  | { kind: 'wait' };

/**
 * You need `get` and `declined` players said no. Other players likely to have
 * it (not the leaders), then a bank or harbor trade from spare cards, else wait.
 */
export function askBackups(state: GameState, me: PlayerId, get: Resource, declined: PlayerId[], keep: Counts = {}): Backup[] {
  const est = handEstimates(state);
  const leaders = new Set(threats(state, me, null).filter((t) => t.kind === 'nearWin').map((t) => t.player));
  const out: Backup[] = state.players
    .filter((p) => p.id !== me && !declined.includes(p.id) && !leaders.has(p.id))
    .map((p) => ({ p: p.id, e: est[p.id]?.resources[get] }))
    .filter((x) => x.e && x.e.expected >= 0.5)
    .sort((a, b) => Number(b.e!.min >= 1) - Number(a.e!.min >= 1) || b.e!.expected - a.e!.expected)
    .slice(0, 2)
    .map((x) => ({ kind: 'askOther' as const, partner: x.p, theyHave: Math.round(x.e!.expected * 10) / 10, sure: x.e!.min >= 1 }));

  const hand = state.hands[me]?.resources ?? emptyResources();
  const rates = tradeRates(state, me);
  const bank = RESOURCES.filter((r) => r !== get && hand[r] - (keep[r] ?? 0) >= rates[r]).sort((a, b) => rates[a] - rates[b] || hand[b] - hand[a])[0];
  if (bank) out.push({ kind: 'bank', give: bank, count: rates[bank], rate: rates[bank] });
  if (!out.length) out.push({ kind: 'wait' });
  return out;
}
