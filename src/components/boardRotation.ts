/**
 * How far the board picture is turned so it matches what the user sees from
 * their seat. View-only: game data never changes. Saved per device and shared
 * by every <HexBoard> on every tab.
 *
 * Drawing on the board? Text and piece shapes inside a rotated board should be
 * turned back upright: add `rotate(${-deg})` after your translate, e.g.
 *   const { deg } = useBoardRotation();
 *   <g transform={`translate(${x} ${y}) rotate(${-deg})`}>…</g>
 */
import { useSyncExternalStore } from 'react';

const KEY = 'catan-tracker:rotation';
const listeners = new Set<() => void>();

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) && n >= 0 && n < 6 ? n : 0;
  } catch {
    return 0;
  }
}

let steps = read();
const getSteps = () => steps;

export function setRotationSteps(n: number) {
  steps = ((n % 6) + 6) % 6;
  try {
    localStorage.setItem(KEY, String(steps));
  } catch {
    /* fine: rotation just won't be remembered */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** steps: 0-5 sixty-degree turns clockwise. deg: steps × 60. */
export function useBoardRotation() {
  const s = useSyncExternalStore(subscribe, getSteps, getSteps);
  return {
    steps: s,
    deg: s * 60,
    rotate: () => setRotationSteps(s + 1),
    rotateBack: () => setRotationSteps(s - 1),
    reset: () => setRotationSteps(0),
  };
}
