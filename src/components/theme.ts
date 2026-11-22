/** Colours and labels shared by every screen. Original look, no official art. */
import type { PortKind, Terrain } from '../model/types';

export const TERRAIN_STYLE: Record<Terrain, { fill: string; label: string; icon: string; key: string }> = {
  wood: { fill: '#3f8f4a', label: 'Wood', icon: '🌲', key: 'w' },
  brick: { fill: '#c8643a', label: 'Brick', icon: '🧱', key: 'b' },
  sheep: { fill: '#a6d46e', label: 'Sheep', icon: '🐑', key: 's' },
  wheat: { fill: '#ecc94b', label: 'Wheat', icon: '🌾', key: 'h' },
  ore: { fill: '#8d93a3', label: 'Ore', icon: '⛰️', key: 'o' },
  desert: { fill: '#e6d7ab', label: 'Desert', icon: '🏜️', key: 'd' },
};

export const PORT_LABEL: Record<PortKind, string> = {
  any: '3:1',
  wood: '2:1 🌲',
  brick: '2:1 🧱',
  sheep: '2:1 🐑',
  wheat: '2:1 🌾',
  ore: '2:1 ⛰️',
};

export const SEA = '#3d7fb8';
