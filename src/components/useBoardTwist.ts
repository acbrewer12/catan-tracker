/**
 * Turning the board by hand:
 *  - two fingers anywhere on the board: twist them like turning a real board;
 *  - one finger (or mouse) on the ⟳ handle: drag it around the board's centre.
 * A single finger on the board itself is left alone, so tapping tiles/pieces
 * and scrolling the page keep working. On release the angle snaps to SNAP°.
 * A quick tap on the handle (no drag) turns the board one SNAP step.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { SNAP, normalizeDeg, setRotation } from './boardRotation';

const angleOf = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;
const TAP_SLOP = 6; // px a handle press may move and still count as a tap

export function useBoardTwist(wrapRef: RefObject<HTMLElement | null>, savedDeg: number) {
  /** Angle while a gesture is in progress, null when idle. */
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const update = (d: number | null) => {
    liveRef.current = d;
    setLive(d);
  };
  const savedRef = useRef(savedDeg);
  savedRef.current = savedDeg;

  // Two-finger twist. Native listeners so we can preventDefault (non-passive)
  // and stop the browser pinch-zooming while the user turns the board.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let start: { touch: number; deg: number } | null = null;
    const twoFingerAngle = (t: TouchList) => angleOf(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        start = { touch: twoFingerAngle(e.touches), deg: liveRef.current ?? savedRef.current };
        e.preventDefault();
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      update(start.deg + (twoFingerAngle(e.touches) - start.touch));
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      start = null;
      if (liveRef.current !== null) setRotation(liveRef.current);
      update(null);
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [wrapRef]);

  // Handle drag around the board centre (works with touch and mouse).
  const handle = useRef<{ id: number; x: number; y: number; start: number; deg: number; moved: boolean } | null>(null);
  const centre = () => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const handleProps = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const c = centre();
      handle.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: angleOf(e.clientX - c.x, e.clientY - c.y), deg: savedRef.current, moved: false };
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const h = handle.current;
      if (!h || h.id !== e.pointerId) return;
      if (!h.moved && Math.hypot(e.clientX - h.x, e.clientY - h.y) < TAP_SLOP) return;
      h.moved = true;
      const c = centre();
      update(h.deg + angleOf(e.clientX - c.x, e.clientY - c.y) - h.start);
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const h = handle.current;
      if (!h || h.id !== e.pointerId) return;
      handle.current = null;
      setRotation(h.moved && liveRef.current !== null ? liveRef.current : savedRef.current + SNAP);
      update(null);
    },
    onPointerCancel() {
      handle.current = null;
      update(null);
    },
  };

  return { liveDeg: live === null ? null : normalizeDeg(live), handleProps };
}
