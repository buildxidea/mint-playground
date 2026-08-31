import type { PowerUpKind } from './zombiesData';

export type PowerUpPresentationSpec = {
  label: string;
  shortLabel: string;
  color: string;
  accent: string;
  artifactId: string;
  silhouette: string;
  effectCopy: string;
  iconSvg: string;
};

/**
 * Shared world/HUD presentation contract. Every reward has a shape identity in
 * addition to its color so it stays legible in monochrome and during motion.
 */
export const POWER_UP_PRESENTATIONS: Record<
  PowerUpKind,
  PowerUpPresentationSpec
> = {
  'max-ammo': {
    label: 'Max Ammo',
    shortLabel: 'Ammo',
    color: '#4b9cff',
    accent: '#d9ebff',
    artifactId: 'prop-powerup-max-ammo',
    silhouette: 'ammo-crate-twin-magazines',
    effectCopy: 'All weapon reserves refilled',
    iconSvg:
      '<path d="M5 4h5v15H5zM14 4h5v15h-5zM6 2h3v3H6zm9 0h3v3h-3zM4 19h16v3H4z"/>',
  },
  'insta-kill': {
    label: 'Insta-Kill',
    shortLabel: 'Insta',
    color: '#ff4c4c',
    accent: '#ffe1d9',
    artifactId: 'prop-powerup-insta-kill',
    silhouette: 'skull-crossed-blades',
    effectCopy: 'Every hit is lethal for 30 seconds',
    iconSvg:
      '<path d="M12 2a8 8 0 0 0-8 8c0 3.2 1.7 5.1 4 6.2V21h3v-3h2v3h3v-4.8c2.3-1.1 4-3 4-6.2a8 8 0 0 0-8-8Zm-3 10.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm-3 3.5-2-2h4l-2 2Z"/>',
  },
  'double-points': {
    label: 'Double Points',
    shortLabel: '2×',
    color: '#ffc94a',
    accent: '#fff3bd',
    artifactId: 'prop-powerup-double-points',
    silhouette: 'paired-coins-2x',
    effectCopy: 'Score awards doubled for 30 seconds',
    iconSvg:
      '<path d="M3 4h9v4H7v2h5v4H3V9h5V8H3V4Zm12 1 2 2 2-2 2 2-2 2 2 2-2 2-2-2-2 2-2-2 2-2-2-2 2-2Zm-2 11a5 5 0 1 1-9.6 2H7a2 2 0 1 0 2-2h4Zm8 0v6h-6v-3h3v-3h3Z"/>',
  },
  nuke: {
    label: 'Nuke',
    shortLabel: 'Nuke',
    color: '#f2f4e8',
    accent: '#ffffff',
    artifactId: 'prop-powerup-nuke',
    silhouette: 'finned-bomb-radiation-core',
    effectCopy: 'All active zombies eliminated',
    iconSvg:
      '<path d="m3 14 3-3 7-7 3 3-7 7-3 3-3-3Zm10-10 3-2 1 4-4-2Zm3 3 4-1-2 4-2-3ZM8 18a4 4 0 1 0 8 0h-3a1 1 0 1 1-2 0H8Zm8-3 5-2v4l-5-2Z"/>',
  },
  carpenter: {
    label: 'Carpenter',
    shortLabel: 'Repair',
    color: '#8ed45b',
    accent: '#e9ffd7',
    artifactId: 'prop-powerup-carpenter',
    silhouette: 'crossed-hammer-planks',
    effectCopy: 'Every barrier fully repaired',
    iconSvg:
      '<path d="m4 2 5 4-2 2 4 4-3 3-4-4-2 2V6l2-4Zm13 1 4 4-2 2-4-4 2-2ZM5 21l-2-2L16 6l2 2L5 21Zm8-7 3-3 5 5-3 3-5-5Z"/>',
  },
};

export function powerUpIconSvg(kind: PowerUpKind): string {
  const spec = POWER_UP_PRESENTATIONS[kind];
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${spec.iconSvg}</svg>`;
}
