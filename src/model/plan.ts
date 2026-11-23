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
import { COST, handEstimates, type HandEstimate } from './cards';
import { boardPoints, checkBuilding, longestRoad, longestRoadHolder, piecesLeft } from './pieces';
import { playerProduction, scoreContext, scoreCorner } from './suggestions';
import { expansionSpots, robberTargets, tradeRates, tradesFor, type RobberTarget, type Trade } from './suggestionsPlay';
import { affordOdds, compareStrategies, sevenRisk, WIN_POINTS, type AffordOdds, type PlayerOutlook, type Purchase, type StrategyResult } from './strategy';
import { largestArmyHolder } from './suggestionsPlay';
import type { DevCardKind, EdgeId, GameState, HexId, PlayerId, Resource, ResourceCounts, VertexId } from './types';
import { RESOURCES, emptyResources } from './types';
import { topologyFor } from './board';

export type GoalItem = 'city' | 'settlement' | 'devCard' | 'road';

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
  | { kind: 'playDev'; when: 'now'; card: DevCardKind; why: 'robberOnYou' | 'army' | 'roads' | 'plenty' | 'monopoly'; take?: ResourceCounts; resource?: Resource; haul?: number; hex?: HexId }
  | { kind: 'trade'; when: 'now'; trade: Trade; rate: 'bank' | '3:1' | '2:1' }
  | { kind: 'build'; when: 'now' | 'next'; item: GoalItem; where?: VertexId | EdgeId; count?: number; pips?: number; newResources?: Resource[] }
  | { kind: 'save'; when: 'next'; need: ResourceCounts; eta: number; odds: AffordOdds; goal: Goal }
  | { kind: 'tooMany'; when: 'now'; cards: number; risk: number }
  /** Ask a specific player for a card you need; `give` is a spare card they're short of. */
  | { kind: 'ask'; when: 'now'; partner: PlayerId; get: Resource; give: Resource | null; sure: boolean; theyHave: number }
  | { kind: 'then'; when: 'later'; buy: Purchase }
  | { kind: 'robber'; when: 'if7'; target: RobberTarget };

export type Threat =
  | { kind: 'nearWin'; player: PlayerId; points: number; devCards: number }
  | { kind: 'longestRoad'; player: PlayerId; length: number; mine: number; holds: boolean }
  | { kind: 'largestArmy'; player: PlayerId; knights: number; mine: number; holds: boolean }
  | { kind: 'race'; player: PlayerId; where: VertexId };

