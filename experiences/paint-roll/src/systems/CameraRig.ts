import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ROOM, type SurfacePlacement } from '../game/room';

const WALL_FOV = 58;
const REVEAL_FOV = 52;

/** Fraction of the viewport a surface should occupy. */
const SURFACE_FILL = 0.82;

const TURN_SECONDS = 0.42;
const REVEAL_SECONDS = 2.6;

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

export function createPose(): Pose {
  return { position: new Vector3(), quaternion: new Quaternion(), fov: WALL_FOV };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Owns the camera and every move it makes: facing a wall, swinging a quarter
 * turn when the roller crosses a corner, and the final reveal.
 *
 * Poses are resolved fresh each step; the blend counter only runs while a turn
 * is in flight, so ordinary painting has no camera lag at all.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;

  private blend = 1;
  private blendDuration = TURN_SECONDS;
  private readonly fromPosition = new Vector3();
  private readonly fromQuaternion = new Quaternion();
  private fromFov = WALL_FOV;
  private readonly targetPosition = new Vector3();
  private readonly targetQuaternion = new Quaternion();
  private targetFov = WALL_FOV;

  private revealing = false;

  private readonly scratchTarget = new Vector3();
  private readonly scratchUp = new Vector3(0, 1, 0);
  private readonly scratchPosition = new Vector3();
  private readonly scratchQuaternion = new Quaternion();
  private readonly revealScratch = createPose();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(WALL_FOV, aspect, 0.05, 200);
  }

  get isTurning(): boolean {
    return this.blend < 1;
  }

  get isRevealing(): boolean {
    return this.revealing;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Distance at which `size` fills `fill` of the view at `fov`. */
  private framingDistance(
    width: number,
    height: number,
    fov: number,
    fill: number,
  ): number {
    const half = Math.tan(MathUtils.degToRad(fov) / 2);
    const forHeight = height / fill / (2 * half);
    const forWidth = width / fill / (2 * half * this.camera.aspect);
    return Math.max(forHeight, forWidth);
  }

  private lookAtQuaternion(
    position: Vector3,
    target: Vector3,
    up: Vector3,
    out: Quaternion,
  ): Quaternion {
    // Build the orientation without disturbing the live camera transform.
    this.scratchPosition.copy(this.camera.position);
    this.scratchQuaternion.copy(this.camera.quaternion);
    const savedUp = this.camera.up.clone();

    this.camera.position.copy(position);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
    out.copy(this.camera.quaternion);

    this.camera.position.copy(this.scratchPosition);
    this.camera.quaternion.copy(this.scratchQuaternion);
    this.camera.up.copy(savedUp);
    return out;
  }

  /**
   * Face a wall from inside the room, along its normal.
   *
   * When the framing distance is deeper than the room, the camera ends up
   * behind the opposite wall — which costs nothing, because every surface faces
   * inward and so the near wall is backface-culled and simply not in the way.
   */
  wallPose(placement: SurfacePlacement, out: Pose): Pose {
    const distance = this.framingDistance(
      placement.width,
      placement.height,
      WALL_FOV,
      SURFACE_FILL,
    );
    this.scratchTarget
      .copy(placement.origin)
      .addScaledVector(placement.right, placement.width / 2)
      .addScaledVector(placement.up, placement.height / 2);

    out.position
      .copy(this.scratchTarget)
      .addScaledVector(placement.normal, distance);
    out.fov = WALL_FOV;
    this.scratchUp.set(0, 1, 0);
    this.lookAtQuaternion(out.position, this.scratchTarget, this.scratchUp, out.quaternion);
    return out;
  }

  /**
   * Pull back through the south wall for the reveal.
   *
   * Deliberately axis-aligned rather than a prettier corner view: the
   * before/after wipe is a world-X plane, and this keeps world X mapped to
   * screen X so the wipe reads as one clean vertical line.
   */
  private revealPose(out: Pose): Pose {
    const distance = this.framingDistance(
      ROOM.width * 1.12,
      ROOM.height * 1.22,
      REVEAL_FOV,
      SURFACE_FILL,
    );
    out.position.set(0, ROOM.height * 0.88, ROOM.depth / 2 + distance);
    out.fov = REVEAL_FOV;
    this.scratchTarget.set(0, ROOM.height * 0.45, 0);
    this.scratchUp.set(0, 1, 0);
    this.lookAtQuaternion(out.position, this.scratchTarget, this.scratchUp, out.quaternion);
    return out;
  }

  snapTo(pose: Pose): void {
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.targetPosition.copy(pose.position);
    this.targetQuaternion.copy(pose.quaternion);
    this.targetFov = pose.fov;
    this.blend = 1;
  }

  private beginTransition(pose: Pose, duration: number): void {
    this.fromPosition.copy(this.camera.position);
    this.fromQuaternion.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.targetPosition.copy(pose.position);
    this.targetQuaternion.copy(pose.quaternion);
    this.targetFov = pose.fov;
    this.blendDuration = duration;
    this.blend = 0;
  }

  /** Quarter turn to the next wall. */
  turnTo(pose: Pose): void {
    this.beginTransition(pose, TURN_SECONDS);
  }

  beginReveal(): void {
    this.revealing = true;
    this.beginTransition(this.revealPose(this.revealScratch), REVEAL_SECONDS);
  }

  endReveal(): void {
    this.revealing = false;
  }

  update(deltaSeconds: number, desired: Pose | null): void {
    if (this.blend >= 1) {
      const pose = desired ?? {
        position: this.targetPosition,
        quaternion: this.targetQuaternion,
        fov: this.targetFov,
      };
      this.camera.position.copy(pose.position);
      this.camera.quaternion.copy(pose.quaternion);
      if (Math.abs(this.camera.fov - pose.fov) > 1e-3) {
        this.camera.fov = pose.fov;
        this.camera.updateProjectionMatrix();
      }
      this.targetPosition.copy(pose.position);
      this.targetQuaternion.copy(pose.quaternion);
      this.targetFov = pose.fov;
      return;
    }

    this.blend = Math.min(1, this.blend + deltaSeconds / this.blendDuration);
    const t = easeInOutCubic(this.blend);
    this.camera.position.lerpVectors(this.fromPosition, this.targetPosition, t);
    this.camera.quaternion
      .copy(this.fromQuaternion)
      .slerp(this.targetQuaternion, t);
    this.camera.fov = this.fromFov + (this.targetFov - this.fromFov) * t;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Screen x of the room's world-X extremes, so the wipe handle maps onto the
   * same world plane the shader uses.
   */
  roomScreenBoundsX(viewportWidth: number): { left: number; right: number } {
    const project = (worldX: number) => {
      this.scratchPosition.set(worldX, ROOM.height / 2, 0).project(this.camera);
      return ((this.scratchPosition.x + 1) / 2) * viewportWidth;
    };
    return { left: project(-ROOM.width / 2), right: project(ROOM.width / 2) };
  }
}
