import * as THREE from 'three';
import type { RobotId } from '../config/catalog';
import type {
  PhysicsWorld,
  RobotContactObservation,
  RobotRaySample,
} from '../physics/PhysicsWorld';
import type { AxiomRigBinding } from '../robots/AxiomRigContract';
import type { RobotTelemetry } from '../robots/RobotRuntime';

type Tuple3 = readonly [number, number, number];
type FeedName =
  'camera' | 'depth' | 'proximity' | 'imu' | 'joint' | 'contact' | 'battery' | 'odometry';

export type RobotSensorProfile = Readonly<{
  id: `${RobotId}-sensor-suite-v1`;
  cameraHeightFromBodyCenterMeters: number;
  ratesHz: Readonly<Record<FeedName, number>>;
  latencyMilliseconds: Readonly<Record<FeedName, number>>;
  depthRangeMeters: number;
  proximityRangeMeters: number;
}>;

const rates = {
  camera: 30,
  depth: 20,
  proximity: 15,
  imu: 60,
  joint: 60,
  contact: 60,
  battery: 5,
  odometry: 30,
} as const;

const latencyMilliseconds = {
  camera: 33,
  depth: 50,
  proximity: 20,
  imu: 8,
  joint: 8,
  contact: 8,
  battery: 100,
  odometry: 16,
} as const;

export const ROBOT_SENSOR_PROFILES: Readonly<Record<RobotId, RobotSensorProfile>> = {
  'axiom-h1': {
    id: 'axiom-h1-sensor-suite-v1',
    cameraHeightFromBodyCenterMeters: 0.64,
    ratesHz: rates,
    latencyMilliseconds,
    depthRangeMeters: 8,
    proximityRangeMeters: 3,
  },
  'quadrant-q4': {
    id: 'quadrant-q4-sensor-suite-v1',
    cameraHeightFromBodyCenterMeters: 0.24,
    ratesHz: rates,
    latencyMilliseconds,
    depthRangeMeters: 10,
    proximityRangeMeters: 3,
  },
  'forge-t7': {
    id: 'forge-t7-sensor-suite-v1',
    cameraHeightFromBodyCenterMeters: 0.4,
    ratesHz: rates,
    latencyMilliseconds,
    depthRangeMeters: 12,
    proximityRangeMeters: 4,
  },
  'swift-w2': {
    id: 'swift-w2-sensor-suite-v1',
    cameraHeightFromBodyCenterMeters: 0.4,
    ratesHz: rates,
    latencyMilliseconds,
    depthRangeMeters: 10,
    proximityRangeMeters: 3,
  },
  'kestrel-d5': {
    id: 'kestrel-d5-sensor-suite-v1',
    cameraHeightFromBodyCenterMeters: 0,
    ratesHz: rates,
    latencyMilliseconds,
    depthRangeMeters: 16,
    proximityRangeMeters: 5,
  },
};

export type RobotSensorSnapshot = Readonly<{
  schemaVersion: 1;
  robotId: RobotId;
  profileId: RobotSensorProfile['id'];
  tick: number;
  simulationTimeSeconds: number;
  camera: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    origin: Tuple3;
    forward: Tuple3;
    horizontalFovDegrees: number;
    frameStatus: 'pose-qualified-render-target-pending';
  }>;
  depth: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    rangeMeters: number;
    representation: 'physics-ray-fan';
    noiseModel: 'deterministic-uniform-v1';
    noiseMaximumMeters: number;
    samples: readonly Readonly<{
      angleDegrees: number;
      truthMeters: number;
      measuredMeters: number;
      hit: boolean;
    }>[];
  }>;
  proximity: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    rangeMeters: number;
    noiseModel: 'deterministic-uniform-v1';
    noiseMaximumMeters: number;
    samples: readonly Readonly<{
      direction: 'forward' | 'left' | 'right' | 'rear' | 'up' | 'down';
      truthMeters: number;
      measuredMeters: number;
      hit: boolean;
    }>[];
  }>;
  imu: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    linearAccelerationTruth: Tuple3;
    linearAccelerationMeasured: Tuple3;
    yawRateTruth: number;
    yawRateMeasured: number;
    accelerationNoiseMaximumMetersPerSecondSquared: number;
    yawRateNoiseMaximumRadiansPerSecond: number;
  }>;
  joint: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    status: 'mint-articulation' | 'morphology-contract-pending';
    valuesRadians: Readonly<Record<string, Tuple3>>;
  }>;
  contact: RobotContactObservation &
    Readonly<{
      rateHz: number;
      latencyMilliseconds: number;
    }>;
  battery: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    truthPercent: number;
    measuredPercent: number;
    noiseMaximumPercent: number;
  }>;
  odometry: Readonly<{
    sequence: number;
    rateHz: number;
    latencyMilliseconds: number;
    positionTruth: Tuple3;
    positionMeasured: Tuple3;
    yawTruth: number;
    yawMeasured: number;
    positionNoiseMaximumMeters: number;
    yawNoiseMaximumRadians: number;
  }>;
}>;

