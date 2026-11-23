/**
 * "What should I do next?": a strategy, one goal and ordered steps.
 *
 * 1. strategy.ts plays out four strategies (cities, expansion, dev cards /
 *    Largest Army, Longest Road) on expected income and picks the fastest
 *    path to 10 points. Its first purchase is the goal.
 * 2. The steps cover this turn (dev cards to play, trades, builds, player
 *    trades worth asking for, the 7-card risk), the next turns (what to save,
 *    with simulated-dice odds) and the purchases after that.
 * 3. Threats: opponents close to winning, racing you for a spot, or about to
 *    take Longest Road / Largest Army.
 * Heuristics on top of fast simulations, not a full solver.
 */
import { COST, handEstimates } from './cards';
import { cardOptions, likelyHas, publicHand, visiblePoints, type Backup } from './tradeValue';
import { suggestDiscard } from './discard';
import { add, goals, roundsToAfford, shortfall, threats, total, type Goal, type GoalItem, type Threat } from './goals';
import { expansionSpots, robberTargets, tradeRates, tradesFor, type RobberTarget, type Trade } from './suggestionsPlay';
import { WIN_POINTS, affordOdds, compareStrategies, sevenRisk, type AffordOdds, type PlayerOutlook, type Purchase, type StrategyResult } from './strategy';
import type { DevCardKind, EdgeId, GameState, HexId, PlayerId, Resource, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';
import { topologyFor } from './board';

export type PlanStep =
  | { kind: 'playDev'; when: 'now'; card: DevCardKind; why: 'robberOnYou' | 'army' | 'roads' | 'plenty' | 'monopoly'; take?: ResourceCounts; resource?: Resource; haul?: number; hex?: HexId }
  | { kind: 'trade'; when: 'now'; trade: Trade; rate: 'bank' | '3:1' | '2:1' }
  | { kind: 'build'; when: 'now' | 'next'; item: GoalItem; where?: VertexId | EdgeId; count?: number; pips?: number; newResources?: Resource[] }
  | { kind: 'save'; when: 'next'; need: ResourceCounts; eta: number; odds: AffordOdds; goal: Goal }
  /** Hand over 7 before the next rolls; `drop` is what to give up if a 7 comes. */
  | { kind: 'tooMany'; when: 'now'; cards: number; risk: number; drop?: ResourceCounts }
  /** You reach 10 this turn: buildings, awards and hidden VP cards. */
  | { kind: 'win'; when: 'now'; points: number; hiddenVp: number; builds: number }
  /** Near 10 visible points: the table turns on the leader. */
  | { kind: 'profile'; when: 'now'; points: number }
  /** Get a card the goal still needs: ranked options (good player trades, bank/harbor, another build, save). */
  | { kind: 'get'; when: 'now'; resource: Resource; amount: number; options: Backup[] }
  | { kind: 'then'; when: 'later'; buy: Purchase }
  /** `stealFor`: the victim was picked as the one most likely to hold this card you need. */
  | { kind: 'robber'; when: 'if7'; target: RobberTarget; stealFor?: Resource };

export type { Goal, GoalItem, Threat } from './goals';
export { goals, roundsToAfford, threats } from './goals';

export interface Plan {
  goal: Goal | null;
  steps: PlanStep[];
  /** Strategy the plan follows, and all of them fastest first. */
  strategy: StrategyResult | null;
  strategies: StrategyResult[];
  outlook: PlayerOutlook | null;
  threats: Threat[];
}

function rateLabel(rates: ResourceCounts, r: Resource): 'bank' | '3:1' | '2:1' {
  return rates[r] === 2 ? '2:1' : rates[r] === 3 ? '3:1' : 'bank';
}

/** The goal matching a simulated purchase (falls back to building one). */
function goalFor(all: Goal[], buy: Purchase): Goal | null {
  const hit = all.find((g) => g.item === buy.item && (buy.item === 'devCard' || g.where === buy.where));
  return hit ?? null;
}

/** The plan for `player` (normally me): strategy, goal and ordered steps. */
export function makePlan(state: GameState, player: PlayerId): Plan {
  const hand = { ...(state.hands[player]?.resources ?? emptyResources()) };
  const rates = tradeRates(state, player);
  const all = goals(state, player);
  const { outlook: o, results } = compareStrategies(state, player);
  const strategy = results[0] ?? null;
  const est = handEstimates(state);
  const myDev = est[player]?.dev;
  const n = Math.max(2, state.players.length);
  const topo = topologyFor(state.board.layout);

  // Goal: the chosen strategy's first purchase; fall back to the best single goal.
  let goal: Goal | null = null;
  const first = strategy?.buys[0];
  if (first?.item === 'road') {
    const spot = expansionSpots(state, player, 3).find((s) => s.nextRoad);
    const cost = add(COST.road, {});
    goal = { item: 'road', roads: 1, nextRoad: spot?.nextRoad, where: undefined, cost, eta: roundsToAfford(hand, cost, o.perRound, rates), pips: 0, contested: false, newResources: [], value: 0 };
  } else if (first) goal = goalFor(all, first);
  goal ??= all[0] ?? null;

  const steps: PlanStep[] = [];

  // 1. Dev cards worth playing this turn.
  if (myDev) {
    const myHexes = new Set(Object.entries(state.pieces.buildings).filter(([, b]) => b.player === player).flatMap(([v]) => topo.vertices[v]?.hexes ?? []));
    if (myDev.knight > 0) {
      if (state.robber && myHexes.has(state.robber) && state.board.hexes[state.robber]?.number)
        steps.push({ kind: 'playDev', when: 'now', card: 'knight', why: 'robberOnYou', hex: state.robber });
      else if (o.knightsForArmy > 0 && o.knightsForArmy <= myDev.knight) steps.push({ kind: 'playDev', when: 'now', card: 'knight', why: 'army' });
    }
    if (myDev.roadBuilding > 0 && goal && (goal.roads > 0 || goal.item === 'road')) steps.push({ kind: 'playDev', when: 'now', card: 'roadBuilding', why: 'roads' });
    if (goal && goal.eta > 0) {
      const need = shortfall(hand, goal.item === 'settlement' && myDev.roadBuilding ? add(COST.settlement, COST.road, Math.max(0, goal.roads - 2)) : goal.cost);
      if (myDev.yearOfPlenty > 0 && total(need) > 0 && total(need) <= 2) {
        steps.push({ kind: 'playDev', when: 'now', card: 'yearOfPlenty', why: 'plenty', take: need });
        for (const r of RESOURCES) hand[r] += need[r];
      } else if (myDev.monopoly > 0) {
        const r = RESOURCES.filter((x) => need[x] > 0).sort((a, b) => b.localeCompare(a))[0];
        if (r) {
          const haul = state.players.filter((p) => p.id !== player).reduce((sum, p) => sum + publicHand(state, p.id, player)[r], 0);
          if (haul >= Math.max(3, need[r])) {
            steps.push({ kind: 'playDev', when: 'now', card: 'monopoly', why: 'monopoly', resource: r, haul: Math.round(haul * 10) / 10 });
            hand[r] += Math.floor(haul);
          }
        }
      }
    }
  }

  // 2. Builds this turn: the strategy's round-0 purchases, paid with real cards and trades.
  const nowBuys = (strategy?.buys ?? []).filter((b) => b.round === 0);
  let builtNow = 0;
  for (const b of nowBuys) {
    const g = b.item === 'road' ? goal : goalFor(all, b);
    const cost = b.item === 'road' ? add(COST.road, {}) : g?.cost ?? add(COST[b.item], {});
    const trades = tradesFor(hand, cost, rates);
    if (!trades) break;
    for (const t of trades) {
      steps.push({ kind: 'trade', when: 'now', trade: t, rate: rateLabel(rates, t.give) });
      hand[t.give] -= t.count;
      hand[t.get] += t.count / rates[t.give];
    }
    for (const r of RESOURCES) hand[r] -= cost[r];
    if (g?.roads && b.item === 'settlement') steps.push({ kind: 'build', when: 'now', item: 'road', where: g.nextRoad, count: g.roads });
    steps.push({ kind: 'build', when: 'now', item: b.item, where: b.item === 'road' ? goal?.nextRoad : b.where, pips: g?.pips, newResources: g?.newResources });
    builtNow++;
  }

  // 3. Not affordable yet: player trades, 7 risk, what to save for and the odds.
  const nextGoal = builtNow ? (() => {
    const later = strategy?.buys.find((b) => b.round > 0);
    return later ? (later.item === 'road' ? goal : goalFor(all, later)) : null;
  })() : goal;
  if (nextGoal) {
    const need = shortfall(hand, nextGoal.cost);
    if (total(need) > 0) {
      // Each missing card: ranked ways to get it. Plan with the hand left after this turn's builds.
      const after: GameState = { ...state, hands: { ...state.hands, [player]: { ...state.hands[player], resources: floorAll(hand) } } };
      const thenBuy = (strategy?.buys ?? []).find((b) => b.round > 0 && !(b.item === nextGoal.item && b.where === nextGoal.where));
      const thenGoal = thenBuy ? goalFor(all, thenBuy) : null;
      const keep = emptyResources();
      for (const r of RESOURCES) keep[r] = Math.max(nextGoal.cost[r], thenGoal?.cost[r] ?? 0);
      // Skip a card whose best option is just "save": the save step below covers it.
      // Cards one step offers (a bank trade) aren't offered again by the next.
      let pool = after;
      for (const r of RESOURCES.filter((x) => need[x] > 0).sort((a, b) => need[b] - need[a]).slice(0, 2)) {
        const options = cardOptions(pool, player, r, nextGoal, [], keep, need[r]);
        if (!options.length || options[0].kind === 'save') continue;
        steps.push({ kind: 'get', when: 'now', resource: r, amount: need[r], options });
        const b = options[0];
        if (b.kind === 'bank') {
          const res = { ...pool.hands[player].resources, [b.give]: pool.hands[player].resources[b.give] - b.count };
          pool = { ...pool, hands: { ...pool.hands, [player]: { ...pool.hands[player], resources: res } } };
        }
      }
      const cards = total(hand);
      if (cards > 7) steps.push({ kind: 'tooMany', when: 'now', cards: Math.floor(cards), risk: sevenRisk(n), drop: dropFor(after, player, nextGoal) });
      const odds = affordOdds({ ...state, hands: { ...state.hands, [player]: { ...state.hands[player], resources: floorAll(hand) } } }, player, nextGoal.cost, 8);
      steps.push({ kind: 'save', when: 'next', need, eta: roundsToAfford(floorAll(hand), nextGoal.cost, o.perRound, rates), odds, goal: nextGoal });
      if (nextGoal.roads && nextGoal.item === 'settlement') steps.push({ kind: 'build', when: 'next', item: 'road', where: nextGoal.nextRoad, count: nextGoal.roads });
      steps.push({ kind: 'build', when: 'next', item: nextGoal.item, where: nextGoal.item === 'road' ? nextGoal.nextRoad : nextGoal.where, pips: nextGoal.pips, newResources: nextGoal.newResources });
    } else if (total(hand) > 7) {
      const after: GameState = { ...state, hands: { ...state.hands, [player]: { ...state.hands[player], resources: floorAll(hand) } } };
      steps.push({ kind: 'tooMany', when: 'now', cards: Math.floor(total(hand)), risk: sevenRisk(n), drop: dropFor(after, player, nextGoal) });
    }
  }

  // 4. After that: the strategy's next purchases.
  const shown = new Set(steps.filter((s) => s.kind === 'build').map((s) => (s as { where?: string }).where));
  const later = (strategy?.buys ?? []).filter((b) => b.round > 0 && !(b.where && shown.has(b.where)) && !(nextGoal && b.item === nextGoal.item && b.where === nextGoal.where));
  for (const b of later.slice(0, 2)) steps.push({ kind: 'then', when: 'later', buy: b });

  // Count to 10: buildings + awards + hidden VP cards, plus what you build this turn.
  const hiddenVp = myDev?.victoryPoint ?? 0;
  const visible = visiblePoints(state, player);
  const pointsBuilt = steps.filter((s) => s.kind === 'build' && s.when === 'now' && (s.item === 'settlement' || s.item === 'city')).length;
  if (visible + hiddenVp + pointsBuilt >= WIN_POINTS) {
    steps.unshift({ kind: 'win', when: 'now', points: visible + hiddenVp + pointsBuilt, hiddenVp, builds: pointsBuilt });
  } else if (visible >= WIN_POINTS - 3) {
    const at = steps.map((x) => x.when).lastIndexOf('now') + 1;
    steps.splice(at, 0, { kind: 'profile', when: 'now', points: visible });
  }

  // Robber: best tile (hurts the leader, spares your tiles); steal from whoever
  // most likely holds a card you still need (public info: income and card count).
  const robber = robberTargets(state, player, 1)[0];
  if (robber) {
    const want = nextGoal ? RESOURCES.filter((r) => shortfall(floorAll(hand), nextGoal.cost)[r] > 0) : [];
    let stealFor: Resource | undefined;
    if (want.length && robber.hits.length > 1) {
      const pick = robber.hits
        .map((h) => ({ p: h.player, r: want.reduce((best, r) => (likelyHas(state, h.player, r) > likelyHas(state, h.player, best) ? r : best), want[0]) }))
        .map((x) => ({ ...x, odds: likelyHas(state, x.p, x.r) }))
        .sort((a, b) => b.odds - a.odds)[0];
      if (pick && pick.odds > 0 && pick.p !== robber.stealFrom) {
        robber.stealFrom = pick.p;
        stealFor = pick.r;
      } else if (pick && pick.p === robber.stealFrom && pick.odds >= 0.5) stealFor = pick.r;
    }
    steps.push({ kind: 'robber', when: 'if7', target: robber, stealFor });
  }
  return { goal, steps, strategy, strategies: results, outlook: o, threats: threats(state, player, nextGoal ?? goal) };
}

/** What to drop if a 7 comes before you spend (keeps the goal's cards). */
function dropFor(state: GameState, player: PlayerId, goal: Goal | null): ResourceCounts | undefined {
  return suggestDiscard(state, player, goal)?.discard;
}

const floorAll = (c: ResourceCounts) => {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.max(0, Math.floor(c[r] + 1e-9));
  return out;
};
