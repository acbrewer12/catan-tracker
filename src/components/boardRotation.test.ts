import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { setRotation, snapDeg } from './boardRotation';
import { HexBoard } from './HexBoard';
import { randomBoard } from '../model/board';

describe('board rotation', () => {
  it('snaps to 30° steps and wraps around', () => {
    expect(snapDeg(14)).toBe(0);
    expect(snapDeg(16)).toBe(30);
    expect(snapDeg(-20)).toBe(330);
    expect(snapDeg(400)).toBe(30);
  });
  it('turns the picture, not the game data', () => {
    const board = randomBoard('standard');
    const before = JSON.stringify(board);
    setRotation(62);
    const html = renderToString(createElement(HexBoard, { board }));
    expect(html).toContain('rotate(60 ');
    expect(html).toContain('rotate(-60)');
    setRotation(0);
    expect(JSON.stringify(board)).toBe(before);
  });
});
