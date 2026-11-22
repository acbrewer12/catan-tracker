import { describe, expect, it } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { bankLeft, devCardsLeft, discardCount, handEstimates, rollPayout } from './cards';
import { reducer, type Action } from '../state/reducer';
import { newGame } from '../state/initialState';
import { syncBuilds } from '../state/slices/dice';
import type { GameState, HexId, VertexId } from './types';

const run = (s: GameState, ...as: Action[]) => as.reduce(reducer, s);
let n = 0;
const roll = (total: number): Action => ({ type: 'dice/add', roll: { id: `r${n++}`, total, at: 0 } });

/** A game with a fixed board and four players, nothing placed. */
function setup() {
  const s = newGame('standard', 4);
  s.board = randomBoard('standard', mulberry(7));
  s.robber = Object.values(s.board.hexes).find((h) => h.terrain === 'desert')!.id;
  const [me, a, b, c] = s.players.map((p) => p.id);
  return { s, me, a, b, c };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Some land corner on a hex with a number, plus that hex. */
function cornerOn(s: GameState, pred: (h: { id: HexId; number: number | null }) => boolean, skip: VertexId[] = []) {
  const topo = topologyFor(s.board.layout);
  for (const [v, info] of Object.entries(topo.vertices)) {
    if (skip.includes(v)) continue;
    const h = info.hexes.map((id) => s.board.hexes[id]).find((x) => x && pred(x));
    if (h) return { v, hex: h };
  }
  throw new Error('none');
}

describe('roll payout', () => {
  it('pays settlements 1 and cities 2, and nothing on the robber tile', () => {
    const { s, me, a } = setup();
    const { v, hex } = cornerOn(s, (h) => h.number === 8);
    const t = hex.terrain as 'wood';
    let g = run(s, { type: 'pieces/setBuilding', vertex: v, player: me, kind: 'settlement' });
    expect(rollPayout(g, 8).gains[me]?.[t]).toBeGreaterThanOrEqual(1);
    const single = rollPayout(g, 8).gains[me]![t]!;
    g = run(g, { type: 'pieces/setBuilding', vertex: v, player: me, kind: 'city' });
    expect(rollPayout(g, 8).gains[me]![t]).toBe(single * 2);
    g = run(g, { type: 'robber/move', hex: hex.id });
    expect(rollPayout(g, 8).blocked[me]?.[t]).toBeGreaterThan(0);
    expect(rollPayout(g, 8).gains[a]).toBeUndefined();
    expect(rollPayout(g, 7).gains).toEqual({});
  });

  it('nobody gets a resource the bank cannot cover for everyone', () => {
    const { s, me, a } = setup();
    const { v, hex } = cornerOn(s, (h) => h.number === 6);
    const { v: v2 } = cornerOn(s, (h) => h.id === hex.id, [v, ...topologyFor('standard').vertices[v].adjacent]);
    const g = run(
      s,
      { type: 'pieces/setBuilding', vertex: v, player: me, kind: 'settlement' },
      { type: 'pieces/setBuilding', vertex: v2, player: a, kind: 'settlement' },
    );
    const t = hex.terrain as 'wood';
    const bank = { ...{ wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 }, [t]: 1 };
    const p = rollPayout(g, 6, bank);
    expect(p.shortages).toContain(t);
    expect(p.gains[me]?.[t] ?? 0).toBe(0);
  });
});

describe('opening and builds', () => {
  it('opening placement is free and the second settlement gives starting cards', () => {
    const { s, me } = setup();
    const { v } = cornerOn(s, (h) => !!h.number);
    const { v: v2 } = cornerOn(s, (h) => !!h.number, [v, ...topologyFor('standard').vertices[v].adjacent]);
    const g = run(
      s,
      { type: 'pieces/setBuilding', vertex: v, player: me, kind: 'settlement' },
      { type: 'pieces/setBuilding', vertex: v2, player: me, kind: 'settlement' },
    );
    const total = Object.values(g.hands[me].resources).reduce((x, y) => x + y, 0);
    expect(total).toBe(topologyFor('standard').vertices[v2].hexes.filter((h) => g.board.hexes[h].terrain !== 'desert').length);
    // Removing it takes the starting cards back.
    const back = run(g, { type: 'pieces/removeBuilding', vertex: v2 });
    expect(Object.values(back.hands[me].resources).every((x) => x === 0)).toBe(true);
  });

  it('after the first roll a road costs wood + brick; moving is free, removing refunds', () => {
    const { s, me } = setup();
    const edge = Object.keys(topologyFor('standard').edges)[10];
    const edge2 = Object.keys(topologyFor('standard').edges)[20];
    let g = run(s, roll(7), { type: 'hands/set', player: me, hand: { resources: { wood: 2, brick: 1, sheep: 0, wheat: 0, ore: 0 }, unknown: 0, devCards: 0, knightsPlayed: 0 } });
    g = run(g, { type: 'pieces/setRoad', edge, player: me });
    expect(g.hands[me].resources).toMatchObject({ wood: 1, brick: 0 });
    // A move (pieces/moveRoad, added by the pieces feature) keeps the charge with the road.
    const moved = { ...g, pieces: { ...g.pieces, roads: { [edge2]: me } } };
    g = syncBuilds(g, moved, { type: 'pieces/moveRoad', from: edge, to: edge2 });
    expect(g.hands[me].resources).toMatchObject({ wood: 1, brick: 0 });
    g = run(g, { type: 'pieces/removeRoad', edge: edge2 });
    expect(g.hands[me].resources).toMatchObject({ wood: 2, brick: 1 });
  });

  it('Road Building makes the next two roads free', () => {
    const { s, me } = setup();
    const edges = Object.keys(topologyFor('standard').edges);
    let g = run(s, roll(7), { type: 'cards/log', event: { kind: 'playDev', player: me, card: 'roadBuilding' } });
    g = run(g, { type: 'pieces/setRoad', edge: edges[1], player: me }, { type: 'pieces/setRoad', edge: edges[2], player: me });
    expect(handEstimates(g)[me].missedCards).toBe(false);
    g = run(g, { type: 'pieces/setRoad', edge: edges[3], player: me });
    expect(handEstimates(g)[me].missedCards).toBe(true);
  });
});

describe('opponent estimates', () => {
  it('an unseen steal leaves a spread that a later build narrows down', () => {
    const { s, a, b } = setup();
    let g = run(
      s,
      { type: 'cards/log', event: { kind: 'gain', player: a, resources: { ore: 1, wood: 1 } } },
      { type: 'cards/log', event: { kind: 'steal', thief: b, victim: a } },
    );
    let e = handEstimates(g);
    expect(e[a].total).toBe(1);
    expect(e[b].total).toBe(1);
    expect(e[b].resources.ore.expected).toBeCloseTo(0.5);
    expect(g.hands[b].unknown).toBe(1);
    // b gets a brick, then builds a road: the stolen card must have been wood.
    g = run(
      g,
      { type: 'cards/log', event: { kind: 'gain', player: b, resources: { brick: 1 } } },
      { type: 'cards/log', event: { kind: 'build', player: b, item: 'road' } },
    );
    e = handEstimates(g);
    expect(e[b].total).toBe(0);
    expect(e[b].missedCards).toBe(false);
    // a is still uncertain (players are tracked separately).
    expect(e[a].total).toBe(1);
  });

  it('Monopoly reveals exact counts', () => {
    const { s, me, a } = setup();
    let g = run(
      s,
      { type: 'cards/log', event: { kind: 'gain', player: a, resources: { wheat: 2, sheep: 1 } } },
      { type: 'cards/log', event: { kind: 'steal', thief: me, victim: a, resource: 'sheep' } },
      { type: 'cards/log', event: { kind: 'playDev', player: me, card: 'monopoly', resource: 'wheat', taken: { [a]: 2 } } },
    );
    expect(g.hands[me].resources).toMatchObject({ wheat: 2, sheep: 1 });
    expect(g.hands[a].resources.wheat).toBe(0);
    g = run(g, { type: 'cards/log', event: { kind: 'trade', player: me, with: a, give: { wheat: 1 }, get: {} } });
    expect(g.hands[a].resources.wheat).toBe(1);
  });

  it('setTotal adds unknown cards', () => {
    const { s, a } = setup();
    const g = run(s, { type: 'cards/log', event: { kind: 'setTotal', player: a, total: 3 } });
    expect(g.hands[a].unknown).toBe(3);
  });

  it('removing a roll removes its payout', () => {
    const { s, me } = setup();
    const { v } = cornerOn(s, (h) => h.number === 9);
    let g = run(s, { type: 'pieces/setBuilding', vertex: v, player: me, kind: 'settlement' });
    const before = handEstimates(g)[me].total;
    g = run(g, roll(9));
    expect(handEstimates(g)[me].total).toBeGreaterThan(before);
    g = run(g, { type: 'dice/removeLast' });
    expect(handEstimates(g)[me].total).toBe(before);
    expect(g.diceHistory).toHaveLength(0);
  });
});

describe('misc', () => {
  it('discard rule and counts', () => {
    expect(discardCount(7)).toBe(0);
    expect(discardCount(9)).toBe(4);
    const { s, me } = setup();
    expect(devCardsLeft(s)).toBe(25);
    const g = run(s, { type: 'cards/log', event: { kind: 'build', player: me, item: 'devCard', free: true, devCard: 'knight' } });
    expect(devCardsLeft(g)).toBe(24);
    expect(handEstimates(g)[me].dev.knight).toBe(1);
    expect(bankLeft(g).ore).toBe(19);
  });
});
