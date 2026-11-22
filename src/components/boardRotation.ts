/**
 * How far the board picture is turned so it matches what the user sees from
 * their seat. View-only: game data never changes. Saved per device and shared
 * by every <HexBoard> on every tab. The user turns it by dragging (see
 * useBoardTwist.ts); it settles on the nearest SNAP degrees when let go.
 *
 * Drawing on the board? Text and piece shapes inside a rotated board should be
 * turned back upright: add `rotate(${-deg})` after your translate, e.g.
 *   const { deg } = useBoardRotation();
 *   <g transform={`translate(${x} ${y}) rotate(${-deg})`}>…</g>
 * While a drag is in progress HexBoard draws with the live angle; children that
 * use useBoardRotation() catch up on release, which is fine for upright labels.
 */
import { useSyncExternalStore } from 'react';

export const SNAP = 30;
const KEY = 'catan-tracker:rotation-deg';
const listeners = new Set<() => void>();

export const normalizeDeg = (d: number) => ((d % 360) + 360) % 360;
export const snapDeg = (d: number) => normalizeDeg(Math.round(d / SNAP) * SNAP);

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) ? snapDeg(n) : 0;
  } catch {
    return 0;
  }
}

let current = read();
const get = () => current;

/** Save a new angle (snapped). */
export function setRotation(deg: number) {
  current = snapDeg(deg);
  try {
    localStorage.setItem(KEY, String(current));
  } catch {
    /* fine: rotation just won't be remembered */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** deg: saved angle, clockwise, a multiple of SNAP in [0, 360). */
export function useBoardRotation() {
  const deg = useSyncExternalStore(subscribe, get, get);
  return { deg, setRotation, reset: () => setRotation(0) };
}
