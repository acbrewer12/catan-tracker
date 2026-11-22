import { describe, expect, it } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { hexCornerIds } from './geometry';
import { checkBuilding } from './pieces';
import { placementAdvice, placementOrder, rankCorners, scarcityWeights } from './suggestions';
import { buildOptions, expansionSpots, robberTargets, tradeRates, tradesFor } from './suggestionsPlay';
import { newGame } from '../state/initialState';
import type { GameState, ResourceCounts } from './types';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function game(): GameState {
  const g = newGame('standard', 4);
  return { ...g, board: randomBoard('standard', seeded(42)), phase: 'placement' };
}

const res = (o: Partial<ResourceCounts>): ResourceCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...o });

describe('placement', () => {
  it('snake order goes 1..n then n..1', () => {
    expect(placementOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual(['a', 'b', 'c', 'c', 'b', 'a']);
  });

  it('ranks a 6/8/5 three-resource corner first', () => {
    const g = game();
    const v = hexCornerIds('0,0')[0];
    const hexes = topologyFor('standard').vertices[v].hexes;
    const setup: Array<[string, number]> = [['ore', 6], ['wheat', 8], ['brick', 5]];
    hexes.forEach((h, i) => (g.board.hexes[h] = { ...g.board.hexes[h], terrain: setup[i][0] as 'ore', number: setup[i][1] }));
    // Make sure no other corner beats it by also being 6/8/x.
    for (const h of Object.values(g.board.hexes)) if (!hexes.includes(h.id) && (h.number === 6 || h.number === 8)) h.number = 3;
    expect(rankCorners(g, g.players[0].id)[0].vertex).toBe(v);
  });

  it('scarce resources weigh more', () => {
    const g = game();
    for (const h of Object.values(g.board.hexes)) if (h.terrain === 'ore') h.number = 2;
    const w = scarcityWeights(g.board);
    expect(w.ore).toBeGreaterThan(w.wood);
  });

  it('respects the distance rule', () => {
    const g = game();
    const v = Object.keys(topologyFor('standard').vertices).find((x) => topologyFor('standard').vertices[x].hexes.length === 3)!;
    g.pieces.buildings[v] = { player: g.players[1].id, kind: 'settlement' };
    const ranked = rankCorners(g, g.players[0].id).map((c) => c.vertex);
    expect(ranked).not.toContain(v);
    for (const u of topologyFor('standard').vertices[v].adjacent) expect(ranked).not.toContain(u);
    expect(checkBuilding(g, v, g.players[0].id, 'settlement').map((p) => p.code)).toContain('occupied');
  });

  it('plans a pair when I pick last in round one', () => {
    const g = game();
    // Me is players[0]; move me to the end of the order.
    g.players = [...g.players.slice(1), g.players[0]];
    const a = placementAdvice(g);
    expect(a.myPicks).toEqual([3, 4]);
    expect(a.picksBeforeMine).toBe(3);
    expect(a.likelyTaken).toHaveLength(3);
    expect(a.ranked[0].likelyGone).toBe(false);
    expect(a.ranked[0].pairedWith).toBeTruthy();
    expect(a.ranked[0].road).toBeTruthy();
  });

  it('has no advice once all setup picks are made', () => {
    const g = game();
    const order = placementOrder(g.players);
    for (const p of order) {
      const best = rankCorners(g, p)[0];
      g.pieces.buildings[best.vertex] = { player: p, kind: 'settlement' };
    }
    const a = placementAdvice(g);
    expect(a.pickIndex).toBeNull();
    expect(a.ranked).toHaveLength(0);
  });
});

describe('trades', () => {
  it('uses spare cards at the best rate', () => {
    const t = tradesFor(res({ wheat: 2, ore: 2, sheep: 4 }), { wheat: 2, ore: 3 }, res({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 }));
    expect(t).toEqual([{ give: 'sheep', count: 4, get: 'ore' }]);
  });
  it('returns null when not enough spare cards', () => {
    expect(tradesFor(res({ sheep: 3 }), { wood: 1, brick: 1 }, res({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 }))).toBeNull();
  });
  it('never trades away cards the build needs', () => {
    expect(tradesFor(res({ wheat: 5 }), { wheat: 2, ore: 1 }, res({ wood: 4, brick: 4, sheep: 4, wheat: 3, ore: 4 }))).toEqual([{ give: 'wheat', count: 3, get: 'ore' }]);
    expect(tradesFor(res({ wheat: 4 }), { wheat: 2, ore: 1 }, res({ wood: 4, brick: 4, sheep: 4, wheat: 3, ore: 4 }))).toBeNull();
  });
  it('harbors lower the rate', () => {
    const g = game();
    const port = g.board.ports.find((p) => p.kind === 'any')!;
    const v = topologyFor('standard').edges[port.edge].vertices[0];
    g.pieces.buildings[v] = { player: g.players[0].id, kind: 'settlement' };
    expect(tradeRates(g, g.players[0].id).wood).toBe(3);
  });
});

describe('during play', () => {
  function played(): GameState {
    const g = game();
    const me = g.players[0].id;
    const op = g.players[1].id;
    const topo = topologyFor('standard');
    const [mine, theirs] = rankCorners(g, me).map((c) => c.vertex).filter((v, i, all) => i === 0 || !topo.vertices[all[0]].adjacent.includes(v)) as [string, string];
    g.pieces.buildings[mine] = { player: me, kind: 'settlement' };
    g.pieces.buildings[theirs] = { player: op, kind: 'settlement' };
    g.pieces.roads[topo.vertices[mine].edges[0]] = me;
    return { ...g, phase: 'playing', robber: Object.values(g.board.hexes).find((h) => h.terrain === 'desert')!.id };
  }

  it('finds expansion spots with road counts', () => {
    const g = played();
    const spots = expansionSpots(g, g.players[0].id);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      expect(s.roads).toBeGreaterThanOrEqual(1);
      expect(s.nextRoad).toBeTruthy();
      expect(g.pieces.roads[s.nextRoad!]).toBeUndefined();
    }
  });

  it('suggests a city when I hold the cards', () => {
    const g = played();
    const me = g.players[0].id;
    g.hands[me] = { resources: res({ wheat: 2, ore: 3 }), unknown: 0, devCards: 0 };
    const opts = buildOptions(g, me);
    expect(opts[0].kind).toBe('city');
    expect(opts[0].status).toBe('now');
  });

  it('robber goes on an opponent, never only on me', () => {
    const g = played();
    const me = g.players[0].id;
    const targets = robberTargets(g, me);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.hits.length).toBeGreaterThan(0);
      expect(t.hex).not.toBe(g.robber);
      expect(t.stealFrom).toBe(g.players[1].id);
    }
  });
});
