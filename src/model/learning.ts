/**
 * "Let it improve": small, explainable adjustments to the planner learned
 * from the user's saved games. Two knobs only, both bounded:
 *
 *   strategy bias   Strategies that have won in this group get up to 1 round
 *                   off in compareStrategies' ranking, ones that never win up
 *                   to 1 round on. It only decides between near-ties.
 *   rival factor    Opponents who win often count up to 1.4x when the trade
 *                   check weighs how much a trade helps them. Stricter only:
 *                   it never makes a trade look better.
 *
 * Every adjustment comes with a note saying why. Nothing applies until two
 * finished games with a winner are saved, and the user can turn it off or
 * reset it (games before the reset are then ignored).
 *
 * The active learning is a module-level value so the pure planner functions
 * can read it without every caller passing it through. The archive provider
 * sets it; tests set it directly.
 */
import type { Style } from './review';
import type { StrategyId } from './strategy';

export const MIN_GAMES = 2;
export const MAX_BIAS = 1;
export const MAX_RIVAL = 1.4;

export interface LearnedGame {
  /** Name of each player (names carry across games; ids may not). */
  names: Record<string, string>;
  me: string;
  winner: string | null;
  styles: Style[];
}

export interface LearningNote {
  kind: 'strategy' | 'rival';
  text: string;
}

export interface Learning {
  games: number;
  /** Rounds added to a strategy's estimate when ranking (negative = preferred). */
  strategyBias: Partial<Record<StrategyId, number>>;
  /** Lower-case player name -> weight on their gain in trade checks (1 = none). */
  rivals: Record<string, number>;
  notes: LearningNote[];
}

export const STRATEGY_NAME: Record<StrategyId, string> = {
  cities: 'Cities first',
  expand: 'Expand first',
  devCards: 'Dev cards and Largest Army',
  longestRoad: 'Longest Road',
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
export const nameKey = (n: string) => n.trim().toLowerCase();

/** Learn from finished games that have a winner. Returns null when there isn't enough yet. */
export function learnFrom(games: LearnedGame[]): Learning | null {
  const done = games.filter((g) => g.winner);
  if (done.length < MIN_GAMES) return null;
  // Shrink toward "no change" when there are few games.
  const confidence = done.length / (done.length + 3);
  const notes: LearningNote[] = [];

  // Which strategies won.
  const ids: StrategyId[] = ['cities', 'expand', 'devCards', 'longestRoad'];
  const wins: Record<StrategyId, number> = { cities: 0, expand: 0, devCards: 0, longestRoad: 0 };
  for (const g of done) {
    const s = g.styles.find((x) => x.player === g.winner);
    for (const id of ids) wins[id] += s?.strategies[id] ?? 0;
  }
  const strategyBias: Partial<Record<StrategyId, number>> = {};
  const base = 1 / ids.length;
  for (const id of ids) {
    const share = wins[id] / done.length;
    const bias = r1(clamp(-(share - base) * 2.5 * confidence, -MAX_BIAS, MAX_BIAS));
    // Too small to matter: leave the planner alone and say nothing.
    if (Math.abs(bias) < 0.25) continue;
    strategyBias[id] = bias;
    const w = r1(wins[id]);
    notes.push({
      kind: 'strategy',
      text:
        bias < 0
          ? `${STRATEGY_NAME[id]} won ${w} of ${done.length} games in your group, so the planner leans toward it when strategies are close (${bias} rounds).`
          : `${STRATEGY_NAME[id]} won ${w} of ${done.length} games in your group, so the planner leans away from it when strategies are close (+${bias} rounds).`,
    });
  }

  // Who wins often.
  const played: Record<string, { name: string; games: number; wins: number; seats: number }> = {};
  for (const g of done) {
    const n = Object.keys(g.names).length || 4;
    for (const [id, nm] of Object.entries(g.names)) {
      if (id === g.me) continue;
      const k = nameKey(nm);
      const row = (played[k] ??= { name: nm.trim(), games: 0, wins: 0, seats: 0 });
      row.games++;
      row.seats += 1 / n;
      if (g.winner === id) row.wins++;
    }
  }
  const rivals: Record<string, number> = {};
  for (const [k, row] of Object.entries(played)) {
    if (row.games < MIN_GAMES || !row.wins) continue;
    const expected = row.seats / row.games;
    const rate = row.wins / row.games;
    const over = clamp((rate - expected) / (1 - expected), 0, 1);
    const f = r1(1 + (MAX_RIVAL - 1) * over * (row.games / (row.games + 2)));
    if (f <= 1) continue;
    rivals[k] = f;
    notes.push({
      kind: 'rival',
      text: `${row.name} won ${row.wins} of ${row.games} games, so the trade check counts help to ${row.name} ${f}x as much.`,
    });
  }
  return { games: done.length, strategyBias, rivals, notes };
}

let active: Learning | null = null;

/** Set (or clear) what the planner uses. Called by the archive provider. */
export function setActiveLearning(l: Learning | null) {
  active = l;
}

export function activeLearning(): Learning | null {
  return active;
}

/** Rounds to add to a strategy's estimate when ranking (0 when nothing is learned). */
export function strategyBias(id: StrategyId): number {
  return active?.strategyBias[id] ?? 0;
}

/** Extra weight on a trade partner's gain (1 when nothing is learned). */
export function rivalFactor(name: string | undefined): number {
  if (!name || !active) return 1;
  return Math.max(1, active.rivals[nameKey(name)] ?? 1);
}
