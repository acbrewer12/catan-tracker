/** Who is playing. Exactly one player has isMe = true. */
import { emptyHand, type GameState, type PlayerId } from '../../model/types';

export const PLAYER_COLORS = ['#d64545', '#2f6fdb', '#f2f2f2', '#e8892b', '#2e9e5b', '#7a4b2a'];
export const COLOR_NAMES: Record<string, string> = {
  '#d64545': 'Red', '#2f6fdb': 'Blue', '#f2f2f2': 'White', '#e8892b': 'Orange', '#2e9e5b': 'Green', '#7a4b2a': 'Brown',
};

export type PlayersAction =
  | { type: 'players/add' }
  | { type: 'players/remove'; id: PlayerId }
  | { type: 'players/rename'; id: PlayerId; name: string }
  | { type: 'players/setColor'; id: PlayerId; color: string }
  | { type: 'players/setMe'; id: PlayerId }
  | { type: 'players/move'; id: PlayerId; delta: -1 | 1 };

let seq = 0;
export const newPlayerId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export function playersReducer(s: GameState, a: PlayersAction): GameState {
  switch (a.type) {
    case 'players/add': {
      if (s.players.length >= 6) return s;
      const color = PLAYER_COLORS.find((c) => !s.players.some((p) => p.color === c)) ?? PLAYER_COLORS[0];
      const id = newPlayerId();
      return {
        ...s,
        players: [...s.players, { id, name: COLOR_NAMES[color] ?? `Player ${s.players.length + 1}`, color, isMe: s.players.length === 0 }],
        hands: { ...s.hands, [id]: emptyHand() },
      };
    }
    case 'players/remove': {
      if (s.players.length <= 2) return s;
      const players = s.players.filter((p) => p.id !== a.id);
      if (!players.some((p) => p.isMe)) players[0] = { ...players[0], isMe: true };
      const hands = { ...s.hands };
      delete hands[a.id];
      // Their pieces leave the board with them.
      const buildings = Object.fromEntries(Object.entries(s.pieces.buildings).filter(([, b]) => b.player !== a.id));
      const roads = Object.fromEntries(Object.entries(s.pieces.roads).filter(([, p]) => p !== a.id));
      return { ...s, players, hands, pieces: { ...s.pieces, buildings, roads } };
    }
    case 'players/rename':
      return { ...s, players: s.players.map((p) => (p.id === a.id ? { ...p, name: a.name } : p)) };
    case 'players/setColor':
      return { ...s, players: s.players.map((p) => (p.id === a.id ? { ...p, color: a.color } : p)) };
    case 'players/setMe':
      return { ...s, players: s.players.map((p) => ({ ...p, isMe: p.id === a.id })) };
    case 'players/move': {
      const i = s.players.findIndex((p) => p.id === a.id);
      const j = i + a.delta;
      if (i < 0 || j < 0 || j >= s.players.length) return s;
      const players = [...s.players];
      [players[i], players[j]] = [players[j], players[i]];
      return { ...s, players };
    }
  }
}
