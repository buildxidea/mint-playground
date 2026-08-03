import type { RoomId } from '../config/catalog';

export type Vector3Record = { x: number; y: number; z: number };
export type QuaternionRecord = { x: number; y: number; z: number; w: number };

export type AnalyzerFrameEvidence = {
  frame_idx: number;
  box: [number, number, number, number];
  score: number;
};

export type RawSplatAnalyzerObject = {
  label: string;
  position: Vector3Record;
  rotation: QuaternionRecord;
  scale: Vector3Record;
  frames: AnalyzerFrameEvidence[];
};

export type SemanticSplatObject = {
  id: string;
  roomId: RoomId;
  label: string;
  aliases: string[];
  rawPosition: Vector3Record;
  rawSize: Vector3Record;
  rawQuaternion: QuaternionRecord;
  worldPosition: Vector3Record;
  worldSize: Vector3Record;
  worldQuaternion: QuaternionRecord;
  sourcePass: string;
  inputSplatHash: string;
  analyzerVersion: string;
  verified: boolean;
  validationNotes: string[];
};

export type SplatCalibrationRecord = {
  roomId: RoomId;
  mintWorldAssetId: string;
  inputSplatSha256: string;
  analyzerCommit: string;
  analyzerToWorld: readonly number[];
  fitLandmarkCount: number;
  holdoutLandmarkCount: number;
  p95HoldoutErrorMeters: number;
  maximumHoldoutErrorMeters: number;
  scaleErrorPercent: number;
  orientationErrorDegrees: number;
  gameplayAnchorMaximumErrorMeters: number | null;
  overlayViewCount: number;
  coordinateAlignmentAccepted: boolean;
  gameplayAnchorsAccepted: boolean;
  semanticLabelsAccepted: boolean;
  fullGateF3Accepted: boolean;
  reviewed: boolean;
  reviewer: string;
  reviewedAt: string;
  evidenceIdentity: {
    measurementCommit: string;
    measurementRecordSha256: string;
    overlaySourceCommit: string;
    overlayManifestSha256: string;
    reviewRecordSha256: string;
  };
};