const tuple3 = (value: THREE.Vector3): Tuple3 => [value.x, value.y, value.z];
const DEPTH_ANGLES_DEGREES = [-40, -30, -20, -10, 0, 10, 20, 30, 40] as const;
const PROXIMITY_NAMES = ['forward', 'left', 'right', 'rear', 'up', 'down'] as const;

export class RobotSensorSuite {
  private readonly profile: RobotSensorProfile;
  private readonly nextSampleTime = new Map<FeedName, number>();
  private readonly sequence = new Map<FeedName, number>();
  private readonly previousPosition = new THREE.Vector3();
  private readonly previousVelocity = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly acceleration = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly rayDirections: THREE.Vector3[] = [];
  private simulationTimeSeconds = 0;
  private tick = 0;
  private previousYaw = 0;
  private snapshotValue: RobotSensorSnapshot;

  constructor(
    private readonly robotId: RobotId,
    private readonly physics: PhysicsWorld,
  ) {
    this.profile = ROBOT_SENSOR_PROFILES[robotId];
    for (const feed of Object.keys(rates) as FeedName[]) {
      this.nextSampleTime.set(feed, 1 / this.profile.ratesHz[feed]);
      this.sequence.set(feed, 0);
    }
    this.snapshotValue = this.emptySnapshot();
  }

  get snapshot(): RobotSensorSnapshot {
    return this.snapshotValue;
  }

  reset(telemetry: RobotTelemetry): void {
    this.simulationTimeSeconds = 0;
    this.tick = 0;
    this.previousPosition.copy(telemetry.position);
    this.previousVelocity.set(0, 0, 0);
    this.previousYaw = telemetry.yaw;
    for (const feed of Object.keys(rates) as FeedName[]) {
      this.nextSampleTime.set(feed, 1 / this.profile.ratesHz[feed]);
      this.sequence.set(feed, 0);
    }
    this.snapshotValue = this.emptySnapshot();
  }

  update(
    fixedDt: number,
    telemetry: RobotTelemetry,
    articulation: AxiomRigBinding | null,
  ): RobotSensorSnapshot {
    if (!Number.isFinite(fixedDt) || fixedDt <= 0) return this.snapshotValue;
    this.tick += 1;
    this.simulationTimeSeconds += fixedDt;
    this.velocity.copy(telemetry.position).sub(this.previousPosition).divideScalar(fixedDt);
    this.acceleration.copy(this.velocity).sub(this.previousVelocity).divideScalar(fixedDt);
    const yawRate =
      Math.atan2(
        Math.sin(telemetry.yaw - this.previousYaw),
        Math.cos(telemetry.yaw - this.previousYaw),
      ) / fixedDt;
    this.previousPosition.copy(telemetry.position);
    this.previousVelocity.copy(this.velocity);
    this.previousYaw = telemetry.yaw;

    this.origin
      .copy(telemetry.position)
      .add(new THREE.Vector3(0, this.profile.cameraHeightFromBodyCenterMeters, 0));
    this.forward.set(-Math.sin(telemetry.yaw), 0, -Math.cos(telemetry.yaw));
    this.right.set(Math.cos(telemetry.yaw), 0, -Math.sin(telemetry.yaw));

    let camera = this.snapshotValue.camera;
    if (this.due('camera')) {
      camera = {
        sequence: this.bump('camera'),
        rateHz: this.profile.ratesHz.camera,
        latencyMilliseconds: this.profile.latencyMilliseconds.camera,
        origin: tuple3(this.origin),
        forward: tuple3(this.forward),
        horizontalFovDegrees: 78,
        frameStatus: 'pose-qualified-render-target-pending',
      };
    }

    let depth = this.snapshotValue.depth;
    if (this.due('depth')) {
      const depthSequence = this.bump('depth');
      this.rayDirections.length = 0;
      for (const angleDegrees of DEPTH_ANGLES_DEGREES) {
        const angle = THREE.MathUtils.degToRad(angleDegrees);
        this.rayDirections.push(
          this.forward
            .clone()
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(this.right, Math.sin(angle)),
        );
      }
      const samples = this.physics.castRobotSensorRays(
        this.origin,
        this.rayDirections,
        this.profile.depthRangeMeters,
      );
      depth = {
        sequence: depthSequence,
        rateHz: this.profile.ratesHz.depth,
        latencyMilliseconds: this.profile.latencyMilliseconds.depth,
        rangeMeters: this.profile.depthRangeMeters,
        representation: 'physics-ray-fan',
        noiseModel: 'deterministic-uniform-v1',
        noiseMaximumMeters: 0.006,
        samples: samples.map((sample, index) => ({
          angleDegrees: DEPTH_ANGLES_DEGREES[index],
          truthMeters: sample.distanceMeters,
          measuredMeters: this.noisyRange(
            sample,
            depthSequence,
            index,
            0.006,
            this.profile.depthRangeMeters,
          ),
          hit: sample.hit,
        })),
      };
    }

    let proximity = this.snapshotValue.proximity;
    if (this.due('proximity')) {
      const proximitySequence = this.bump('proximity');
      const directions = [
        this.forward.clone(),
        this.right.clone().multiplyScalar(-1),
        this.right.clone(),
        this.forward.clone().multiplyScalar(-1),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, -1, 0),
      ];
      const samples = this.physics.castRobotSensorRays(
        this.origin,
        directions,
        this.profile.proximityRangeMeters,
      );
      proximity = {
        sequence: proximitySequence,
        rateHz: this.profile.ratesHz.proximity,
        latencyMilliseconds: this.profile.latencyMilliseconds.proximity,
        rangeMeters: this.profile.proximityRangeMeters,
        noiseModel: 'deterministic-uniform-v1',
        noiseMaximumMeters: 0.01,
        samples: samples.map((sample, index) => ({
          direction: PROXIMITY_NAMES[index],
          truthMeters: sample.distanceMeters,
          measuredMeters: this.noisyRange(
            sample,
            proximitySequence,
            index,
            0.01,
            this.profile.proximityRangeMeters,
          ),
          hit: sample.hit,
        })),
      };
    }

