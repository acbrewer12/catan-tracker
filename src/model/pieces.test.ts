import { describe, expect, it } from 'vitest';
import { randomBoard, topologyFor } from './board';
import { hexCornerIds, hexEdgeIds } from './geometry';
import {
  boardPoints,
  buildingsOnHex,
  checkBuilding,
  checkRoad,
  legalSettlementSpots,
  longestRoad,
  longestRoadHolder,
  firstPlayer,
  turnOrder,
  openingSequence,
  openingTurn,
  piecesLeft,
  robberVictims,
} from './pieces';
import type { GameState } from './types';
import { reducer } from '../state/reducer';
import { newGame } from '../state/initialState';
import type { Action } from '../state/reducer';

function game(players = 4): GameState {
  const s = newGame('standard', players);
  return { ...s, board: randomBoard('standard', mulberry(1)) };
}
function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const run = (s: GameState, ...actions: Action[]) => actions.reduce(reducer, s);
const topo = topologyFor('standard');
/** Corners of the centre hex, in order around it: consecutive ones share an edge. */
const C = hexCornerIds('0,0');
/** Edge between corner i and corner i+1 of the centre hex. */
const edgeBetween = (a: string, b: string) => Object.values(topo.edges).find((e) => e.vertices.includes(a) && e.vertices.includes(b))!.id;

describe('settlement rules', () => {
  it('first two settlements need no road, but must respect distance', () => {
    let s = game();
    const [a, b] = s.players.map((p) => p.id);
    expect(checkBuilding(s, C[0], a, 'settlement')).toEqual([]);
    s = run(s, { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'settlement' });
    expect(checkBuilding(s, C[0], b, 'settlement').map((p) => p.code)).toContain('occupied');
    expect(checkBuilding(s, C[1], b, 'settlement').map((p) => p.code)).toEqual(['too-close']);
    expect(checkBuilding(s, C[2], b, 'settlement')).toEqual([]);
  });

  it('third settlement must touch own road', () => {
    let s = game();
    const a = s.players[0].id;
    const far = Object.keys(topo.vertices).find((v) => !topo.vertices[v].hexes.includes('0,0') && checkBuilding(s, v, a, 'settlement').length === 0)!;
    s = run(
      s,
      { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'settlement' },
      { type: 'pieces/setBuilding', vertex: far, player: a, kind: 'settlement' },
    );
    expect(checkBuilding(s, C[2], a, 'settlement').map((p) => p.code)).toEqual(['not-connected']);
    s = run(s, { type: 'pieces/setRoad', edge: edgeBetween(C[0], C[1]), player: a }, { type: 'pieces/setRoad', edge: edgeBetween(C[1], C[2]), player: a });
    expect(checkBuilding(s, C[2], a, 'settlement')).toEqual([]);
  });

  it('city needs own settlement and respects the 4-city limit', () => {
    let s = game();
    const [a, b] = s.players.map((p) => p.id);
    s = run(s, { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'settlement' });
    expect(checkBuilding(s, C[0], a, 'city')).toEqual([]);
    expect(checkBuilding(s, C[0], b, 'city').map((p) => p.code)).toEqual(['not-own']);
    expect(checkBuilding(s, C[2], a, 'city').map((p) => p.code)).toEqual(['needs-settlement']);
  });

  it('settlement limit is 5', () => {
    let s = game();
    const a = s.players[0].id;
    const spots: string[] = [];
    for (const v of Object.keys(topo.vertices)) {
      if (spots.length === 5) break;
      if (spots.every((o) => o !== v && !topo.vertices[o].adjacent.includes(v))) spots.push(v);
    }
    s = run(s, ...spots.map((vertex): Action => ({ type: 'pieces/setBuilding', vertex, player: a, kind: 'settlement' })));
    expect(piecesLeft(s, a).settlement).toBe(0);
    const legal = legalSettlementSpots(s, a);
    expect(legal).toEqual([]);
  });
});

