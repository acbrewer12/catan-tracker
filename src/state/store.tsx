/**
 * App-wide store: one GameState in React context, saved to localStorage on
 * every change, with undo. Components use `useGame()`:
 *
 *   const { state, dispatch, undo, canUndo } = useGame();
 *   dispatch({ type: 'board/setNumber', hex: '0,0', number: 8 });
 */
import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from 'react';
import type { GameState } from '../model/types';
import { newGame } from './initialState';
import { reducer, type Action } from './reducer';

const STORAGE_KEY = 'catan-tracker:game';
const UNDO_LIMIT = 100;

export function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return migrate(s);
  } catch {
    return null;
  }
}

/** Upgrade older saves. Bump GameState.version and add a step here when the shape changes. */
export function migrate(s: GameState): GameState | null {
  if (!s || typeof s !== 'object' || s.version !== 1) return null;
  return s;
}

interface History {
  past: GameState[];
  present: GameState;
}

type HistoryAction = Action | { type: 'meta/undo' };

function historyReducer(h: History, a: HistoryAction): History {
  if (a.type === 'meta/undo') {
    if (!h.past.length) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1] };
  }
  const next = reducer(h.present, a);
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-UNDO_LIMIT), present: next };
}

interface Ctx {
  state: GameState;
  dispatch: (a: Action) => void;
  undo: () => void;
  canUndo: boolean;
}

const GameContext = createContext<Ctx | null>(null);

export function GameProvider({ children, initial }: { children: ReactNode; initial?: GameState }) {
  const [h, send] = useReducer(historyReducer, undefined, () => ({ past: [], present: initial ?? loadSaved() ?? newGame() }));
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(h.present));
    } catch {
      /* storage full or blocked: keep going in memory */
    }
  }, [h.present]);
  const undo = useCallback(() => send({ type: 'meta/undo' }), []);
  return (
    <GameContext.Provider value={{ state: h.present, dispatch: send, undo, canUndo: h.past.length > 0 }}>{children}</GameContext.Provider>
  );
}

export function useGame(): Ctx {
  const c = useContext(GameContext);
  if (!c) throw new Error('useGame must be used inside <GameProvider>');
  return c;
}
