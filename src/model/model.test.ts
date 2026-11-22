import { describe, expect, it } from 'vitest';
import { defaultPortEdges, desertHex, emptyBoard, pips, portAtVertex, randomBoard, topologyFor, validateBoard, vertexPips } from './board';
import { hexCornerIds } from './geometry';
import { LAYOUTS } from './layouts';
import { reducer } from '../state/reducer';
import { newGame } from '../state/initialState';

describe('topology', () => {
  it('standard board has 19 hexes, 54 corners, 72 edges, 30 coastal edges', () => {
    const t = topologyFor('standard');
    expect(t.hexes).toHaveLength(19);
    expect(Object.keys(t.vertices)).toHaveLength(54);
    expect(Object.keys(t.edges)).toHaveLength(72);
    expect(t.coast).toHaveLength(30);
  });
  it('extended board has 30 hexes, 80 corners, 109 edges', () => {
    const t = topologyFor('extended');
    expect(t.hexes).toHaveLength(30);
    expect(Object.keys(t.vertices)).toHaveLength(80);
    expect(Object.keys(t.edges)).toHaveLength(109);
  });
  it('centre hex corners each touch 3 land hexes and 3 other corners', () => {
    const t = topologyFor('standard');
    for (const v of hexCornerIds('0,0')) {
      expect(t.vertices[v].hexes).toHaveLength(3);
      expect(t.vertices[v].adjacent).toHaveLength(3);
    }
  });
  it('each edge joins two adjacent corners', () => {
    const t = topologyFor('standard');
    for (const e of Object.values(t.edges)) {
      const [a, b] = e.vertices;
      const pa = t.vertices[a];
      const pb = t.vertices[b];
      expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeCloseTo(1, 5);
    }
  });
});

describe('board', () => {
  it('pips', () => {
    expect([2, 6, 7, 8, 12].map(pips)).toEqual([1, 5, 6, 5, 1]);
  });
  it('random boards are complete and valid', () => {
    for (const layout of ['standard', 'extended'] as const) {
      const b = randomBoard(layout);
      const errs = validateBoard(b);
      expect(errs).toEqual([]);
      expect(b.ports).toHaveLength(Object.values(LAYOUTS[layout].ports).reduce((a, c) => a + c, 0));
      expect(desertHex(b)).not.toBeNull();
    }
  });
  it('empty board reports missing tiles', () => {
    expect(validateBoard(emptyBoard()).some((p) => p.code === 'missing-terrain')).toBe(true);
  });
  it('default harbors are distinct coastal edges', () => {
    const edges = defaultPortEdges('standard');
    expect(new Set(edges).size).toBe(9);
  });
  it('corner helpers', () => {
    const b = randomBoard('standard');
    const t = topologyFor('standard');
    const v = hexCornerIds('0,0')[0];
    expect(vertexPips(b, v)).toBe(t.vertices[v].hexes.reduce((s, h) => s + pips(b.hexes[h].number), 0));
    const port = b.ports[0];
    expect(portAtVertex(b, t.edges[port.edge].vertices[0])).toEqual(port);
  });
});

describe('reducer', () => {
  it('desert keeps the robber during setup and clears its number', () => {
    let s = newGame();
    s = reducer(s, { type: 'board/setNumber', hex: '0,0', number: 8 });
    s = reducer(s, { type: 'board/setTerrain', hex: '0,0', terrain: 'desert' });
    expect(s.robber).toBe('0,0');
    expect(s.board.hexes['0,0'].number).toBeNull();
  });
  it('rejects 7 as a token', () => {
    const s = newGame();
    expect(reducer(s, { type: 'board/setNumber', hex: '0,0', number: 7 })).toBe(s);
  });
  it('one player is always me', () => {
    let s = newGame();
    const me = s.players.find((p) => p.isMe)!;
    s = reducer(s, { type: 'players/remove', id: me.id });
    expect(s.players.filter((p) => p.isMe)).toHaveLength(1);
    expect(Object.keys(s.hands)).toHaveLength(3);
  });
});
