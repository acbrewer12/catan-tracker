/**
 * "What should I do next?": one goal and an ordered list of steps to reach it.
 *
 * Goals are a city, a settlement (maybe a few roads away) or a dev card. Each
 * is valued by points and production gained, then discounted by how many
 * rounds it takes to afford from your hand and expected income (bank and
 * harbor trades included). The best goal becomes the plan; the runner-up is
 * shown as "after that". Heuristics, not a solver.
 */
import { COST } from './cards';
import { checkBuilding, piecesLeft } from './pieces';
import { playerProduction, scoreContext, scoreCorner } from './suggestions';
import { expansionSpots, robberTargets, tradeRates, tradesFor, type RobberTarget, type Trade } from './suggestionsPlay';
import type { EdgeId, GameState, PlayerId, Resource, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';

export type GoalItem = 'city' | 'settlement' | 'devCard';

export interface Goal {
  item: GoalItem;
  /** Corner for a city or settlement. */
  where?: VertexId;
  /** Roads to build first (settlement only). */
  roads: number;
  /** First road toward the spot. */
  nextRoad?: EdgeId;
  /** Everything it costs, roads included. */
  cost: ResourceCounts;
  /** Rounds until affordable (0 = this turn), with trades. 99 = not in sight. */
  eta: number;
  pips: number;
  /** An opponent can reach the spot as fast. */
  contested: boolean;
  newResources: Resource[];
  value: number;
}

export type PlanStep =
  | { kind: 'trade'; when: 'now'; trade: Trade; rate: 'bank' | '3:1' | '2:1' }
  | { kind: 'build'; when: 'now' | 'next'; item: GoalItem | 'road'; where?: VertexId | EdgeId; count?: number }
  | { kind: 'save'; when: 'next'; need: ResourceCounts; eta: number; goal: Goal }
  | { kind: 'tooMany'; when: 'now'; cards: number }
  /** Offer spare cards to other players for what the goal still needs. */
  | { kind: 'ask'; when: 'now'; want: ResourceCounts; offer: ResourceCounts }
  | { kind: 'then'; when: 'later'; goal: Goal }
  | { kind: 'robber'; when: 'if7'; target: RobberTarget };

export interface Plan {
  goal: Goal | null;
  steps: PlanStep[];
}

const add = (a: Partial<ResourceCounts>, b: Partial<ResourceCounts>, times = 1): ResourceCounts => {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = (a[r] ?? 0) + (b[r] ?? 0) * times;
  return out;
};
const total = (c: Partial<ResourceCounts>) => RESOURCES.reduce((s, r) => s + (c[r] ?? 0), 0);
const shortfall = (hand: ResourceCounts, cost: ResourceCounts) => {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.max(0, cost[r] - hand[r]);
  return out;
};

/**
 * Rounds until `cost` is affordable (with trades), assuming the player keeps
 * their cards and every player rolls once per round.
 */
export function roundsToAfford(hand: ResourceCounts, cost: ResourceCounts, perRound: ResourceCounts, rates: ResourceCounts): number {
  for (let t = 0; t <= 20; t++) {
    const h = emptyResources();
    for (const r of RESOURCES) h[r] = Math.floor(hand[r] + perRound[r] * t + 1e-9);
    if (tradesFor(h, cost, rates)) return t;
  }
  return 99;
}

/** Candidate goals for a player, best first. */
export function goals(state: GameState, player: PlayerId): Goal[] {
  const hand = state.hands[player]?.resources ?? emptyResources();
  const rates = tradeRates(state, player);
  const income = playerProduction(state, player);
  const n = Math.max(2, state.players.length);
  const perRound = emptyResources();
  for (const r of RESOURCES) perRound[r] = (income[r] * n) / 36;
  const left = piecesLeft(state, player);
  const ctx = scoreContext(state, player);
  const out: Goal[] = [];

  const goal = (g: Omit<Goal, 'eta' | 'value'>, gain: number): Goal => {
    const eta = roundsToAfford(hand, g.cost, perRound, rates);
    return { ...g, eta, value: gain / (1 + 0.5 * eta) };
  };

  if (left.city > 0) {
    for (const [v, b] of Object.entries(state.pieces.buildings)) {
      if (b.player !== player || b.kind !== 'settlement') continue;
      const sc = scoreCorner(state.board, v, { ...ctx, owned: income });
      out.push(goal({ item: 'city', where: v, roads: 0, cost: add(COST.city, {}), pips: sc.pips, contested: false, newResources: [] }, 4 + sc.pips * 0.5));
    }
  }

  if (left.settlement > 0) {
    for (const s of expansionSpots(state, player, 6)) {
      if (s.roads > Math.min(3, left.road)) continue;
      if (s.roads === 0 && checkBuilding(state, s.vertex, player, 'settlement').length) continue;
      const cost = add(COST.settlement, COST.road, s.roads);
      out.push(
        goal(
          { item: 'settlement', where: s.vertex, roads: s.roads, nextRoad: s.nextRoad, cost, pips: s.pips, contested: s.contested, newResources: s.newResources },
          4 + s.score * 0.5 + (s.contested ? 1.5 : 0),
        ),
      );
    }
  }

  out.push(goal({ item: 'devCard', roads: 0, cost: add(COST.devCard, {}), pips: 0, contested: false, newResources: [] }, 2.5 + (income.ore + income.wheat) * 0.03));
  return out.sort((a, b) => b.value - a.value);
}

function rateLabel(rates: ResourceCounts, r: Resource): 'bank' | '3:1' | '2:1' {
  return rates[r] === 2 ? '2:1' : rates[r] === 3 ? '3:1' : 'bank';
}

/** The plan for `player` (normally me): ordered steps for this turn and the next. */
export function makePlan(state: GameState, player: PlayerId): Plan {
  const hand = state.hands[player]?.resources ?? emptyResources();
  const rates = tradeRates(state, player);
  const all = goals(state, player);
  const goal = all[0] ?? null;
  const steps: PlanStep[] = [];
  const cards = total(hand);

  if (goal) {
    const others = all.filter((g) => g !== goal && g.where !== goal.where);
    const then = others.find((g) => g.item !== goal.item) ?? others[0];
    const buildSteps = (when: 'now' | 'next'): PlanStep[] => [
      ...(goal.roads ? [{ kind: 'build', when, item: 'road', where: goal.nextRoad, count: goal.roads } as PlanStep] : []),
      { kind: 'build', when, item: goal.item, where: goal.where },
    ];

    if (goal.eta === 0) {
      for (const t of tradesFor(hand, goal.cost, rates) ?? []) steps.push({ kind: 'trade', when: 'now', trade: t, rate: rateLabel(rates, t.give) });
      steps.push(...buildSteps('now'));
    } else {
      // Get a head start on a contested or multi-road spot if a road is affordable now.
      const roadNow = goal.roads > 0 && goal.nextRoad && tradesFor(hand, add(COST.road, {}), rates);
      if (roadNow && (goal.contested || cards > 7 || goal.roads > 1)) {
        for (const t of roadNow) steps.push({ kind: 'trade', when: 'now', trade: t, rate: rateLabel(rates, t.give) });
        steps.push({ kind: 'build', when: 'now', item: 'road', where: goal.nextRoad, count: 1 });
      } else if (cards > 7) {
        steps.push({ kind: 'tooMany', when: 'now', cards });
      }
      const need = shortfall(hand, goal.cost);
      const offer = emptyResources();
      // Only offer what neither this goal nor the next one needs.
      for (const r of RESOURCES) offer[r] = Math.max(0, hand[r] - Math.max(goal.cost[r], then?.cost[r] ?? 0));
      if (total(offer) > 0) steps.push({ kind: 'ask', when: 'now', want: need, offer });
      steps.push({ kind: 'save', when: 'next', need, eta: goal.eta, goal });
      steps.push(...buildSteps('next'));
    }

    if (then) steps.push({ kind: 'then', when: 'later', goal: then });
  }

  const robber = robberTargets(state, player, 1)[0];
  if (robber) steps.push({ kind: 'robber', when: 'if7', target: robber });
  return { goal, steps };
}
