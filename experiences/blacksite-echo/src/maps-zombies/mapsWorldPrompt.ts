import type { MapsStreetViewPose } from './mapsUrl';

export const MAPS_OUTBREAK_STYLE_VERSION = 'maps-outbreak-v1';
export const MAPS_GENERATION_LIMIT_PER_DAY = 3;

/**
 * Locked scenic prompt for Maps Outbreak worlds.
 * Avoid combat / violence vocabulary — Mint moderation blocks those phrases.
 * Gameplay objects are app-authored Mint props, never baked into the world.
 */
export function buildMapsOutbreakWorldPrompt(
  pose: MapsStreetViewPose,
  title?: string,
): string {
  const place = title?.trim() || pose.locationLabel;
  return [
    `Maps Outbreak arena — ${place}.`,
    'Photoreal cinematic outdoor environment matching the Street View reference for a first-person walkable exploration world.',
    'One continuous walkable ground and open plaza floor inside the central 60% PlayBox with human-scale paths, railings, pavement, and clear open circulation space.',
    'Keep the outer 20–25% as scenic framing that does not block the primary walkable corridor.',
    'Soft natural containment at the edges; no fatal drop-offs inside the playable center.',
    'Empty of people and props.',
    'No baked interactive machines, crates, cabinets, boards, doors, logos, trademarks, text, signage, UI, or branding.',
    `Style contract: ${MAPS_OUTBREAK_STYLE_VERSION}.`,
  ].join(' ');
}
