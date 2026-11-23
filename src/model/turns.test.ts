import { describe, expect, it } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { currentTurn, eventsSince, nextPlayer } from './turns';
import { turnOrder } from './pieces';
import type { GameState } from './types';
import { newGame } from '../state/initialState';
import { reducer, type Action } from '../state/reducer';

const run = (s: GameState, ...a: Action[]) => a.reduce(reducer, s);
function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function game(): GameState {
  return { ...newGame('standard', 3), board: randomBoard('standard', mulberry(1)) };
}
const roll = (id: string, total: number, player?: string): Action => ({ type: 'dice/add', roll: { id, total, player, at: 1 } });

describe('currentTurn', () => {
  it('starts with the opening round, first player placing a settlement', () => {
    const s = game();
    const t = currentTurn(s, null);
    expect(t).toEqual({ stage: 'opening', player: turnOrder(s)[0], place: 'settlement' });
  });

  it('asks the first player to roll once the opening is done', () => {
    let s = game();
    const topo = topologyFor('standard');
    // Fake a finished opening: every player has 2 settlements and 2 roads.
    const verts = Object.keys(topo.vertices);
    const edges = Object.keys(topo.edges);
    s.players.forEach((p, i) => {
      s = { ...s, pieces: { buildings: { ...s.pieces.buildings, [verts[i * 10]]: { player: p.id, kind: 'settlement' }, [verts[i * 10 + 5]]: { player: p.id, kind: 'settlement' } }, roads: { ...s.pieces.roads, [edges[i * 10]]: p.id, [edges[i * 10 + 5]]: p.id } } };
    });
    expect(currentTurn(s, null)).toEqual({ stage: 'roll', player: turnOrder(s)[0] });
  });

  it('acts after a roll, then moves to the next player when the turn ends', () => {
    const s0 = game();
    const [a, b, c] = turnOrder(s0);
    const s = run(s0, roll('r1', 8, a));
    const t = currentTurn(s, null);
    expect(t.stage).toBe('act');
    expect('player' in t && t.player).toBe(a);
    expect(currentTurn(s, 'r1')).toEqual({ stage: 'roll', player: b });
    expect(nextPlayer(s, c)).toBe(a);
  });

  it('falls back to turn order for rolls without a roller', () => {
    const s0 = game();
    const [, b, c] = turnOrder(s0);
    const s = run(s0, roll('r1', 8), roll('r2', 9));
    expect(currentTurn(s, 'r2')).toEqual({ stage: 'roll', player: c });
    expect('player' in currentTurn(s, null) && currentTurn(s, null)).toMatchObject({ player: b });
  });
});

describe('eventsSince', () => {
  it('lists what happened after the roll, not its payout', () => {
    const s0 = game();
    const [a, b] = turnOrder(s0);
    let s = run(s0, roll('r1', 8, a));
    s = run(s, { type: 'cards/log', event: { kind: 'trade', player: a, with: b, give: { wood: 1 }, get: { ore: 1 } } });
    const ev = eventsSince(s, s.diceHistory[0]);
    expect(ev.map((e) => e.kind)).toEqual(['trade']);
  });
});
