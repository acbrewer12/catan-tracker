import { describe, expect, it } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { affordOdds, compareStrategies, payoutTable, sevenRisk } from './strategy';
import { rankCorners } from './suggestions';
import { newGame } from '../state/initialState';
import type { GameState, ResourceCounts } from './types';

const res = (o: Partial<ResourceCounts>): ResourceCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...o });

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function played(hand: Partial<ResourceCounts> = {}): GameState {
  const g = newGame('standard', 4);
  g.board = randomBoard('standard', seeded(42));
  const topo = topologyFor('standard');
  const me = g.players[0].id;
  const [a, b] = rankCorners(g, me).map((c) => c.vertex).filter((v, i, all) => i === 0 || !topo.vertices[all[0]].adjacent.includes(v));
  g.pieces.buildings[a] = { player: me, kind: 'settlement' };
  g.pieces.buildings[b] = { player: me, kind: 'settlement' };
  g.pieces.roads[topo.vertices[a].edges[0]] = me;
  g.pieces.roads[topo.vertices[b].edges[0]] = me;
  g.hands[me] = { ...g.hands[me], resources: res(hand) };
  return { ...g, phase: 'playing', robber: Object.values(g.board.hexes).find((h) => h.terrain === 'desert')!.id };
}

describe('compareStrategies', () => {
  it('plays out each strategy and sorts the fastest first', () => {
    const g = played();
    const { outlook, results } = compareStrategies(g, g.players[0].id);
    expect(outlook.points).toBe(2);
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < results.length; i++) expect(results[i].rounds).toBeGreaterThanOrEqual(results[i - 1].rounds);
    const best = results[0];
    expect(best.buys.length).toBeGreaterThan(0);
    // Points never go down along the purchases.
    for (let i = 1; i < best.buys.length; i++) expect(best.buys[i].points).toBeGreaterThanOrEqual(best.buys[i - 1].points);
  });

  it('buys right away when the cards are in hand', () => {
    const g = played({ wheat: 2, ore: 3 });
    const cities = compareStrategies(g, g.players[0].id).results.find((r) => r.id === 'cities')!;
    expect(cities.buys[0]).toMatchObject({ item: 'city', round: 0 });
  });
});

describe('dice odds', () => {
  it('collects on the right numbers', () => {
    const g = played();
    const t = payoutTable(g, g.players[0].id);
    expect(t[7]).toEqual(res({}));
    expect(t.reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0)).toBeGreaterThan(0);
  });

  it('odds rise turn by turn and are 1 when already affordable', () => {
    const g = played();
    const me = g.players[0].id;
    const o = affordOdds(g, me, { wood: 1, brick: 1 });
    for (let i = 1; i < o.byTurn.length; i++) expect(o.byTurn[i]).toBeGreaterThanOrEqual(o.byTurn[i - 1]);
    const ready = affordOdds({ ...g, hands: { ...g.hands, [me]: { ...g.hands[me], resources: res({ wood: 1, brick: 1 }) } } }, me, { wood: 1, brick: 1 });
    expect(ready.byTurn[0]).toBe(1);
    expect(ready.median).toBe(0);
  });

  it('seven risk grows with players', () => {
    expect(sevenRisk(4)).toBeCloseTo(1 - (5 / 6) ** 4);
    expect(sevenRisk(6)).toBeGreaterThan(sevenRisk(4));
  });
});