    let imu = this.snapshotValue.imu;
    if (this.due('imu')) {
      const imuSequence = this.bump('imu');
      imu = {
        sequence: imuSequence,
        rateHz: this.profile.ratesHz.imu,
        latencyMilliseconds: this.profile.latencyMilliseconds.imu,
        linearAccelerationTruth: tuple3(this.acceleration),
        linearAccelerationMeasured: [
          this.acceleration.x + this.noise(imuSequence, 0, 0.015),
          this.acceleration.y + this.noise(imuSequence, 1, 0.015),
          this.acceleration.z + this.noise(imuSequence, 2, 0.015),
        ],
        yawRateTruth: yawRate,
        yawRateMeasured: yawRate + this.noise(imuSequence, 3, 0.002),
        accelerationNoiseMaximumMetersPerSecondSquared: 0.015,
        yawRateNoiseMaximumRadiansPerSecond: 0.002,
      };
    }

    let joint = this.snapshotValue.joint;
    if (this.due('joint')) {
      const valuesRadians: Record<string, Tuple3> = {};
      for (const [name, value] of Object.entries(articulation?.actuation.jointDeltas ?? {})) {
        valuesRadians[name] = [...value];
      }
      joint = {
        sequence: this.bump('joint'),
        rateHz: this.profile.ratesHz.joint,
        latencyMilliseconds: this.profile.latencyMilliseconds.joint,
        status: articulation ? 'mint-articulation' : 'morphology-contract-pending',
        valuesRadians,
      };
    }

    let contact = this.snapshotValue.contact;
    if (this.due('contact')) {
      this.bump('contact');
      contact = {
        ...this.physics.robotContactObservation,
        rateHz: this.profile.ratesHz.contact,
        latencyMilliseconds: this.profile.latencyMilliseconds.contact,
      };
    }

    let battery = this.snapshotValue.battery;
    if (this.due('battery')) {
      const batterySequence = this.bump('battery');
      battery = {
        sequence: batterySequence,
        rateHz: this.profile.ratesHz.battery,
        latencyMilliseconds: this.profile.latencyMilliseconds.battery,
        truthPercent: telemetry.battery,
        measuredPercent: THREE.MathUtils.clamp(
          telemetry.battery + this.noise(batterySequence, 0, 0.02),
          0,
          100,
        ),
        noiseMaximumPercent: 0.02,
      };
    }

    let odometry = this.snapshotValue.odometry;
    if (this.due('odometry')) {
      const odometrySequence = this.bump('odometry');
      odometry = {
        sequence: odometrySequence,
        rateHz: this.profile.ratesHz.odometry,
        latencyMilliseconds: this.profile.latencyMilliseconds.odometry,
        positionTruth: tuple3(telemetry.position),
        positionMeasured: [
          telemetry.position.x + this.noise(odometrySequence, 0, 0.002),
          telemetry.position.y + this.noise(odometrySequence, 1, 0.002),
          telemetry.position.z + this.noise(odometrySequence, 2, 0.002),
        ],
        yawTruth: telemetry.yaw,
        yawMeasured: telemetry.yaw + this.noise(odometrySequence, 3, 0.0008),
        positionNoiseMaximumMeters: 0.002,
        yawNoiseMaximumRadians: 0.0008,
      };
    }

