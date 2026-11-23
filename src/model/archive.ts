/**
 * Saved games: the finished (or abandoned) games kept on this device for the
 * Review tab and for learning. Plain data + pure helpers; the React provider
 * that stores it lives in state/archive.tsx.
 *
 * Export / import is one JSON file ({ app, version, games }) so the user can
 * back up their history or move it to another phone.
 */
import { migrate } from '../state/store';
import { learnFrom, type LearnedGame, type Learning } from './learning';
import { finalPoints, stylesOf } from './review';
import type { GameState, PlayerId } from './types';

export interface ArchivedGame {
  /** Stable id for the game (from its first roll or card event), so saving twice replaces. */
  id: string;
  savedAt: number;
  /** False when saved without picking a winner (e.g. by "New" mid-game). */
  finished: boolean;
  winner: PlayerId | null;
  /** Final points (visible, plus your own VP cards; the winner at least 10). */
  points: Record<PlayerId, number>;
  state: GameState;
}

export interface ArchiveSettings {
  /** Use what was learned in the planner. */
  learn: boolean;
  /** Games saved before this time are ignored for learning (reset). */
  learnSince: number;
}

export interface Archive {
  version: 1;
  games: ArchivedGame[];
  settings: ArchiveSettings;
}

export const emptyArchive = (): Archive => ({ version: 1, games: [], settings: { learn: true, learnSince: 0 } });

/** A game worth saving: at least one roll. */
export const hasPlay = (s: GameState) => s.diceHistory.length > 0;

/** The id a game is saved under. Same game, same id, however often it's saved. */
export function gameId(s: GameState): string {
  const first = s.diceHistory[0]?.id ?? s.cardLog[0]?.id ?? 'empty';
  return `g-${first}`;
}

export function archiveGame(a: Archive, state: GameState, winner: PlayerId | null, finished: boolean, now = Date.now()): Archive {
  const id = gameId(state);
  const old = a.games.find((g) => g.id === id);
  // Saving an unfinished copy never overwrites a finished one.
  if (old?.finished && !finished) return a;
  const entry: ArchivedGame = { id, savedAt: now, finished, winner, points: finalPoints(state, winner), state };
  return { ...a, games: [entry, ...a.games.filter((g) => g.id !== id)].sort((x, y) => y.savedAt - x.savedAt) };
}

export const removeGame = (a: Archive, id: string): Archive => ({ ...a, games: a.games.filter((g) => g.id !== id) });

/** Read an archive (from storage or an imported file). Bad games are dropped, not fatal. */
export function parseArchive(raw: unknown): Archive | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Archive> & { games?: unknown };
  if (!Array.isArray(r.games)) return null;
  const games: ArchivedGame[] = [];
  for (const g of r.games as Partial<ArchivedGame>[]) {
    if (!g || typeof g !== 'object' || !g.state) continue;
    const state = migrate(structuredCloneSafe(g.state));
    if (!state || !Array.isArray(state.players)) continue;
    const winner = typeof g.winner === 'string' && state.players.some((p) => p.id === g.winner) ? g.winner : null;
    games.push({
      id: typeof g.id === 'string' ? g.id : gameId(state),
      savedAt: typeof g.savedAt === 'number' ? g.savedAt : 0,
      finished: !!g.finished,
      winner,
      points: g.points && typeof g.points === 'object' ? g.points : finalPoints(state, winner),
      state,
    });
  }
  const s = (r.settings ?? {}) as Partial<ArchiveSettings>;
  return {
    version: 1,
    games: games.sort((x, y) => y.savedAt - x.savedAt),
    settings: { learn: s.learn !== false, learnSince: typeof s.learnSince === 'number' ? s.learnSince : 0 },
  };
}

function structuredCloneSafe<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Add imported games; a game already here is kept unless the import is finished and ours isn't. */
export function mergeArchives(mine: Archive, incoming: Archive): { archive: Archive; added: number } {
  let games = [...mine.games];
  let added = 0;
  for (const g of incoming.games) {
    const i = games.findIndex((x) => x.id === g.id);
    if (i < 0) {
      games.push(g);
      added++;
    } else if (g.finished && !games[i].finished) games[i] = g;
  }
  games = games.sort((x, y) => y.savedAt - x.savedAt);
  return { archive: { ...mine, games }, added };
}

export function exportArchive(a: Archive): string {
  return JSON.stringify({ app: 'catan-tracker', ...a });
}

/** What learning sees of a saved game. */
export function toLearned(g: ArchivedGame): LearnedGame {
  const s = g.state;
  return {
    names: Object.fromEntries(s.players.map((p) => [p.id, p.name])),
    me: s.players.find((p) => p.isMe)?.id ?? '',
    winner: g.winner,
    styles: stylesOf(s, g.winner),
  };
}

/** What the planner should use, given the archive and its settings. */
export function learningOf(a: Archive): Learning | null {
  return learnFrom(a.games.filter((g) => g.finished && g.savedAt >= a.settings.learnSince).map(toLearned));
}
