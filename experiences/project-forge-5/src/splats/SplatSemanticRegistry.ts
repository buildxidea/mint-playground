import type { RoomId } from '../config/catalog';
import type { SemanticSplatObject } from './types';

export type ManualSemanticAnnotation = {
  id: string;
  roomId: RoomId;
  label: string;
  source: 'manual';
  reviewed: boolean;
  reviewerNotes: string[];
};

/**
 * Query boundary for normalized analyzer semantics. Unverified detections stay
 * visible to review/debug tools but can never become gameplay-authoritative.
 * Manual fallbacks are stored separately and must carry explicit review state.
 */
export class SplatSemanticRegistry {
  private readonly analyzerObjects = new Map<string, SemanticSplatObject>();
  private readonly manualAnnotations = new Map<string, ManualSemanticAnnotation>();

  replaceAnalyzerObjects(roomId: RoomId, objects: readonly SemanticSplatObject[]): void {
    for (const [id, object] of this.analyzerObjects) {
      if (object.roomId === roomId) this.analyzerObjects.delete(id);
    }
    for (const object of objects) {
      if (object.roomId !== roomId) {
        throw new Error(`Semantic object ${object.id} does not belong to room ${roomId}`);
      }
      if (this.analyzerObjects.has(object.id)) {
        throw new Error(`Duplicate semantic object ID: ${object.id}`);
      }
      this.analyzerObjects.set(object.id, {
        ...object,
        aliases: [...object.aliases],
        validationNotes: [...object.validationNotes],
      });
    }
  }

  replaceManualAnnotations(roomId: RoomId, annotations: readonly ManualSemanticAnnotation[]): void {
    for (const [id, annotation] of this.manualAnnotations) {
      if (annotation.roomId === roomId) this.manualAnnotations.delete(id);
    }
    for (const annotation of annotations) {
      if (annotation.roomId !== roomId || annotation.source !== 'manual') {
        throw new Error(`Manual annotation ${annotation.id} has invalid provenance`);
      }
      this.manualAnnotations.set(annotation.id, {
        ...annotation,
        reviewerNotes: [...annotation.reviewerNotes],
      });
    }
  }

  findForReview(roomId: RoomId, labels: readonly string[] = []): SemanticSplatObject[] {
    const normalizedLabels = new Set(labels.map((label) => label.toLocaleLowerCase()));
    return [...this.analyzerObjects.values()]
      .filter(
        (object) =>
          object.roomId === roomId &&
          (normalizedLabels.size === 0 ||
            normalizedLabels.has(object.label.toLocaleLowerCase()) ||
            object.aliases.some((alias) => normalizedLabels.has(alias.toLocaleLowerCase()))),
      )
      .map((object) => ({
        ...object,
        aliases: [...object.aliases],
        validationNotes: [...object.validationNotes],
      }));
  }

  requireVerified(roomId: RoomId, id: string): SemanticSplatObject {
    const object = this.analyzerObjects.get(id);
    if (object?.roomId !== roomId) throw new Error(`Unknown semantic object: ${id}`);
    if (!object.verified) throw new Error(`Semantic object is not verified: ${id}`);
    return {
      ...object,
      aliases: [...object.aliases],
      validationNotes: [...object.validationNotes],
    };
  }

  getReviewedManual(roomId: RoomId): ManualSemanticAnnotation[] {
    return [...this.manualAnnotations.values()]
      .filter((annotation) => annotation.roomId === roomId && annotation.reviewed)
      .map((annotation) => ({
        ...annotation,
        reviewerNotes: [...annotation.reviewerNotes],
      }));
  }
}
