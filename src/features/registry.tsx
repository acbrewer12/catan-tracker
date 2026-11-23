/**
 * The app's screens. Each feature thread adds its screen here (one entry) and
 * keeps everything else inside its own features/<name>/ folder.
 */
import type { ReactNode } from 'react';
import { BoardInput } from './board-input/BoardInput';
import { PlayersSetup } from './players/PlayersSetup';
import { DiceScreen } from './dice/DiceScreen';
import { PiecesScreen } from './pieces/PiecesScreen';
import { Tips } from './tips/Tips';
import { PlayScreen } from './play/PlayScreen';

export interface Screen {
  id: string;
  label: string;
  icon: string;
  render: (go: (id: string) => void) => ReactNode;
}

export const SCREENS: Screen[] = [
  { id: 'board', label: 'Board', icon: '⬢', render: (go) => <BoardInput onDone={() => go('players')} /> },
  { id: 'players', label: 'Players', icon: '👥', render: () => <PlayersSetup /> },
  { id: 'pieces', label: 'Pieces', icon: '🏠', render: (go) => <PiecesScreen go={go} /> },
  { id: 'play', label: 'Play', icon: '▶️', render: (go) => <PlayScreen go={go} /> },
  { id: 'dice', label: 'Dice', icon: '🎲', render: (go) => <DiceScreen go={go} /> },
  { id: 'tips', label: 'Tips', icon: '💡', render: (go) => <Tips go={go} /> },
];
