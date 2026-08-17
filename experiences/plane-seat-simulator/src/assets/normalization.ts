import type { FurnitureKey } from "./asset-manifest";

export interface Normalization {
  /** Max world size the model must fit inside (w, h, d). */
  fit: [number, number, number];
  /** Extra yaw so the model's visual front faces +Z after normalization. */
  yawOffset: number;
  /**
   * Roll about Z applied before measuring bounds. Lays an upright model onto
   * its side, e.g. a suitcase stowed lengthwise into a bin.
   */
  rollZ?: number;
  /**
   * Pitch about X applied before measuring bounds. Tips an upright panel to
   * face downward, e.g. a service unit on the underside of a bin.
   */
  pitchX?: number;
  /**
   * Extra scale on the model's own depth axis only, applied after the uniform
   * bounds fit. Needed where a generated module carries a housing far deeper
   * than the recess it mounts into; the visible face keeps its relief.
   */
  flattenDepth?: number;
  /**
   * Vertical anchor: omitted = rest on the floor (min-Y at 0); a number
   * centers the model at that height in its own local space.
   */
  centerY?: number;
  /**
   * Fraction of the vertices that make up the model's real body. A few
   * generated modules carry a handful of stray vertices well outside it, and
   * the triangles bridging the gap stretch into sheets that read as walls in
   * the room. When set, triangles reaching outside the box holding this
   * fraction of the vertices are dropped before the bounds fit, so the fit
   * measures the body rather than the strays.
   */
  trimStray?: number;
  /**
   * Height, in the model's normalized space, below which geometry is cut away.
   * Both door models carry a flat plate across their base — a floor-level sill
   * on the cabin doors, a protruding ledge on the hatches — that reads as a
   * slab hanging off the bottom of the door. Anchoring is left alone, so the
   * rest of the door keeps the position it was placed at.
   */
  trimBelowY?: number;
}

/** Per-model normalization tuning; bounds-based, applied once at load. */
export const NORMALIZATION: Record<FurnitureKey, Normalization> = {
  // One seat model for every seat in the cabin, so all 100 are identical.
  // yawOffset is set so the backrest lands at the aft end (facing the nose).
  "economy-seat": { fit: [0.46, 1.06, 0.72], yawOffset: Math.PI },
  // Depth allowances are generous so each fixture's height governs the fit
  // rather than its base plate.
  "lav-toilet": { fit: [0.56, 0.68, 0.85], yawOffset: 0 },
  "lav-vanity": { fit: [0.7, 0.88, 0.52], yawOffset: 0 },
  // The door GLB carries a few dozen stray vertices roughly half a metre off
  // the panel; untrimmed they drag a triangle fan clear across the lavatory.
  "lav-door": { fit: [0.85, 1.9, 0.78], yawOffset: 0, trimStray: 0.97 },
  // Stands on the floor. The depth allowance is generous so the model's sill
  // plate cannot bind the fit and shrink the door below full height.
  // trimBelowY drops the floor-level sill slab, just over a square metre of
  // horizontal plate that hangs off the bottom of the door.
  "cabin-door": { fit: [1.15, 1.95, 1.45], yawOffset: 0, trimBelowY: 0.16 },
  // Centered on its own origin so placement can hang it at window height, so
  // the ledge along its lower edge sits at a negative height.
  "emergency-exit-door": {
    fit: [0.8, 1.12, 0.45],
    yawOffset: 0,
    centerY: 0,
    trimBelowY: -0.38,
  },
  "galley-unit": { fit: [1.3, 1.6, 0.7], yawOffset: 0 },
  // Service panels are tipped to face the floor and centred on their own
  // origin so placement can hang them from the bin underside.
  // No centerY: the default anchors the lowest point, which after the pitch
  // is the panel face, so placement puts the face flush with the bin.
  "psu-panel-triple": {
    fit: [0.84, 2, 0.48],
    yawOffset: 0,
    pitchX: Math.PI / 2,
    flattenDepth: 0.2,
  },
  "psu-panel-double": {
    fit: [0.72, 2, 0.48],
    yawOffset: 0,
    pitchX: Math.PI / 2,
    flattenDepth: 0.25,
  },
  // Stowed bags lie on their side with the long axis running into the bin.
  "carry-on-suitcase": { fit: [0.64, 0.3, 0.36], yawOffset: 0, rollZ: Math.PI / 2 },
  "duffel-bag": { fit: [0.6, 0.3, 0.36], yawOffset: 0 },
  "backpack": { fit: [0.56, 0.3, 0.36], yawOffset: 0, rollZ: Math.PI / 2 },
};
