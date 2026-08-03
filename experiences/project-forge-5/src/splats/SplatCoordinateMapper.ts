import * as THREE from 'three';
import type { QuaternionRecord, SplatCalibrationRecord, Vector3Record } from './types';

export type CalibrationLandmark = {
  id: string;
  analyzerPoint: Vector3Record;
  expectedWorldPoint: Vector3Record;
};

export type CalibrationValidation = {
  accepted: boolean;
  landmarkCount: number;
  maximumErrorMeters: number;
  spreadMeters: number;
  reasons: string[];
};

const CALIBRATION_LIMITS = Object.freeze({
  minimumFitLandmarks: 3,
  minimumHoldoutLandmarks: 5,
  maximumP95HoldoutErrorMeters: 0.15,
  maximumHoldoutErrorMeters: 0.25,
  maximumScaleErrorPercent: 1,
  maximumOrientationErrorDegrees: 2,
  maximumGameplayAnchorErrorMeters: 0.05,
  minimumOverlayViews: 4,
});

const isNonNegativeFinite = (value: number): boolean => Number.isFinite(value) && value >= 0;
const isSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);
const isGitCommit = (value: string): boolean => /^[0-9a-f]{40}$/.test(value);

export const getCalibrationAcceptanceFailures = (record: SplatCalibrationRecord): string[] => {
  const reasons: string[] = [];
  if (!record.reviewed) reasons.push('Calibration has not received independent review.');
  if (!record.coordinateAlignmentAccepted) {
    reasons.push('Coordinate alignment has not received explicit acceptance.');
  }
  if (!isSha256(record.inputSplatSha256) || !isGitCommit(record.analyzerCommit)) {
    reasons.push('Calibration source identity is incomplete or malformed.');
  }
  if (!record.reviewer?.trim()) reasons.push('Independent reviewer identity is required.');
  if (!record.reviewedAt || Number.isNaN(Date.parse(record.reviewedAt))) {
    reasons.push('Independent review date must be valid.');
  }
  const evidence = record.evidenceIdentity;
  if (
    !evidence ||
    !isGitCommit(evidence.measurementCommit) ||
    !isSha256(evidence.measurementRecordSha256) ||
    !isGitCommit(evidence.overlaySourceCommit) ||
    !isSha256(evidence.overlayManifestSha256) ||
    !isSha256(evidence.reviewRecordSha256)
  ) {
    reasons.push('Calibration evidence identity is incomplete or malformed.');
  }
  if (
    !Number.isInteger(record.fitLandmarkCount) ||
    record.fitLandmarkCount < CALIBRATION_LIMITS.minimumFitLandmarks
  ) {
    reasons.push(`At least ${CALIBRATION_LIMITS.minimumFitLandmarks} fit landmarks are required.`);
  }
  if (
    !Number.isInteger(record.holdoutLandmarkCount) ||
    record.holdoutLandmarkCount < CALIBRATION_LIMITS.minimumHoldoutLandmarks
  ) {
    reasons.push(
      `At least ${CALIBRATION_LIMITS.minimumHoldoutLandmarks} independent holdouts are required.`,
    );
  }
  const metricChecks: readonly [number, number, string][] = [
    [
      record.p95HoldoutErrorMeters,
      CALIBRATION_LIMITS.maximumP95HoldoutErrorMeters,
      'p95 holdout error',
    ],
    [
      record.maximumHoldoutErrorMeters,
      CALIBRATION_LIMITS.maximumHoldoutErrorMeters,
      'maximum holdout error',
    ],
    [record.scaleErrorPercent, CALIBRATION_LIMITS.maximumScaleErrorPercent, 'scale error'],
    [
      record.orientationErrorDegrees,
      CALIBRATION_LIMITS.maximumOrientationErrorDegrees,
      'orientation error',
    ],
  ];
  for (const [value, maximum, label] of metricChecks) {
    if (!isNonNegativeFinite(value) || value > maximum) {
      reasons.push(`${label} must be finite, non-negative, and at most ${maximum}.`);
    }
  }
  if (record.p95HoldoutErrorMeters > record.maximumHoldoutErrorMeters) {
    reasons.push('p95 holdout error cannot exceed maximum holdout error.');
  }
  if (
    !Number.isInteger(record.overlayViewCount) ||
    record.overlayViewCount < CALIBRATION_LIMITS.minimumOverlayViews
  ) {
    reasons.push(`At least ${CALIBRATION_LIMITS.minimumOverlayViews} overlay views are required.`);
  }
  if (
    record.gameplayAnchorsAccepted &&
    (record.gameplayAnchorMaximumErrorMeters === null ||
      !isNonNegativeFinite(record.gameplayAnchorMaximumErrorMeters) ||
      record.gameplayAnchorMaximumErrorMeters > CALIBRATION_LIMITS.maximumGameplayAnchorErrorMeters)
  ) {
    reasons.push(
      `gameplay-anchor error must be finite, non-negative, and at most ${CALIBRATION_LIMITS.maximumGameplayAnchorErrorMeters} when gameplay anchors are accepted.`,
    );
  }
  if (
    record.fullGateF3Accepted &&
    (!record.gameplayAnchorsAccepted || !record.semanticLabelsAccepted)
  ) {
    reasons.push(
      'Full Gate F3 acceptance requires separate gameplay-anchor and semantic-label acceptance.',
    );
  }
  return reasons;
};

