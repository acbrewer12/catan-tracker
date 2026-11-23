/**
 * Player trades from the user's side, for the Play tab:
 *  - judgeOffer: someone offers you a trade. Accept, decline, or counter?
 *  - askBackups: you asked a player for a card and they said no. What next?
 *
 * Both use tradeValue.ts, the same evaluation the Tips plan uses: a trade is
 * only worth it when it moves you forward clearly more than it moves them,
 * and never when it lets someone build a point near the end or win.
 */
import { goals } from './goals';
import { cardOptions, evaluateTrade, type Backup } from './tradeValue';
import { RESOURCES, emptyResources, type GameState, type PlayerId, type Resource, type ResourceCounts } from './types';

export type { Backup } from './tradeValue';

type Counts = Partial<ResourceCounts>;
const total = (c: Counts) => RESOURCES.reduce((s, r) => s + (c[r] ?? 0), 0);

export interface OfferVerdict {
  verdict: 'accept' | 'decline' | 'cantAfford';
  /** Plain-language reasons, most important first. */
  reasons: string[];
  /** A tweak worth proposing instead, when the offer as made isn't good. */
  counter?: { give: ResourceCounts; get: ResourceCounts };
  /** Rounds the trade saves you and them (positive = helps). */
  mine: number;
  theirs: number;
}

/** `partner` offers `me` a trade: I hand over `give` and receive `get`. */
export function judgeOffer(state: GameState, me: PlayerId, partner: PlayerId, give: Counts, get: Counts): OfferVerdict {
  const mine = state.hands[me]?.resources ?? emptyResources();
  if (RESOURCES.some((r) => (give[r] ?? 0) > mine[r])) return { verdict: 'cantAfford', reasons: [`You don't have enough to give that.`], mine: 0, theirs: 0 };
  const name = state.players.find((p) => p.id === partner)?.name ?? 'they';
  const e = evaluateTrade(state, me, partner, give, get, name);
  const verdict = e.verdict === 'good' ? 'accept' : 'decline';
  const reasons = [...e.reasons];
  const cardsAfter = total(mine) - total(give) + total(get);
  if (verdict === 'accept' && cardsAfter > 7) reasons.push(`You'd hold ${cardsAfter} cards, so a 7 would cost you half.`);

  let counter: OfferVerdict['counter'];
  if (verdict === 'decline' && e.verdict !== 'dangerous') {
    // Ask for one more card, or give one fewer, and keep the first version that's good for you.
    const g0 = { ...emptyResources(), ...give } as ResourceCounts;
    const t0 = { ...emptyResources(), ...get } as ResourceCounts;
    const tries: Array<{ give: ResourceCounts; get: ResourceCounts }> = [];
    for (const r of RESOURCES) {
      if (g0[r] > 0 && total(g0) > 1) tries.push({ give: { ...g0, [r]: g0[r] - 1 }, get: t0 });
      tries.push({ give: g0, get: { ...t0, [r]: t0[r] + 1 } });
    }
    let best: { c: (typeof tries)[number]; v: number } | null = null;
    for (const c of tries) {
      const ce = evaluateTrade(state, me, partner, c.give, c.get, name);
      if (ce.verdict === 'good' && (!best || ce.value > best.v)) best = { c, v: ce.value };
    }
    if (best) counter = best.c;
  }
  return { verdict, reasons, counter, mine: e.mine.roundsSaved, theirs: e.theirs.roundsSaved };
}

/**
 * You need `get` and the `declined` players said no: ranked next steps
 * (another player worth asking, bank / harbor, a different build, save).
 */
export function askBackups(state: GameState, me: PlayerId, get: Resource, declined: PlayerId[], keep?: Counts): Backup[] {
  const goal = goals(state, me)[0];
  if (!goal) return [];
  return cardOptions(state, me, get, goal, declined, keep ?? goal.cost);
}