describe('road rules', () => {
  it('road must connect to own building or road, not through an opponent', () => {
    let s = game();
    const [a, b] = s.players.map((p) => p.id);
    const e01 = edgeBetween(C[0], C[1]);
    const e12 = edgeBetween(C[1], C[2]);
    expect(checkRoad(s, e01, a).map((p) => p.code)).toEqual(['not-connected']);
    s = run(s, { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'settlement' });
    expect(checkRoad(s, e01, a)).toEqual([]);
    s = run(s, { type: 'pieces/setRoad', edge: e01, player: a });
    expect(checkRoad(s, e12, a)).toEqual([]);
    // Opponent settles on C[1]: A can no longer extend through it.
    s = run(s, { type: 'pieces/setBuilding', vertex: C[1], player: b, kind: 'settlement' });
    expect(checkRoad(s, e12, a).map((p) => p.code)).toEqual(['not-connected']);
    expect(checkRoad(s, e01, b).map((p) => p.code)).toEqual(['occupied']);
  });
});

describe('robber and production', () => {
  it('lists buildings and victims on a hex', () => {
    let s = game();
    const [a, b, c] = s.players.map((p) => p.id);
    s = run(
      s,
      { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'city' },
      { type: 'pieces/setBuilding', vertex: C[2], player: b, kind: 'settlement' },
      { type: 'pieces/setBuilding', vertex: C[4], player: c, kind: 'settlement' },
    );
    expect(buildingsOnHex(s, '0,0')).toHaveLength(3);
    expect(robberVictims(s, '0,0', a)).toEqual([b, c]);
  });

  it('robber/move ignores sea and same hex', () => {
    let s = game();
    s = run(s, { type: 'robber/move', hex: '0,0' });
    expect(s.robber).toBe('0,0');
    expect(run(s, { type: 'robber/move', hex: '0,0' })).toBe(s);
    expect(run(s, { type: 'robber/move', hex: '9,9' })).toBe(s);
  });
});

describe('moves and removal', () => {
  it('moveBuilding and moveRoad relocate a piece', () => {
    let s = game();
    const a = s.players[0].id;
    s = run(s, { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'settlement' }, { type: 'pieces/moveBuilding', from: C[0], to: C[3] });
    expect(s.pieces.buildings[C[0]]).toBeUndefined();
    expect(s.pieces.buildings[C[3]]).toEqual({ player: a, kind: 'settlement' });
    const [e0, e1] = hexEdgeIds('0,0');
    s = run(s, { type: 'pieces/setRoad', edge: e0, player: a }, { type: 'pieces/moveRoad', from: e0, to: e1 });
    expect(s.pieces.roads).toEqual({ [e1]: a });
  });

  it('removing a player removes their pieces', () => {
    let s = game();
    const [a, b] = s.players.map((p) => p.id);
    s = run(s, { type: 'pieces/setBuilding', vertex: C[0], player: a, kind: 'settlement' }, { type: 'pieces/setBuilding', vertex: C[3], player: b, kind: 'settlement' });
    s = run(s, { type: 'players/remove', id: b });
    expect(Object.keys(s.pieces.buildings)).toEqual([C[0]]);
  });
});

describe('longest road', () => {
  it('counts a ring of 6 around a hex, and an opponent building breaks it', () => {
    let s = game();
    const [a, b] = s.players.map((p) => p.id);
    s = run(s, ...C.map((v, i): Action => ({ type: 'pieces/setRoad', edge: edgeBetween(v, C[(i + 1) % 6]), player: a })));
    expect(longestRoad(s, a)).toBe(6);
    expect(longestRoadHolder(s)).toBe(a);
    expect(boardPoints(s, a)).toBe(2);
    s = run(s, { type: 'pieces/setBuilding', vertex: C[0], player: b, kind: 'settlement' });
    // Ring broken at C[0]: one path of 6 roads from C[0] round to C[0], but it can't pass through.
    expect(longestRoad(s, a)).toBe(6);
    s = run(s, { type: 'pieces/setBuilding', vertex: C[3], player: b, kind: 'settlement' });
    expect(longestRoad(s, a)).toBe(3);
    expect(longestRoadHolder(s)).toBeNull();
  });
});

