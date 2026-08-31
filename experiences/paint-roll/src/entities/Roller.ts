import {
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { loadModel } from '../assets/PropLibrary';

/**
 * Measured off the generated GLB (single mesh, local axes: sleeve along X,
 * pole down -Y, contact face toward -Z). These describe where the sleeve sits
 * inside the asset so the gameplay pivot can be put on the sleeve's axis.
 */
const SLEEVE_MODEL = {
  minX: -0.33,
  maxX: 0.29,
  centreY: 0.375,
  centreZ: 0,
  radius: 0.127,
};
const SLEEVE_MODEL_LENGTH = SLEEVE_MODEL.maxX - SLEEVE_MODEL.minX;
const SLEEVE_MODEL_CENTRE_X = (SLEEVE_MODEL.minX + SLEEVE_MODEL.maxX) / 2;

/** Physical sleeve width in metres; everything else scales from this. */
export const SLEEVE_WIDTH = 0.26;
export const CONTACT_DEPTH = 0.058;

const MODEL_SCALE = SLEEVE_WIDTH / SLEEVE_MODEL_LENGTH;
export const SLEEVE_RADIUS = SLEEVE_MODEL.radius * MODEL_SCALE;

/**
 * The player's roller.
 *
 * The Mint asset is one mesh with one baked material, so the sleeve cannot be
 * recoloured by overriding a material slot. Instead a thin paint coat cylinder
 * is fitted over the sleeve — which is what actually happens to a roller — and
 * that is what carries the active swatch colour and fades out as the roller
 * runs dry.
 */
export class Roller {
  readonly group = new Group();

  private readonly pivot = new Object3D();
  private readonly coatMaterial: MeshStandardMaterial;
  private readonly coat: Mesh;

  private readonly targetQuaternion = new Quaternion();
  private readonly basis = new Matrix4();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  /** Which of the two equivalent sleeve directions is currently in use. */
  private sleeveSign = 1;
  private coatOpacity = 0;

  private constructor(model: Group) {
    // Put the sleeve's axis centre on the group origin so gameplay can position
    // the group by the contact point alone.
    this.pivot.scale.setScalar(MODEL_SCALE);
    this.pivot.position.set(
      -SLEEVE_MODEL_CENTRE_X * MODEL_SCALE,
      -SLEEVE_MODEL.centreY * MODEL_SCALE,
      -SLEEVE_MODEL.centreZ * MODEL_SCALE,
    );
    this.pivot.add(model);
    this.group.add(this.pivot);

    this.coatMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.22,
      metalness: 0,
      transparent: true,
      opacity: 0,
      // A dry roller should show the white sleeve, not a ghost shell.
      depthWrite: false,
    });

    const geometry = new CylinderGeometry(
      SLEEVE_RADIUS * 1.04,
      SLEEVE_RADIUS * 1.04,
      SLEEVE_WIDTH * 0.94,
      24,
      1,
      true,
    );
    // Three's cylinder runs along Y; the sleeve runs along X.
    geometry.rotateZ(Math.PI / 2);
    this.coat = new Mesh(geometry, this.coatMaterial);
    this.group.add(this.coat);

    model.traverse((child) => {
      if ((child as Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });
  }

  static async create(): Promise<Roller> {
    const model = await loadModel('roller');
    return new Roller(model);
  }

  /**
   * Sit the roller against a surface.
   *
   * `normal` points off the surface into the room; `sleeveDirection` is the
   * in-plane sleeve axis, already perpendicular to the direction of travel.
   * The model's local -Z is its contact face, so local +Z is the normal.
   *
   * A cylinder is symmetric under a half turn, so of the two sleeve directions
   * that give the same band we take the one that keeps the handle pointing more
   * downward. Without that the pole swings fully overhead on horizontal strokes.
   */
  place(contact: Vector3, normal: Vector3, sleeveDirection: Vector3): void {
    this.group.position.copy(contact).addScaledVector(normal, SLEEVE_RADIUS);

    // Pole is local -Y, and local Y = normal x sleeve. Flipping the sleeve
    // flips the pole, so compare the two candidates' downwardness.
    this.axisY.copy(normal).cross(sleeveDirection);
    const poleYWithPlus = -this.axisY.y;
    const poleYWithMinus = this.axisY.y;

    const difference = poleYWithPlus - poleYWithMinus;
    if (Math.abs(difference) > 0.05) {
      // On a wall one option is clearly more handle-down than the other.
      this.sleeveSign = difference < 0 ? 1 : -1;
    }
    // On a purely horizontal stroke the sleeve goes vertical and both options
    // leave the handle equally level, so the previous choice stands rather than
    // letting the roller flip about arbitrarily.

    this.axisX.copy(sleeveDirection).multiplyScalar(this.sleeveSign);
    this.axisZ.copy(normal);
    this.axisY.copy(this.axisZ).cross(this.axisX).normalize();

    this.basis.makeBasis(this.axisX, this.axisY, this.axisZ);
    this.targetQuaternion.setFromRotationMatrix(this.basis);
  }

  setPaint(color: Color, loadFraction: number): void {
    this.coatMaterial.color.copy(color);
    // Fade the coat out over the last stretch so running dry is visible on the
    // roller itself, not only on the meter.
    this.coatOpacity = Math.min(1, Math.max(0, loadFraction * 3)) * 0.95;
  }

  update(deltaSeconds: number): void {
    // Snappy but not instant: the turn should read as the roller reorienting.
    this.group.quaternion.slerp(this.targetQuaternion, Math.min(1, deltaSeconds * 14));

    const current = this.coatMaterial.opacity;
    this.coatMaterial.opacity =
      current + (this.coatOpacity - current) * Math.min(1, deltaSeconds * 8);
    this.coat.visible = this.coatMaterial.opacity > 0.02;
  }

  /** Snap the orientation, for a restart or a corner crossing. */
  settle(): void {
    this.group.quaternion.copy(this.targetQuaternion);
  }

  dispose(): void {
    this.coat.geometry.dispose();
    this.coatMaterial.dispose();
  }
}
