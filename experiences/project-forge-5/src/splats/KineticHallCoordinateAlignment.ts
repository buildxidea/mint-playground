import acceptedAlignmentJson from '../../data/splat-analysis/kinetic-hall/calibration/accepted-coordinate-alignment.json';
import { getCalibrationAcceptanceFailures } from './SplatCoordinateMapper';
import type { SplatCalibrationRecord } from './types';

const acceptedAlignment = acceptedAlignmentJson as unknown as SplatCalibrationRecord;
const failures = getCalibrationAcceptanceFailures(acceptedAlignment);
if (failures.length > 0) {
  throw new Error(`Accepted Kinetic Hall coordinate alignment is invalid: ${failures.join(' ')}`);
}

/**
 * Independently accepted for coordinate mapping only. The record intentionally
 * leaves gameplay anchors, semantic labels, and full Gate F3 unaccepted.
 */
export const KINETIC_HALL_COORDINATE_ALIGNMENT = Object.freeze(acceptedAlignment);
