/**
 * Which cards to give up when a 7 is rolled and you hold more than 7.
 *
 * You must discard half (rounded down). Greedy: drop one card at a time,
 * always the card whose loss hurts least:
 *   1. Cards your goal (the plan's next build) still uses are kept first,
 *      then cards for the build after it.
 *   2. Among the rest (surplus), keep resources you rarely roll (hard to get
 *      back) and ones your harbors trade well; drop the ones you roll most.
 *   3. Each extra copy of the same surplus resource is worth a little less,
 *      so the discard spreads instead of wiping out one resource.
 */
import { discardCount } from './cards';
import { goals, type Goal } from './goals';
import { expectedPerRoll, tradeRates } from './suggestionsPlay';
import type { GameState, PlayerId, Resource, ResourceCounts } from './types';
import { RESOURCES, emptyResources } from './types';

export interface DiscardAdvice {
  /** Cards to drop (sums to `count`). */
  discard: ResourceCounts;
  count: number;
  /** The build the kept cards are for (null if none). */
  goal: Goal | null;
  /** Cards of the goal you still hold after the discard. */
  keptForGoal: ResourceCounts;
  /** Resources dropped because you roll them most (vs. surplus of rare ones). */
  common: Resource[];
}

/**
 * Suggested discard for `me`, or null when no discard is needed. Pass the
 * plan's goal (makePlan(...).goal) so the advice matches the Tips tab.
 */
export function suggestDiscard(state: GameState, me: PlayerId, goal?: Goal | null): DiscardAdvice | null {
  const hand = { ...(state.hands[me]?.resources ?? emptyResources()) };
  const cards = RESOURCES.reduce((s, r) => s + hand[r], 0);
  const count = discardCount(cards);
  if (!count) return null;

  // The plan's goal when given (the UI passes makePlan's), else the best single goal.
  const all = goals(state, me);
  const main: Goal | null = goal === undefined ? all[0] ?? null : goal;
  const second = all.find((g) => !(g.item === main?.item && g.where === main?.where)) ?? null;
  const need1 = main?.cost ?? emptyResources();
  const need2 = second?.cost ?? emptyResources();

  const income = expectedPerRoll(state, me);
  const maxIncome = Math.max(1e-6, ...RESOURCES.map((r) => income[r]));
  const rates = tradeRates(state, me);

  // Value of holding the c-th copy (1-based) of r.
  const value = (r: Resource, c: number) => {
    if (c <= need1[r]) return 100 + (1 - income[r] / maxIncome);
    if (c <= need1[r] + need2[r]) return 50 + (1 - income[r] / maxIncome);
    const extra = c - need1[r] - need2[r];
    const rare = 1 - income[r] / maxIncome; // 0 = your most rolled resource
    const harbor = rates[r] === 2 ? 0.6 : rates[r] === 3 ? 0.2 : 0;
    return 1 + rare + harbor - 0.3 * (extra - 1);
  };

  const discard = emptyResources();
  for (let d = 0; d < count; d++) {
    let best: Resource | null = null;
    let bestV = Infinity;
    for (const r of RESOURCES) {
      if (hand[r] <= 0) continue;
      const v = value(r, hand[r]);
      if (v < bestV - 1e-9) {
        bestV = v;
        best = r;
      }
    }
    if (!best) break;
    hand[best]--;
    discard[best]++;
  }

  const keptForGoal = emptyResources();
  for (const r of RESOURCES) keptForGoal[r] = Math.min(hand[r], need1[r]);
  const common = RESOURCES.filter((r) => discard[r] > 0 && income[r] >= maxIncome * 0.6);
  return { discard, count, goal: main, keptForGoal, common };
}