    this.snapshotValue = {
      schemaVersion: 1,
      robotId: this.robotId,
      profileId: this.profile.id,
      tick: this.tick,
      simulationTimeSeconds: this.simulationTimeSeconds,
      camera,
      depth,
      proximity,
      imu,
      joint,
      contact,
      battery,
      odometry,
    };
    return this.snapshotValue;
  }

  dispose(): void {
    this.rayDirections.length = 0;
  }

  private due(feed: FeedName): boolean {
    const next = this.nextSampleTime.get(feed) ?? 0;
    if (this.simulationTimeSeconds + 1e-9 < next) return false;
    const period = 1 / this.profile.ratesHz[feed];
    let following = next;
    while (following <= this.simulationTimeSeconds + 1e-9) following += period;
    this.nextSampleTime.set(feed, following);
    return true;
  }

  private bump(feed: FeedName): number {
    const value = (this.sequence.get(feed) ?? 0) + 1;
    this.sequence.set(feed, value);
    return value;
  }

  private noisyRange(
    sample: RobotRaySample,
    sequence: number,
    channel: number,
    amplitude: number,
    maximum: number,
  ): number {
    if (!sample.hit) return sample.distanceMeters;
    return THREE.MathUtils.clamp(
      sample.distanceMeters + this.noise(sequence, channel, amplitude),
      0,
      maximum,
    );
  }

  private noise(sequence: number, channel: number, amplitude: number): number {
    const value = Math.sin((sequence + 1) * 12.9898 + (channel + 1) * 78.233) * 43758.5453;
    const normalized = value - Math.floor(value);
    return (normalized * 2 - 1) * amplitude;
  }

  private emptySnapshot(): RobotSensorSnapshot {
    const emptyContact: RobotContactObservation = {
      sequence: 0,
      profile: 'none',
      leftFoot: false,
      rightFoot: false,
      supportCount: 0,
      grounded: false,
    };
    return {
      schemaVersion: 1,
      robotId: this.robotId,
      profileId: this.profile.id,
      tick: 0,
      simulationTimeSeconds: 0,
      camera: {
        sequence: 0,
        rateHz: this.profile.ratesHz.camera,
        latencyMilliseconds: this.profile.latencyMilliseconds.camera,
        origin: [0, 0, 0],
        forward: [0, 0, -1],
        horizontalFovDegrees: 78,
        frameStatus: 'pose-qualified-render-target-pending',
      },
      depth: {
        sequence: 0,
        rateHz: this.profile.ratesHz.depth,
        latencyMilliseconds: this.profile.latencyMilliseconds.depth,
        rangeMeters: this.profile.depthRangeMeters,
        representation: 'physics-ray-fan',
        noiseModel: 'deterministic-uniform-v1',
        noiseMaximumMeters: 0.006,
        samples: [],
      },
      proximity: {
        sequence: 0,
        rateHz: this.profile.ratesHz.proximity,
        latencyMilliseconds: this.profile.latencyMilliseconds.proximity,
        rangeMeters: this.profile.proximityRangeMeters,
        noiseModel: 'deterministic-uniform-v1',
        noiseMaximumMeters: 0.01,
        samples: [],
      },
      imu: {
        sequence: 0,
        rateHz: this.profile.ratesHz.imu,
        latencyMilliseconds: this.profile.latencyMilliseconds.imu,
        linearAccelerationTruth: [0, 0, 0],
        linearAccelerationMeasured: [0, 0, 0],
        yawRateTruth: 0,
        yawRateMeasured: 0,
        accelerationNoiseMaximumMetersPerSecondSquared: 0.015,
        yawRateNoiseMaximumRadiansPerSecond: 0.002,
      },
      joint: {
        sequence: 0,
        rateHz: this.profile.ratesHz.joint,
        latencyMilliseconds: this.profile.latencyMilliseconds.joint,
        status: 'morphology-contract-pending',
        valuesRadians: {},
      },
      contact: {
        ...emptyContact,
        rateHz: this.profile.ratesHz.contact,
        latencyMilliseconds: this.profile.latencyMilliseconds.contact,
      },
      battery: {
        sequence: 0,
        rateHz: this.profile.ratesHz.battery,
        latencyMilliseconds: this.profile.latencyMilliseconds.battery,
        truthPercent: 100,
        measuredPercent: 100,
        noiseMaximumPercent: 0.02,
      },
      odometry: {
        sequence: 0,
        rateHz: this.profile.ratesHz.odometry,
        latencyMilliseconds: this.profile.latencyMilliseconds.odometry,
        positionTruth: [0, 0, 0],
        positionMeasured: [0, 0, 0],
        yawTruth: 0,
        yawMeasured: 0,
        positionNoiseMaximumMeters: 0.002,
        yawNoiseMaximumRadians: 0.0008,
      },
    };
  }
}
