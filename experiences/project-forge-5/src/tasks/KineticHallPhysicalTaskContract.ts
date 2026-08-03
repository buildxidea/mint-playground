export type KineticHallTaskFixtureId = 'control-panel-east' | 'dock-south';

export type KineticHallTaskFixtureContract = Readonly<{
  id: KineticHallTaskFixtureId;
  semanticObjectId: string;
  sourceDecision: 'accepted-individual-anchor' | 'runtime-collider-qualified-relocation';
  contactPoint: readonly [number, number, number];
  approachSurfacePosition: readonly [number, number, number];
  sensorCenter: readonly [number, number, number];
  sensorHalfExtents: readonly [number, number, number];
  desiredYawRadians: number;
  yawToleranceDegrees: number;
}>;

/**
 * Exact reviewed interaction anchors for the Kinetic vertical slice.
 *
 * The panel point is the independently accepted exact-collider refinement from
 * physical-anchor-measurement.json. The dock preserves the accepted target's
 * local contact point and direction, translated onto the production collider's
 * connected east lane after the original World placement failed capsule
 * reachability. The approach poses keep AXIOM's capsule outside fixed geometry
 * while its reach/contact sensor overlaps the physical interaction envelope.
 */
export const KINETIC_HALL_TASK_FIXTURES: Readonly<
  Record<KineticHallTaskFixtureId, KineticHallTaskFixtureContract>
> = Object.freeze({
  'control-panel-east': {
    id: 'control-panel-east',
    semanticObjectId: 'kinetic-hall:d601ef4c',
    sourceDecision: 'accepted-individual-anchor',
    contactPoint: [3.2871438692108086, 2.10450104153229, -1.3907620727223216],
    approachSurfacePosition: [2.62, 0, -1.3907620727223216],
    sensorCenter: [2.62, 0.89, -1.3907620727223216],
    sensorHalfExtents: [0.45, 0.72, 0.4],
    desiredYawRadians: -Math.PI / 2,
    yawToleranceDegrees: 28,
  },
  'dock-south': {
    id: 'dock-south',
    semanticObjectId: 'kinetic-hall:manual:dock-south-relocated-v1',
    sourceDecision: 'runtime-collider-qualified-relocation',
    contactPoint: [2, 0.4520871152446986, -6.176984983994553],
    approachSurfacePosition: [2, 0.08928132477368189, -5.33555],
    sensorCenter: [2, 0.4192813247736819, -5.33555],
    sensorHalfExtents: [0.2, 0.4, 0.2],
    desiredYawRadians: 0,
    yawToleranceDegrees: 5,
  },
});

export function getKineticHallTaskFixture(
  id: KineticHallTaskFixtureId,
): KineticHallTaskFixtureContract {
  return KINETIC_HALL_TASK_FIXTURES[id];
}

export function scaleKineticHallTaskFixture(
  contract: KineticHallTaskFixtureContract,
  horizontalScale: number,
): KineticHallTaskFixtureContract {
  const scalePoint = (
    point: readonly [number, number, number],
  ): readonly [number, number, number] => [
    point[0] * horizontalScale,
    point[1],
    point[2] * horizontalScale,
  ];
  return {
    ...contract,
    contactPoint: scalePoint(contract.contactPoint),
    approachSurfacePosition: scalePoint(contract.approachSurfacePosition),
    sensorCenter: scalePoint(contract.sensorCenter),
  };
}
