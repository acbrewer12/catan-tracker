import { describe, expect, it, afterEach } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { rankCorners } from './suggestions';
import { reviewGame } from './review';
import { stateAt, turnsOf } from './history';
import { archiveGame, emptyArchive, exportArchive, learningOf, mergeArchives, parseArchive } from './archive';
import { learnFrom, rivalFactor, setActiveLearning, strategyBias, type LearnedGame } from './learning';
import { compareStrategies } from './strategy';
import { newGame } from '../state/initialState';
import { reducer, type Action } from '../state/reducer';
import type { GameState, PlayerId } from './types';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const run = (s: GameState, ...as: Action[]) => as.reduce(reducer, s);
let rollSeq = 0;
const roll = (total: number, player: PlayerId): Action => ({ type: 'dice/add', roll: { id: `r${rollSeq++}`, total, player, at: Date.now() } });

/** A 4-player game: everyone else opens on the best spot; I open on a weak one. */
function opened(): { g: GameState; me: PlayerId; ids: PlayerId[] } {
  let g = newGame('standard', 4);
  g = { ...g, board: randomBoard('standard', seeded(7)) };
  const ids = g.players.map((p) => p.id);
  const me = ids[0];
  const topo = topologyFor('standard');
  const place = (s: GameState, p: PlayerId, pick: 'best' | 'worst') => {
    const ranked = rankCorners(s, p).filter((c) => c.pips > 0);
    const v = pick === 'best' ? ranked[0].vertex : ranked[ranked.length - 1].vertex;
    const e = topo.vertices[v].edges.find((x) => !s.pieces.roads[x])!;
    return run(s, { type: 'pieces/setBuilding', vertex: v, player: p, kind: 'settlement' }, { type: 'pieces/setRoad', edge: e, player: p });
  };
  for (const p of [...ids, ...[...ids].reverse()]) g = place(g, p, p === me ? 'worst' : 'best');
  return { g: { ...g, phase: 'playing' }, me, ids };
}

afterEach(() => setActiveLearning(null));

describe('history', () => {
  it('rebuilds the board as it was before each event', () => {
    const { g } = opened();
    const before = stateAt(g, 0, 0);
    expect(Object.keys(before.pieces.buildings)).toHaveLength(0);
    const all = stateAt(g, g.cardLog.length, 0);
    expect(all.pieces.buildings).toEqual(g.pieces.buildings);
    expect(all.pieces.roads).toEqual(g.pieces.roads);
  });

  it('splits the log into turns by roll', () => {
    const { g: g0, ids } = opened();
    const g = run(g0, roll(8, ids[0]), { type: 'cards/log', event: { kind: 'gain', player: ids[0], resources: { ore: 1 } } }, roll(6, ids[1]));
    const t = turnsOf(g);
    expect(t).toHaveLength(2);
    expect(t[0].player).toBe(ids[0]);
    expect(g.cardLog.slice(t[0].start, t[0].end).some((e) => e.kind === 'gain')).toBe(true);
    expect(t[1].start).toBe(t[0].end);
  });
});

describe('reviewGame', () => {
  it('flags a weak opening with the better spot', () => {
    const { g } = opened();
    const r = reviewGame(g, null, { quick: true })!;
    const open = r.moments.filter((m) => m.topic === 'opening');
    expect(open.length).toBe(2);
    expect(open.some((m) => m.tone !== 'good' && m.better)).toBe(true);
    expect(r.lessons[0].id).toBe('opening');
  });

  it('flags a trade that helps the leader, a discard and a missed city', () => {
    const { g: g0, me, ids } = opened();
    const op = ids[1];
    let g = run(
      g0,
      roll(5, me),
      // Give me a city's worth and more, then let a turn pass without building.
      { type: 'cards/log', event: { kind: 'gain', player: me, resources: { ore: 3, wheat: 2, sheep: 4 } } },
      roll(9, op),
    );
    // Make the opponent the clear leader before the trade.
    const topo = topologyFor('standard');
    const spots = rankCorners(g, op).map((c) => c.vertex).filter((v) => !topo.vertices[v].adjacent.some((a) => g.pieces.buildings[a]));
    for (const v of spots.slice(0, 1)) g = run(g, { type: 'pieces/setBuilding', vertex: v, player: op, kind: 'settlement' });
    for (const [v, b] of Object.entries(g.pieces.buildings)) if (b.player === op) g = run(g, { type: 'pieces/setBuilding', vertex: v, player: op, kind: 'city' });
    g = run(
      g,
      { type: 'cards/log', event: { kind: 'gain', player: op, resources: { wood: 2, brick: 2 } } },
      { type: 'cards/log', event: { kind: 'trade', player: me, with: op, give: { ore: 2 }, get: { wood: 1 } } },
      roll(7, ids[2]),
      { type: 'cards/log', event: { kind: 'lose', player: me, resources: { sheep: 3 }, reason: 'discard' } },
    );
    const r = reviewGame(g, op)!;
    expect(r.winner).toBe(op);
    expect(r.place).toBeGreaterThan(1);
    const trade = r.moments.find((m) => m.topic === 'trades');
    expect(trade?.tone).not.toBe('good');
    expect(trade?.title).toMatch(/Turn 2: you traded 2 ore to/);
    expect(r.moments.some((m) => m.topic === 'sevens' && /discard 3 cards/.test(m.title))).toBe(true);
    expect(r.moments.some((m) => m.topic === 'missedBuilds' && m.turn === 1)).toBe(true);
    expect(r.stats.cardsLostToSevens).toBe(3);
    // Never mentions what an opponent holds.
    for (const m of r.moments) expect(`${m.title} ${m.detail ?? ''}`).not.toMatch(/holds|in hand: |their cards/i);
  });
});

