/**
 * A round hazard on the water: wildlife, a sandbar, debris or crossing traffic.
 *
 * Damage lands once per contact, on the frame the hull first touches, so
 * resting against a whale does not drain the hull. Drag applies continuously
 * while overlapping, which is what makes a sandbar feel like a sandbar.
 */
export interface CircleHazard {
  kind: 'whale' | 'dolphin' | 'fish' | 'sandbar' | 'debris' | 'traffic';
  x: number;
  z: number;
  radius: number;
  /** Hull damage applied once on entry. */
  damage: number;
  /** Per-second velocity decay while overlapping. 0 means no drag. */
  drag: number;
  /** Whether the hull is pushed back out instead of passing through. */
  solid: boolean;
  /** Contact latch, so damage fires on entry rather than every frame. */
  touching: boolean;
  /** Human-readable label for the HUD callout. */
  label: string;
}

export function createHazard(
  kind: CircleHazard['kind'],
  x: number,
  z: number,
  radius: number,
  options: { damage?: number; drag?: number; solid?: boolean; label?: string } = {},
): CircleHazard {
  return {
    kind,
    x,
    z,
    radius,
    damage: options.damage ?? 0,
    drag: options.drag ?? 0,
    solid: options.solid ?? false,
    touching: false,
    label: options.label ?? kind,
  };
}
