import { emptyBoard } from '../model/board';
import { emptyHand, type GameState, type LayoutId, type Player } from '../model/types';
import { COLOR_NAMES, PLAYER_COLORS, newPlayerId } from './slices/players';

export function newGame(layout: LayoutId = 'standard', playerCount = 4): GameState {
  const players: Player[] = PLAYER_COLORS.slice(0, playerCount).map((color, i) => ({
    id: newPlayerId(),
    name: i === 0 ? 'Me' : COLOR_NAMES[color],
    color,
    isMe: i === 0,
  }));
  return {
    version: 1,
    phase: 'setup',
    board: emptyBoard(layout),
    players,
    pieces: { buildings: {}, roads: {} },
    robber: null,
    diceHistory: [],
    hands: Object.fromEntries(players.map((p) => [p.id, emptyHand()])),
  };
}