describe('archive', () => {
  it('saves a game once, finished replaces unfinished, and round-trips through export', () => {
    const { g: g0, ids } = opened();
    const g = run(g0, roll(8, ids[0]));
    let a = archiveGame(emptyArchive(), g, null, false, 1);
    a = archiveGame(a, g, ids[1], true, 2);
    a = archiveGame(a, g, null, false, 3);
    expect(a.games).toHaveLength(1);
    expect(a.games[0]).toMatchObject({ finished: true, winner: ids[1] });
    expect(a.games[0].points[ids[1]]).toBeGreaterThanOrEqual(10);
    const back = parseArchive(JSON.parse(exportArchive(a)))!;
    expect(back.games[0].state.cardLog).toHaveLength(g.cardLog.length);
    expect(mergeArchives(back, a).added).toBe(0);
    expect(parseArchive({ nope: 1 })).toBeNull();
  });
});

describe('learning', () => {
  const style = (player: string, strategies: LearnedGame['styles'][number]['strategies']) => ({
    player,
    points: 10,
    cities: 0,
    settlements: 0,
    longestRoad: false,
    largestArmy: false,
    devBought: 0,
    strategies,
  });
  const game = (winner: string, strat: 'cities' | 'expand'): LearnedGame => ({
    names: { a: 'Me', b: 'Sam', c: 'Kit', d: 'Lee' },
    me: 'a',
    winner,
    styles: [style(winner, { [strat]: 1 })],
  });

  it('needs two finished games', () => {
    expect(learnFrom([game('b', 'cities')])).toBeNull();
  });

  it('leans toward what won, bounded, and weights frequent winners', () => {
    const l = learnFrom([game('b', 'cities'), game('b', 'cities'), game('c', 'cities')])!;
    expect(l.strategyBias.cities).toBeLessThan(0);
    expect(l.strategyBias.cities).toBeGreaterThanOrEqual(-1);
    expect(l.rivals.sam).toBeGreaterThan(1);
    expect(l.rivals.sam).toBeLessThanOrEqual(1.4);
    expect(l.notes.some((n) => /Sam won 2 of 3/.test(n.text))).toBe(true);
    setActiveLearning(l);
    expect(strategyBias('cities')).toBe(l.strategyBias.cities);
    expect(rivalFactor(' sam ')).toBe(l.rivals.sam);
    setActiveLearning(null);
    expect(strategyBias('cities')).toBe(0);
    expect(rivalFactor('Sam')).toBe(1);
  });

  it('only nudges the strategy ranking, and reports the nudge', () => {
    const { g, me } = opened();
    const plain = compareStrategies(g, me).results;
    setActiveLearning({ games: 5, strategyBias: { [plain[plain.length - 1].id]: -1 }, rivals: {}, notes: [] });
    const nudged = compareStrategies(g, me).results;
    const moved = nudged.find((r) => r.learnedBias);
    expect(moved?.learnedBias).toBe(-1);
    // Same simulations, just ranked with the bias.
    expect(nudged.map((r) => r.rounds).sort()).toEqual(plain.map((r) => r.rounds).sort());
  });

  it('ignores games saved before a reset', () => {
    const { g: g0, ids } = opened();
    let a = emptyArchive();
    for (let i = 0; i < 3; i++) {
      const g = run(g0, roll(8 + (i % 2), ids[0]));
      a = archiveGame(a, { ...g, diceHistory: g.diceHistory.map((r) => ({ ...r, id: `x${i}` })) }, ids[1], true, 10 + i);
    }
    expect(learningOf(a)?.games).toBe(3);
    expect(learningOf({ ...a, settings: { learn: true, learnSince: 100 } })).toBeNull();
  });
});