const vectorFromRecord = (value: Vector3Record): THREE.Vector3 =>
  new THREE.Vector3(value.x, value.y, value.z);

const vectorToRecord = (value: THREE.Vector3): Vector3Record => ({
  x: value.x,
  y: value.y,
  z: value.z,
});

const quaternionToRecord = (value: THREE.Quaternion): QuaternionRecord => ({
  x: value.x,
  y: value.y,
  z: value.z,
  w: value.w,
});

export class SplatCoordinateMapper {
  readonly matrix: THREE.Matrix4;
  private readonly worldRotation = new THREE.Quaternion();
  private readonly worldScale = new THREE.Vector3();

  constructor(matrixElements: readonly number[]) {
    if (matrixElements.length !== 16 || matrixElements.some((value) => !Number.isFinite(value))) {
      throw new Error('analyzerToWorld must contain exactly 16 finite matrix elements');
    }
    this.matrix = new THREE.Matrix4().fromArray([...matrixElements]);
    if (Math.abs(this.matrix.determinant()) < 1e-9) {
      throw new Error('analyzerToWorld must be invertible');
    }
    this.matrix.decompose(new THREE.Vector3(), this.worldRotation, this.worldScale);
  }

  static fromSharedWorldRoot(root: THREE.Object3D): SplatCoordinateMapper {
    root.updateMatrixWorld(true);
    return new SplatCoordinateMapper(root.matrixWorld.toArray());
  }

  static fromCalibration(record: SplatCalibrationRecord): SplatCoordinateMapper {
    const failures = getCalibrationAcceptanceFailures(record);
    if (failures.length > 0) {
      throw new Error(`Splat calibration is not accepted: ${failures.join(' ')}`);
    }
    return new SplatCoordinateMapper(record.analyzerToWorld);
  }

  mapPoint(rawPoint: Vector3Record): Vector3Record {
    return vectorToRecord(vectorFromRecord(rawPoint).applyMatrix4(this.matrix));
  }

  mapSize(rawSize: Vector3Record): Vector3Record {
    return {
      x: Math.abs(rawSize.x * this.worldScale.x),
      y: Math.abs(rawSize.y * this.worldScale.y),
      z: Math.abs(rawSize.z * this.worldScale.z),
    };
  }

  mapQuaternion(rawQuaternion: QuaternionRecord): QuaternionRecord {
    const raw = new THREE.Quaternion(
      rawQuaternion.x,
      rawQuaternion.y,
      rawQuaternion.z,
      rawQuaternion.w,
    ).normalize();
    return quaternionToRecord(this.worldRotation.clone().multiply(raw).normalize());
  }

  validateLandmarks(
    landmarks: readonly CalibrationLandmark[],
    maximumErrorMeters = 0.2,
    minimumSpreadMeters = 2,
  ): CalibrationValidation {
    const reasons: string[] = [];
    let maximumError = 0;
    let spread = 0;
    for (let index = 0; index < landmarks.length; index += 1) {
      const mapped = vectorFromRecord(this.mapPoint(landmarks[index].analyzerPoint));
      const expected = vectorFromRecord(landmarks[index].expectedWorldPoint);
      maximumError = Math.max(maximumError, mapped.distanceTo(expected));
      for (let other = index + 1; other < landmarks.length; other += 1) {
        const otherExpected = vectorFromRecord(landmarks[other].expectedWorldPoint);
        spread = Math.max(spread, expected.distanceTo(otherExpected));
      }
    }
    if (landmarks.length < 3) reasons.push('At least three landmarks are required.');
    if (spread < minimumSpreadMeters) {
      reasons.push(`Landmarks span ${spread.toFixed(3)}m; ${minimumSpreadMeters}m is required.`);
    }
    if (maximumError > maximumErrorMeters) {
      reasons.push(
        `Maximum residual is ${maximumError.toFixed(3)}m; ${maximumErrorMeters}m is allowed.`,
      );
    }
    return {
      accepted: reasons.length === 0,
      landmarkCount: landmarks.length,
      maximumErrorMeters: maximumError,
      spreadMeters: spread,
      reasons,
    };
  }
}
