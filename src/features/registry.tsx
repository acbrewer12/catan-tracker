/**
 * The app's screens. Each feature thread adds its screen here (one entry) and
 * keeps everything else inside its own features/<name>/ folder.
 */
import type { ReactNode } from 'react';
import { BoardInput } from './board-input/BoardInput';
import { PlayersSetup } from './players/PlayersSetup';
import { PiecesScreen } from './pieces/PiecesScreen';

export interface Screen {
  id: string;
  label: string;
  icon: string;
  render: (go: (id: string) => void) => ReactNode;
}

const ComingSoon = ({ what }: { what: string }) => (
  <div className="screen">
    <p className="hint">{what} is coming soon.</p>
  </div>
);

export const SCREENS: Screen[] = [
  { id: 'board', label: 'Board', icon: '⬢', render: (go) => <BoardInput onDone={() => go('players')} /> },
  { id: 'players', label: 'Players', icon: '👥', render: () => <PlayersSetup /> },
  { id: 'pieces', label: 'Pieces', icon: '🏠', render: (go) => <PiecesScreen go={go} /> },
  { id: 'dice', label: 'Dice', icon: '🎲', render: () => <ComingSoon what="Dice rolls and cards" /> },
  { id: 'tips', label: 'Tips', icon: '💡', render: () => <ComingSoon what="Placement and strategy suggestions" /> },
];
