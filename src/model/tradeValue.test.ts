import { describe, expect, it } from 'vitest';
import { randomBoard, desertHex, topologyFor } from './board';
import { legalRoadSpots, legalSettlementSpots, openingTurn } from './pieces';
import { evaluateTrade, likelyHas, publicHand, visiblePoints } from './tradeValue';
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

/** Give `p` extra cities on open corners until they reach `points`. */
function boost(s: GameState, i: number, points: number): GameState {
  const p = s.players[i].id;
  const topo = topologyFor(s.board.layout);
  const buildings = { ...s.pieces.buildings };
  for (const [v, b] of Object.entries(buildings)) if (b.player === p) buildings[v] = { player: p, kind: 'city' };
  let out: GameState = { ...s, pieces: { ...s.pieces, buildings } };
  for (const v of Object.keys(topo.vertices)) {
    if (visiblePoints(out, p) >= points) break;
    if (out.pieces.buildings[v] || topo.vertices[v].adjacent.some((a) => out.pieces.buildings[a])) continue;
    out = { ...out, pieces: { ...out.pieces, buildings: { ...out.pieces.buildings, [v]: { player: p, kind: visiblePoints(out, p) + 2 <= points ? 'city' : 'settlement' } } } };
  }
  return out;
}

describe('public information only', () => {
  it("guesses an opponent's hand from their card count, not their real cards", () => {
    const s = game({ 1: { ore: 4 } });
    const guess = publicHand(s, s.players[1].id, s.players[0].id);
    const sum = Object.values(guess).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(4);
    // Same guess no matter which 4 cards they really hold.
    const s2 = game({ 1: { wood: 4 } });
    expect(publicHand(s2, s2.players[1].id, s2.players[0].id)).toEqual(guess);
  });

  it('nobody likely holds anything with no cards', () => {
    const s = game({});
    expect(likelyHas(s, s.players[1].id, 'wheat')).toBe(0);
  });
});

describe('evaluateTrade', () => {
  it('refuses to help a player close to winning', () => {
    let s = game({ 0: { sheep: 3, wood: 1 }, 1: { wheat: 2, ore: 2 } });
    s = boost(s, 1, 8);
    const e = evaluateTrade(s, s.players[0].id, s.players[1].id, { sheep: 1 }, { wheat: 1 }, 'Blue');
    expect(e.theirs.points).toBeGreaterThanOrEqual(7);
    if (e.theirs.roundsSaved > 0.2 || e.theirs.enablesNow) expect(e.verdict).toBe('dangerous');
  });

  it('turns down giving away cards your own build needs', () => {
    const s = game({ 0: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, 1: { ore: 3 } });
    const e = evaluateTrade(s, s.players[0].id, s.players[1].id, { wheat: 1 }, { ore: 1 });
    expect(e.verdict).not.toBe('good');
  });

  it('likes a trade that completes your build and barely helps them', () => {
    const s = game({ 0: { wood: 1, brick: 1, sheep: 3 }, 1: { wheat: 3 } });
    const e = evaluateTrade(s, s.players[0].id, s.players[1].id, { sheep: 1 }, { wheat: 1 });
    expect(e.mine.roundsSaved + (e.mine.enablesNow ? 1 : 0)).toBeGreaterThan(0);
    expect(e.verdict).toBe('good');
  });
});
