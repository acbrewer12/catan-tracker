import { describe, expect, it } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { goals, makePlan, roundsToAfford } from './plan';
import { rankCorners } from './suggestions';
import { newGame } from '../state/initialState';
import type { GameState, ResourceCounts } from './types';

const res = (o: Partial<ResourceCounts>): ResourceCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...o });
const BANK = res({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 });

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function played(hand: Partial<ResourceCounts>): GameState {
  const g = newGame('standard', 4);
  g.board = randomBoard('standard', seeded(42));
  const topo = topologyFor('standard');
  const me = g.players[0].id;
  const op = g.players[1].id;
  const ranked = rankCorners(g, me).map((c) => c.vertex);
  const mine = ranked[0];
  const theirs = ranked.find((v) => v !== mine && !topo.vertices[mine].adjacent.includes(v))!;
  g.pieces.buildings[mine] = { player: me, kind: 'settlement' };
  g.pieces.buildings[theirs] = { player: op, kind: 'settlement' };
  g.pieces.roads[topo.vertices[mine].edges[0]] = me;
  g.hands[me] = { ...g.hands[me], resources: res(hand) };
  return { ...g, phase: 'playing', robber: Object.values(g.board.hexes).find((h) => h.terrain === 'desert')!.id };
}

describe('roundsToAfford', () => {
  it('is 0 when trades cover it', () => {
    expect(roundsToAfford(res({ wheat: 2, ore: 2, sheep: 4 }), res({ wheat: 2, ore: 3 }), res({}), BANK)).toBe(0);
  });
  it('counts rounds of income', () => {
    expect(roundsToAfford(res({}), res({ wood: 1, brick: 1 }), res({ wood: 0.5, brick: 0.5 }), BANK)).toBe(2);
  });
  it('is 99 with no way to get it', () => {
    expect(roundsToAfford(res({}), res({ ore: 1 }), res({}), BANK)).toBe(99);
  });
});

describe('makePlan', () => {
  it('builds a city this turn when the cards are in hand', () => {
    const g = played({ wheat: 2, ore: 3 });
    const plan = makePlan(g, g.players[0].id);
    expect(plan.goal?.item).toBe('city');
    expect(plan.steps[0]).toMatchObject({ kind: 'build', when: 'now', item: 'city' });
  });

  it('lists the trades before the build', () => {
    const g = played({ wheat: 2, ore: 2, sheep: 4 });
    const plan = makePlan(g, g.players[0].id);
    expect(plan.steps[0]).toMatchObject({ kind: 'trade', when: 'now', trade: { give: 'sheep', get: 'ore' } });
    expect(plan.steps[1]).toMatchObject({ kind: 'build', when: 'now', item: 'city' });
  });

  it('says what to save for when nothing is affordable', () => {
    const g = played({});
    const plan = makePlan(g, g.players[0].id);
    const save = plan.steps.find((s) => s.kind === 'save');
    expect(save).toBeTruthy();
    expect(plan.steps.some((s) => s.kind === 'build' && s.when === 'next')).toBe(true);
  });

  it('warns about holding more than 7 cards', () => {
    const g = played({ sheep: 9 });
    const plan = makePlan(g, g.players[0].id);
    if (plan.goal?.eta) expect(plan.steps.some((s) => s.kind === 'tooMany' || (s.kind === 'build' && s.when === 'now'))).toBe(true);
  });

  it('ends with a robber tip and a follow-up goal', () => {
    const g = played({});
    const plan = makePlan(g, g.players[0].id);
    expect(plan.steps[plan.steps.length - 1]?.kind).toBe('robber');
    expect(plan.steps.some((s) => s.kind === 'then')).toBe(true);
  });

  it('values goals with roads included in the cost', () => {
    const g = played({});
    const far = goals(g, g.players[0].id).find((x) => x.item === 'settlement' && x.roads > 0);
    if (far) expect(far.cost.wood).toBe(1 + far.roads);
  });
});

describe('player trades', () => {
  it('offers spare cards for missing ones', () => {
    const g = played({ sheep: 2, wheat: 1 });
    const plan = makePlan(g, g.players[0].id);
    const ask = plan.steps.find((s) => s.kind === 'ask');
    if (plan.goal && plan.goal.eta > 0) {
      expect(ask).toBeTruthy();
      if (ask?.kind === 'ask') for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) expect(ask.offer[r] > 0 && ask.want[r] > 0).toBe(false);
    }
  });
});
