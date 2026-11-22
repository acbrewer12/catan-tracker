import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { setRotationSteps } from './boardRotation';
import { HexBoard } from './HexBoard';
import { randomBoard } from '../model/board';

describe('board rotation', () => {
  it('wraps around in 60° steps and turns the board, not the data', () => {
    const board = randomBoard('standard');
    const before = JSON.stringify(board);
    setRotationSteps(7);
    const html = renderToString(createElement(HexBoard, { board }));
    expect(html).toContain('rotate(60 ');
    expect(html).toContain('rotate(-60)');
    setRotationSteps(-1);
    expect(renderToString(createElement(HexBoard, { board }))).toContain('rotate(300 ');
    setRotationSteps(0);
    expect(JSON.stringify(board)).toBe(before);
  });
});