describe('opening order', () => {
  it('snakes 1..N then N..1', () => {
    let s = game(3);
    const ids = s.players.map((p) => p.id);
    const order: string[] = [];
    const spots = legalSettlementSpots(s, ids[0]);
    for (let guard = 0; guard < 20; guard++) {
      const t = openingTurn(s);
      if (!t) break;
      if (t.place === 'settlement') {
        order.push(t.player);
        const v = spots.find((x) => checkBuilding(s, x, t.player, 'settlement').length === 0)!;
        s = run(s, { type: 'pieces/setBuilding', vertex: v, player: t.player, kind: 'settlement' });
      } else {
        const own = Object.entries(s.pieces.buildings).filter(([, b]) => b.player === t.player).map(([v]) => v);
        const e = own.flatMap((v) => topo.vertices[v].edges).find((x) => checkRoad(s, x, t.player).length === 0)!;
        s = run(s, { type: 'pieces/setRoad', edge: e, player: t.player });
      }
    }
    expect(order).toEqual([ids[0], ids[1], ids[2], ids[2], ids[1], ids[0]]);
    expect(openingTurn(s)).toBeNull();
  });
});

describe('who goes first', () => {
  it('defaults to the top of the player list', () => {
    const s = game(3);
    const ids = s.players.map((p) => p.id);
    expect(firstPlayer(s)).toEqual({ decided: true, player: ids[0] });
    expect(openingSequence(s)).toEqual([ids[0], ids[1], ids[2], ids[2], ids[1], ids[0]]);
  });

  it('oldest first: opening by age and back, then clockwise from the oldest', () => {
    let s = game(4);
    const [a, b, c, d] = s.players.map((p) => p.id); // seating order, clockwise
    s = run(s, { type: 'game/setRules', rules: { ageOrder: [c, a, d, b] } });
    expect(firstPlayer(s)).toEqual({ decided: true, player: c });
    expect(openingSequence(s)).toEqual([c, a, d, b, b, d, a, c]);
    expect(turnOrder(s)).toEqual([c, d, a, b]);
    expect(openingTurn(s)).toEqual({ player: c, place: 'settlement' });
  });

  it('unranked or removed players fall back to seating order', () => {
    let s = game(4);
    const [a, b, c, d] = s.players.map((p) => p.id);
    s = run(s, { type: 'game/setRules', rules: { ageOrder: [d, 'gone'] } });
    expect(openingSequence(s).slice(0, 4)).toEqual([d, a, b, c]);
  });

  it('highest roll goes first, ties re-roll, then round the table and back', () => {
    let s = game(4);
    const [a, b, c, d] = s.players.map((p) => p.id);
    s = run(s, { type: 'game/setRules', rules: { firstPlayerBy: 'dice' } });
    expect(firstPlayer(s)).toEqual({ decided: false, waiting: [a, b, c, d], tied: [] });
    s = run(
      s,
      { type: 'game/addStartRoll', player: a, total: 5 },
      { type: 'game/addStartRoll', player: b, total: 10 },
      { type: 'game/addStartRoll', player: c, total: 10 },
      { type: 'game/addStartRoll', player: d, total: 7 },
    );
    expect(firstPlayer(s)).toEqual({ decided: false, waiting: [b, c], tied: [b, c] });
    s = run(s, { type: 'game/addStartRoll', player: b, total: 4 }, { type: 'game/addStartRoll', player: c, total: 9 });
    expect(firstPlayer(s)).toEqual({ decided: true, player: c });
    expect(openingSequence(s)).toEqual([c, d, a, b, b, a, d, c]);
    expect(openingTurn(s)).toEqual({ player: c, place: 'settlement' });
    s = run(s, { type: 'game/clearStartRolls' });
    expect(firstPlayer(s).decided).toBe(false);
  });
});
