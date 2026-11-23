import { describe, expect, it } from 'vitest';
import { randomBoard, desertHex } from './board';
import { legalRoadSpots, legalSettlementSpots, openingTurn } from './pieces';
import { suggestDiscard } from './discard';
import { COST } from './cards';
import type { Goal } from './goals';
import { RESOURCES } from './types';
import { emptyResources, type GameState, type ResourceCounts } from './types';
import { newGame } from '../state/initialState';
import { reducer } from '../state/reducer';

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function game(hands: Record<number, Partial<ResourceCounts>>): GameState {
  const rnd = mulberry(7);
  let s = newGame('standard', 4);
  s = { ...s, board: randomBoard('standard', rnd) };
  s = { ...s, robber: desertHex(s.board), players: s.players.map((p, i) => ({ ...p, isMe: i === 0 })) };
  for (let k = 0; k < 16; k++) {
    const t = openingTurn(s);
    if (!t) break;
    if (t.place === 'settlement') {
      const v = legalSettlementSpots(s, t.player);
      s = reducer(s, { type: 'pieces/setBuilding', vertex: v[Math.floor(rnd() * v.length)], player: t.player, kind: 'settlement' });
    } else s = reducer(s, { type: 'pieces/setRoad', edge: legalRoadSpots(s, t.player)[0], player: t.player });
  }
  s.players.forEach((p, i) => {
    s = reducer(s, { type: 'cards/log', event: { kind: 'set', player: p.id, resources: { ...emptyResources(), ...hands[i] } } });
  });
  return s;
}

const sum = (c: ResourceCounts) => RESOURCES.reduce((a, r) => a + c[r], 0);
const cityGoal = { item: 'city', cost: { ...emptyResources(), ...COST.city } } as unknown as Goal;

describe('suggestDiscard', () => {
  it('needs no discard at 7 cards or fewer', () => {
    const s = game({ 0: { wood: 3, brick: 4 } });
    expect(suggestDiscard(s, s.players[0].id)).toBeNull();
  });

  it('drops exactly half, rounded down, from cards you hold', () => {
    const s = game({ 0: { wood: 3, brick: 2, sheep: 3, wheat: 1, ore: 2 } });
    const a = suggestDiscard(s, s.players[0].id)!;
    expect(a.count).toBe(5);
    expect(sum(a.discard)).toBe(5);
    const hand = s.hands[s.players[0].id].resources;
    for (const r of RESOURCES) expect(a.discard[r]).toBeLessThanOrEqual(hand[r]);
  });

  it('keeps the cards for the goal and drops the surplus', () => {
    const s = game({ 0: { wheat: 2, ore: 3, sheep: 3, wood: 1 } });
    const a = suggestDiscard(s, s.players[0].id, cityGoal)!;
    expect(a.count).toBe(4);
    expect(a.discard.wheat + a.discard.ore).toBe(0);
    expect(a.keptForGoal.wheat).toBe(2);
    expect(a.keptForGoal.ore).toBe(3);
  });

  it('spreads the discard rather than wiping out one spare resource', () => {
    const s = game({ 0: { wheat: 2, ore: 3, sheep: 2, wood: 2, brick: 2 } });
    const a = suggestDiscard(s, s.players[0].id, cityGoal)!;
    expect(a.count).toBe(5);
    expect(a.discard.wheat + a.discard.ore).toBe(0);
    expect(Math.max(a.discard.sheep, a.discard.wood, a.discard.brick)).toBeLessThanOrEqual(2);
  });

  it('works with the plan goal when none is given', () => {
    const s = game({ 0: { wood: 4, brick: 4, sheep: 4 } });
    const a = suggestDiscard(s, s.players[0].id)!;
    expect(sum(a.discard)).toBe(6);
  });
});
