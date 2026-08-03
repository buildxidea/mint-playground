import * as THREE from 'three';
import type { RoomId } from '../config/catalog';
import { SplatCoordinateMapper } from './SplatCoordinateMapper';
import type {
  AnalyzerFrameEvidence,
  QuaternionRecord,
  RawSplatAnalyzerObject,
  SemanticSplatObject,
  Vector3Record,
} from './types';

export type NormalizationContext = {
  roomId: RoomId;
  sourcePass: string;
  inputSplatHash: string;
  analyzerVersion: string;
  mapper: SplatCoordinateMapper;
  roomBounds?: THREE.Box3;
};

type RawDocument = {
  objects: RawSplatAnalyzerObject[];
  frame_annotations: Record<string, unknown[]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseVector(value: unknown, field: string): Vector3Record {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.z)
  ) {
    throw new Error(`${field} must contain finite x, y, and z values`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

function parseQuaternion(value: unknown): QuaternionRecord {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.w)
  ) {
    throw new Error('rotation must contain finite x, y, z, and w values');
  }
  const quaternion = new THREE.Quaternion(value.x, value.y, value.z, value.w);
  if (quaternion.lengthSq() < 1e-9) throw new Error('rotation must be a valid quaternion');
  quaternion.normalize();
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function parseFrames(value: unknown): AnalyzerFrameEvidence[] {
  if (!Array.isArray(value)) throw new Error('frames must be an array');
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.frame_idx) ||
      !Array.isArray(entry.box) ||
      entry.box.length !== 4 ||
      !entry.box.every(isFiniteNumber) ||
      !isFiniteNumber(entry.score)
    ) {
      throw new Error(`frames[${index}] does not match the analyzer evidence schema`);
    }
    return {
      frame_idx: entry.frame_idx as number,
      box: entry.box as [number, number, number, number],
      score: entry.score,
    };
  });
}

function parseObject(value: unknown, index: number): RawSplatAnalyzerObject {
  if (!isRecord(value) || typeof value.label !== 'string' || value.label.trim() === '') {
    throw new Error(`objects[${index}].label must be a non-empty string`);
  }
  const scale = parseVector(value.scale, `objects[${index}].scale`);
  if (scale.x < 0 || scale.y < 0 || scale.z < 0) {
    throw new Error(`objects[${index}].scale must not contain negative dimensions`);
  }
  return {
    label: value.label.trim(),
    position: parseVector(value.position, `objects[${index}].position`),
    rotation: parseQuaternion(value.rotation),
    scale,
    frames: parseFrames(value.frames),
  };
}

export function parseSplatAnalyzerDocument(value: unknown): RawDocument {
  if (!isRecord(value) || !Array.isArray(value.objects) || !isRecord(value.frame_annotations)) {
    throw new Error('Unrecognized Splat Analyzer interactions.json schema');
  }
  return {
    objects: value.objects.map(parseObject),
    frame_annotations: Object.fromEntries(
      Object.entries(value.frame_annotations).map(([key, annotations]) => {
        if (!Array.isArray(annotations)) {
          throw new Error(`frame_annotations.${key} must be an array`);
        }
        return [key, annotations];
      }),
    ),
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const canonicalNumber = (value: number): string => value.toFixed(6);

export function normalizeSplatAnalyzerDocument(
  value: unknown,
  context: NormalizationContext,
): SemanticSplatObject[] {
  const document = parseSplatAnalyzerDocument(value);
  return document.objects.map((object) => {
    const worldPosition = context.mapper.mapPoint(object.position);
    if (
      context.roomBounds &&
      !context.roomBounds.containsPoint(
        new THREE.Vector3(worldPosition.x, worldPosition.y, worldPosition.z),
      )
    ) {
      throw new Error(`Detection "${object.label}" lies outside reviewed room bounds`);
    }
    const canonicalBox = [
      context.roomId,
      context.sourcePass,
      object.label.toLocaleLowerCase(),
      context.inputSplatHash,
      canonicalNumber(object.position.x),
      canonicalNumber(object.position.y),
      canonicalNumber(object.position.z),
      canonicalNumber(object.scale.x),
      canonicalNumber(object.scale.y),
      canonicalNumber(object.scale.z),
    ].join('|');
    return {
      id: `${context.roomId}:${stableHash(canonicalBox)}`,
      roomId: context.roomId,
      label: object.label,
      aliases: [],
      rawPosition: object.position,
      rawSize: object.scale,
      rawQuaternion: object.rotation,
      worldPosition,
      worldSize: context.mapper.mapSize(object.scale),
      worldQuaternion: context.mapper.mapQuaternion(object.rotation),
      sourcePass: context.sourcePass,
      inputSplatHash: context.inputSplatHash,
      analyzerVersion: context.analyzerVersion,
      verified: false,
      validationNotes: [],
    };
  });
}
