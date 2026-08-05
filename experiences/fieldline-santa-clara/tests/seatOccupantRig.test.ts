import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  NATURAL_YAW_LIMIT_RAD,
  SEATED_EYE_FORWARD_OFFSET_M,
  SEATED_LEAN_LIMITS_M,
  SEAT_PERSPECTIVES,
  clampSeatLocalLean,
  createSeatOccupantEye,
  perspectiveCountForAnchors,
  seatedBasis,
  wrapSignedAngle,
} from "../src/camera/seatOccupantRig";

describe("canonical seat occupant spatial contract", () => {
  it("uses a right-handed orthonormal seat-local basis", () => {
    for (const yaw of [-Math.PI, -1.2, 0, 0.8, Math.PI]) {
      const { forward, right, up } = seatedBasis(yaw);
      expect(forward.length()).toBeCloseTo(1, 8);
      expect(right.length()).toBeCloseTo(1, 8);
      expect(up.length()).toBeCloseTo(1, 8);
      expect(forward.dot(right)).toBeCloseTo(0, 8);
      expect(forward.dot(up)).toBeCloseTo(0, 8);
      expect(new THREE.Vector3().crossVectors(right, up).dot(forward)).toBeCloseTo(1, 8);
    }
  });

  it("derives eye position from the seat anchor, height, forward offset, and lean", () => {
    const anchor = new THREE.Vector3(10, 4, -12);
    const yaw = Math.PI / 2;
    const eye = createSeatOccupantEye(anchor, yaw, 1.2, 0.08, {
      lateral: 0.1,
      forward: 0.12,
      vertical: -0.04,
    });
    const { forward, right } = seatedBasis(yaw);
    const delta = eye.clone().sub(anchor);
    expect(delta.dot(forward)).toBeCloseTo(SEATED_EYE_FORWARD_OFFSET_M + 0.12, 8);
    expect(delta.dot(right)).toBeCloseTo(0.1, 8);
    expect(delta.y).toBeCloseTo(1.24, 8);
  });

  it("clamps lean to the defined occupant clearance envelope", () => {
    expect(clampSeatLocalLean({ lateral: 4, forward: -4, vertical: 4 })).toEqual({
      lateral: SEATED_LEAN_LIMITS_M.lateral,
      forward: -SEATED_LEAN_LIMITS_M.forward,
      vertical: SEATED_LEAN_LIMITS_M.vertical,
    });
  });

  it("exposes eight unique orientations and 4,624 derived perspectives", () => {
    expect(new Set(SEAT_PERSPECTIVES.map((item) => item.id)).size).toBe(8);
    expect(perspectiveCountForAnchors(578)).toBe(4_624);
    expect(THREE.MathUtils.radToDeg(NATURAL_YAW_LIMIT_RAD)).toBeCloseTo(110);
  });

  it("wraps free-look yaw into a stable signed range", () => {
    for (const angle of [-9 * Math.PI, -Math.PI, 0, Math.PI, 9 * Math.PI]) {
      const wrapped = wrapSignedAngle(angle);
      expect(wrapped).toBeGreaterThanOrEqual(-Math.PI);
      expect(wrapped).toBeLessThan(Math.PI);
    }
  });
});
