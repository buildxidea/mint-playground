import partialSemanticsJson from '../../data/splat-analysis/kinetic-hall/normalized/reviewed-partial-semantics-v3.json';
import type { SemanticSplatObject } from './types';

type KineticHallReviewedSemanticsDocument = {
  schemaVersion: number;
  status: 'partial-reviewed-subset-not-production-complete';
  roomId: 'kinetic-hall';
  canonicalPassSetStatus: 'rejected';
  catalogSemanticStatus: 'pending-analyzer';
  objectCount: number;
  objects: SemanticSplatObject[];
  missingCriticalLabels: string[];
  semanticReview: {
    path: string;
    sha256: string;
    reviewSourceCommit: string;
    decision: 'reject-canonical-pass-set-retain-partial-subset';
  };
  semanticRecoveryReview: {
    path: string;
    sha256: string;
    reviewSourceCommit: string;
    decision: 'accept-two-control-panels-reject-three-charging-stations';
  };
  criticalSemanticRecoveryReview: {
    path: string;
    sha256: string;
    reviewSourceCommit: string;
    decision: 'accept-two-doors-reject-nine-retain-two-uncertain';
  };
  manualDockReview: {
    path: string;
    sha256: string;
    reviewSourceCommit: string;
    decision: 'accept-manual-charging-dock-semantic-require-contact-anchor-refinement';
  };
};

const partialSemantics = partialSemanticsJson as unknown as KineticHallReviewedSemanticsDocument;
const objectIds = new Set(partialSemantics.objects.map((object) => object.id));

if (
  partialSemantics.schemaVersion !== 1 ||
  partialSemantics.status !== 'partial-reviewed-subset-not-production-complete' ||
  partialSemantics.roomId !== 'kinetic-hall' ||
  partialSemantics.canonicalPassSetStatus !== 'rejected' ||
  partialSemantics.catalogSemanticStatus !== 'pending-analyzer' ||
  partialSemantics.objectCount !== 9 ||
  partialSemantics.objects.length !== partialSemantics.objectCount ||
  objectIds.size !== partialSemantics.objectCount ||
  partialSemantics.objects.some((object) => object.roomId !== 'kinetic-hall' || !object.verified) ||
  partialSemantics.missingCriticalLabels.length === 0
) {
  throw new Error('Kinetic Hall partial reviewed semantics are malformed or over-promoted');
}

/**
 * Eight independently accepted analyzer detections plus one independently
 * accepted authored Mint dock fallback retained for review and anchor work.
 * The canonical analyzer pass set remains rejected and the production catalog
 * intentionally remains pending while ramp is missing.
 */
export const KINETIC_HALL_REVIEWED_PARTIAL_SEMANTICS = Object.freeze(partialSemantics);
