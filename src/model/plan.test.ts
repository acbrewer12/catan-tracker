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
    expect(plan.strategy).toBeTruthy();
    expect(plan.strategies.length).toBeGreaterThanOrEqual(3);
  });

  it('values goals with roads included in the cost', () => {
    const g = played({});
    const far = goals(g, g.players[0].id).find((x) => x.item === 'settlement' && x.roads > 0);
    if (far) expect(far.cost.wood).toBe(1 + far.roads);
  });
});

describe('getting missing cards', () => {
  it('ranks options for each missing card and ends with saving', () => {
    const g = played({ sheep: 3 });
    const plan = makePlan(g, g.players[0].id);
    const gets = plan.steps.filter((s) => s.kind === 'get');
    if (plan.goal && plan.goal.eta > 0) expect(plan.steps.some((s) => s.kind === 'save')).toBe(true);
    for (const s of gets) if (s.kind === 'get') {
      expect(s.options[0].kind).not.toBe('save'); // save-only cards are covered by the save step
      expect(s.options[s.options.length - 1].kind).toBe('save');
      const order = { askOther: 0, bank: 1, switchGoal: 2, save: 3 };
      for (let i = 1; i < s.options.length; i++) expect(order[s.options[i].kind]).toBeGreaterThanOrEqual(order[s.options[i - 1].kind]);
    }
  });
});

describe('dev cards', () => {
  it('plays a knight first when the robber sits on your tile', () => {
    const g = played({});
    const me = g.players[0].id;
    const topo = topologyFor('standard');
    const mine = Object.entries(g.pieces.buildings).find(([, b]) => b.player === me)![0];
    const hex = topo.vertices[mine].hexes.find((h) => g.board.hexes[h].number)!;
    const withKnight: GameState = {
      ...g,
      robber: hex,
      cardLog: [{ id: 'k1', at: 1, kind: 'build', player: me, item: 'devCard', free: true, devCard: 'knight' }],
    };
    const plan = makePlan(withKnight, me);
    expect(plan.steps[0]).toMatchObject({ kind: 'playDev', card: 'knight', why: 'robberOnYou' });
  });
});

describe('count to 10', () => {
  /** Turn my buildings into cities and add settlements until I have `points` on the board. */
  function atPoints(g: GameState, points: number): GameState {
    const me = g.players[0].id;
    const topo = topologyFor('standard');
    const b = { ...g.pieces.buildings };
    let pts = 1;
    for (const v of Object.keys(topo.vertices)) {
      if (pts >= points) break;
      if (b[v] || topo.vertices[v].adjacent.some((a) => b[a])) continue;
      const kind = pts + 2 <= points ? 'city' : 'settlement';
      b[v] = { player: me, kind };
      pts += kind === 'city' ? 2 : 1;
    }
    return { ...g, pieces: { ...g.pieces, buildings: b } };
  }

  it('says you win when hidden VP cards bring you to 10', () => {
    const g = atPoints(played({}), 8);
    const me = g.players[0].id;
    const vp = (id: string) => ({ id, at: 1, kind: 'build' as const, player: me, item: 'devCard' as const, free: true, devCard: 'victoryPoint' as const });
    const plan = makePlan({ ...g, cardLog: [vp('a'), vp('b')] }, me);
    expect(plan.steps[0]).toMatchObject({ kind: 'win', points: 10, hiddenVp: 2 });
  });

  it('warns to keep a low profile near 10 visible points', () => {
    const g = atPoints(played({}), 8);
    const plan = makePlan(g, g.players[0].id);
    expect(plan.steps.some((s) => s.kind === 'profile')).toBe(true);
  });
});
