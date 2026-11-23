/**
 * Saved games on this device (localStorage), and what the planner learned
 * from them. Components use `useArchive()`. The provider also hands the
 * learning to the planner (model/learning.ts) before its children render.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  archiveGame,
  emptyArchive,
  exportArchive,
  learningOf,
  mergeArchives,
  parseArchive,
  removeGame,
  type Archive,
  type ArchiveSettings,
} from '../model/archive';
import { setActiveLearning, type Learning } from '../model/learning';
import type { GameState, PlayerId } from '../model/types';

const ARCHIVE_KEY = 'catan-tracker:archive';

function loadArchive(): Archive {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    return (raw && parseArchive(JSON.parse(raw))) || emptyArchive();
  } catch {
    return emptyArchive();
  }
}

interface ArchiveCtx {
  archive: Archive;
  /** Learned from saved games (null until there are enough), whether or not it's switched on. */
  learning: Learning | null;
  /** Set when the last save to storage failed (usually full). */
  storageError: string | null;
  save: (state: GameState, winner: PlayerId | null, finished: boolean) => void;
  remove: (id: string) => void;
  setSettings: (s: Partial<ArchiveSettings>) => void;
  /** Merge games from an exported file. Returns how many were new, or an error. */
  importText: (text: string) => { added: number } | { error: string };
  exportText: () => string;
}

const Ctx = createContext<ArchiveCtx | null>(null);

export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [archive, setArchive] = useState<Archive>(loadArchive);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(ARCHIVE_KEY, exportArchive(archive));
      setStorageError(null);
    } catch {
      setStorageError('This phone is out of storage for saved games. Export a backup, then delete some old games.');
    }
  }, [archive]);

  const learning = useMemo(() => learningOf(archive), [archive]);
  // Hand it to the planner now, so the screens below render with it.
  setActiveLearning(archive.settings.learn ? learning : null);

  const save = useCallback((state: GameState, winner: PlayerId | null, finished: boolean) => setArchive((a) => archiveGame(a, state, winner, finished)), []);
  const remove = useCallback((id: string) => setArchive((a) => removeGame(a, id)), []);
  const setSettings = useCallback((s: Partial<ArchiveSettings>) => setArchive((a) => ({ ...a, settings: { ...a.settings, ...s } })), []);
  const importText = useCallback(
    (text: string) => {
      let parsed: Archive | null = null;
      try {
        parsed = parseArchive(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (!parsed) return { error: "That file isn't a Catan Tracker backup." };
      const { archive: merged, added } = mergeArchives(archive, parsed);
      setArchive(merged);
      return { added };
    },
    [archive],
  );
  const exportText = useCallback(() => exportArchive(archive), [archive]);

  return <Ctx.Provider value={{ archive, learning, storageError, save, remove, setSettings, importText, exportText }}>{children}</Ctx.Provider>;
}

export function useArchive(): ArchiveCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useArchive must be used inside <ArchiveProvider>');
  return c;
}