export interface Plan {
  goal: Goal | null;
  steps: PlanStep[];
  /** Strategy the plan follows, and all of them fastest first. */
  strategy: StrategyResult | null;
  strategies: StrategyResult[];
  outlook: PlayerOutlook | null;
  threats: Threat[];
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

/** The goal matching a simulated purchase (falls back to building one). */
function goalFor(all: Goal[], buy: Purchase): Goal | null {
  const hit = all.find((g) => g.item === buy.item && (buy.item === 'devCard' || g.where === buy.where));
  return hit ?? null;
}

/** Opponents' hands: estimates from the Dice tab, or the plain hand when there's no log. */
function opponentCards(state: GameState, est: Record<PlayerId, HandEstimate>, p: PlayerId, r: Resource): { expected: number; min: number } {
  const e = state.cardLog?.length ? est[p]?.resources?.[r] : undefined;
  if (e) return { expected: e.expected, min: e.min };
  const h = state.hands[p];
  return { expected: h?.resources[r] ?? 0, min: h?.resources[r] ?? 0 };
}

export function threats(state: GameState, me: PlayerId, goal: Goal | null): Threat[] {
  const out: Threat[] = [];
  const holder = longestRoadHolder(state);
  const army = largestArmyHolder(state);
  const myRoad = longestRoad(state, me);
  const myKnights = state.hands[me]?.knightsPlayed ?? 0;
  for (const p of state.players) {
    if (p.id === me) continue;
    const pts = boardPoints(state, p.id, holder) + (army === p.id ? 2 : 0);
    const dev = state.hands[p.id]?.devCards ?? 0;
    if (pts >= WIN_POINTS - 3) out.push({ kind: 'nearWin', player: p.id, points: pts, devCards: dev });
    const len = longestRoad(state, p.id);
    if (holder === p.id || (len >= 4 && len > myRoad)) out.push({ kind: 'longestRoad', player: p.id, length: len, mine: myRoad, holds: holder === p.id });
    const k = state.hands[p.id]?.knightsPlayed ?? 0;
    if (army === p.id || (k >= 2 && k >= myKnights)) out.push({ kind: 'largestArmy', player: p.id, knights: k, mine: myKnights, holds: army === p.id });
  }
  if (goal?.contested && goal.where) {
    // Who else can reach the spot: anyone with a road or building within 2 steps.
    const topo = topologyFor(state.board.layout);
    const near = new Set<VertexId>([goal.where, ...topo.vertices[goal.where].adjacent]);
    for (const v of [...near]) for (const a of topo.vertices[v].adjacent) near.add(a);
    const rival = state.players.find(
      (p) =>
        p.id !== me &&
        [...near].some((v) => state.pieces.buildings[v]?.player === p.id || topo.vertices[v].edges.some((e) => state.pieces.roads[e] === p.id)),
    );
    if (rival) out.push({ kind: 'race', player: rival.id, where: goal.where });
  }
  const order = { nearWin: 0, race: 1, longestRoad: 2, largestArmy: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
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
          const haul = state.players.filter((p) => p.id !== player).reduce((sum, p) => sum + opponentCards(state, est, p.id, r).expected, 0);
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
      const spare = emptyResources();
      for (const r of RESOURCES) spare[r] = Math.max(0, Math.floor(hand[r]) - nextGoal.cost[r]);
      const leaders = new Set(threats(state, player, null).filter((t) => t.kind === 'nearWin').map((t) => t.player));
      for (const r of RESOURCES.filter((x) => need[x] > 0)) {
        const options = state.players
          .filter((p) => p.id !== player && !leaders.has(p.id))
          .map((p) => ({ p: p.id, ...opponentCards(state, est, p.id, r) }))
          .filter((x) => x.expected >= 0.5)
          .sort((a, b) => Number(b.min >= 1) - Number(a.min >= 1) || b.expected - a.expected);
        const best = options[0];
        if (!best) continue;
        const give = RESOURCES.filter((x) => spare[x] > 0).sort((a, b) => opponentCards(state, est, best.p, a).expected - opponentCards(state, est, best.p, b).expected)[0] ?? null;
        if (give) spare[give]--;
        steps.push({ kind: 'ask', when: 'now', partner: best.p, get: r, give, sure: best.min >= 1, theyHave: Math.round(best.expected * 10) / 10 });
        if (steps.filter((s) => s.kind === 'ask').length >= 2) break;
      }
      const cards = total(hand);
      if (cards > 7) steps.push({ kind: 'tooMany', when: 'now', cards: Math.floor(cards), risk: sevenRisk(n) });
      const odds = affordOdds({ ...state, hands: { ...state.hands, [player]: { ...state.hands[player], resources: floorAll(hand) } } }, player, nextGoal.cost, 8);
      steps.push({ kind: 'save', when: 'next', need, eta: roundsToAfford(floorAll(hand), nextGoal.cost, o.perRound, rates), odds, goal: nextGoal });
      if (nextGoal.roads && nextGoal.item === 'settlement') steps.push({ kind: 'build', when: 'next', item: 'road', where: nextGoal.nextRoad, count: nextGoal.roads });
      steps.push({ kind: 'build', when: 'next', item: nextGoal.item, where: nextGoal.item === 'road' ? nextGoal.nextRoad : nextGoal.where, pips: nextGoal.pips, newResources: nextGoal.newResources });
    } else if (total(hand) > 7) steps.push({ kind: 'tooMany', when: 'now', cards: Math.floor(total(hand)), risk: sevenRisk(n) });
  }

  // 4. After that: the strategy's next purchases.
  const shown = new Set(steps.filter((s) => s.kind === 'build').map((s) => (s as { where?: string }).where));
  const later = (strategy?.buys ?? []).filter((b) => b.round > 0 && !(b.where && shown.has(b.where)) && !(nextGoal && b.item === nextGoal.item && b.where === nextGoal.where));
  for (const b of later.slice(0, 2)) steps.push({ kind: 'then', when: 'later', buy: b });

  const robber = robberTargets(state, player, 1)[0];
  if (robber) steps.push({ kind: 'robber', when: 'if7', target: robber });
  return { goal, steps, strategy, strategies: results, outlook: o, threats: threats(state, player, nextGoal ?? goal) };
}

const floorAll = (c: ResourceCounts) => {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.max(0, Math.floor(c[r] + 1e-9));
  return out;
};
