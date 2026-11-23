import { describe, expect, it } from 'vitest';
import { randomBoard, desertHex } from './board';
import { legalRoadSpots, legalSettlementSpots, openingTurn } from './pieces';
import { askBackups, judgeOffer } from './tradeOffer';
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

/** A game after the opening, with the given hands set exactly. */
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

describe('judgeOffer', () => {
  it("can't give cards you don't hold", () => {
    const s = game({ 0: { wood: 1 }, 1: { ore: 3 } });
    expect(judgeOffer(s, s.players[0].id, s.players[1].id, { brick: 1 }, { ore: 1 }).verdict).toBe('cantAfford');
  });

  it('accepts a generous offer and declines a lopsided one', () => {
    const s = game({ 0: { wood: 1, brick: 1, sheep: 3 }, 1: { wheat: 3, ore: 3, sheep: 1 } });
    const [me, them] = [s.players[0].id, s.players[1].id];
    // They give a wheat (the settlement needs it) for one spare sheep.
    expect(judgeOffer(s, me, them, { sheep: 1 }, { wheat: 1 }).verdict).toBe('accept');
    // Giving away the wood and brick the settlement needs for one ore they have spare.
    const bad = judgeOffer(s, me, them, { wood: 1, brick: 1 }, { ore: 1 });
    expect(bad.verdict).toBe('decline');
  });
});

describe('askBackups', () => {
  it('skips players who said no, and falls back to the bank and saving', () => {
    const s = game({ 0: { sheep: 4 }, 1: { wheat: 2 }, 2: { wheat: 1 } });
    const [me, a] = s.players.map((p) => p.id);
    const out = askBackups(s, me, 'wheat', [a]);
    expect(out.some((o) => o.kind === 'askOther' && o.partner === a)).toBe(false);
    expect(out[out.length - 1].kind).toBe('save');
    const everyone = s.players.slice(1).map((p) => p.id);
    expect(askBackups(s, me, 'wheat', everyone).filter((o) => o.kind === 'askOther')).toHaveLength(0);
  });
});
