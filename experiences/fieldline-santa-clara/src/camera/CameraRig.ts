import * as THREE from "three";
import { REFERENCE_CAMERAS, type ReferenceCameraId } from "../calibration/referenceCameras";
import type { FocusTarget, HeightPreset } from "../stadium/sightlineEngine";
import {
  HEIGHT_PRESET_OFFSET_M,
  focusTargetPosition,
} from "../stadium/sightlineEngine";
import type { ModeledGeometryManifest } from "../stadium/schema";
import {
  NATURAL_YAW_LIMIT_RAD,
  SEATED_FOV_MAX_DEG,
  SEATED_FOV_MIN_DEG,
  SEATED_LEAN_LIMITS_M,
  SEATED_PITCH_MAX_RAD,
  SEATED_PITCH_MIN_RAD,
  clampSeatLocalLean,
  createSeatOccupantEye,
  seatedBasis,
  wrapSignedAngle,
  SEATED_OCCUPANT_CONTRACT_VERSION,
  type SeatLocalLean,
  type SeatPerspectiveId,
  type SeatedLookMode,
} from "./seatOccupantRig";

export type CameraMode = "overview" | "seated";
export type ExplorerFrameLevel = "section" | "row" | "seat";

const PERSPECTIVE_FOCUS: Partial<Record<SeatPerspectiveId, FocusTarget>> = {
  midfield: "midfield",
  "near-goal": "near-goal",
  "far-goal": "far-goal",
  "north-board": "north-board",
  "south-board": "south-board",
};

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CameraMode = "overview";
  private overviewTarget = new THREE.Vector3(0, 12, 0);
  private spherical = new THREE.Spherical(214, 1.05, 0.82);
  private seatAnchor = new THREE.Vector3();
  private seatedEye = new THREE.Vector3();
  private seatYawRad = 0;
  private lookYawOffset = 0;
  private lookPitchOffset = 0;
  private baseForward = new THREE.Vector3(0, 0, -1);
  private useAuthenticForward = false;
  private focus: FocusTarget = "midfield";
  private heightPreset: HeightPreset = "average";
  private lookMode: SeatedLookMode = "natural";
  private perspective: SeatPerspectiveId = "midfield";
  private lean: SeatLocalLean = { lateral: 0, forward: 0, vertical: 0 };
  private seatedFovDeg = 55;
  private flyFrom = new THREE.Vector3();
  private flyTo = new THREE.Vector3();
  private flyLookFrom = new THREE.Vector3();
  private flyLookTo = new THREE.Vector3();
  private flyT: number | null = null;
  private readonly flyDuration = 1.4;
  private geometry: ModeledGeometryManifest | null = null;
  private eyeHeight = 1.2;
  private minRadius = 45;
  private maxRadius = 275;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.035, 650);
    this.updateOverview();
  }

  setGeometry(geometry: ModeledGeometryManifest): void {
    this.geometry = geometry;
    this.eyeHeight = geometry.eyeHeightM.value;
  }

  setFocus(focus: FocusTarget): void {
    this.focus = focus;
    if (focus in PERSPECTIVE_FOCUS) this.perspective = focus as SeatPerspectiveId;
    this.useAuthenticForward = false;
    this.lookYawOffset = 0;
    this.lookPitchOffset = 0;
    if (this.mode === "seated" && this.flyT == null) this.applySeatedLook();
  }

  setHeightPreset(preset: HeightPreset): void {
    this.heightPreset = preset;
    if (this.mode === "seated") {
      this.updateSeatedEye();
      this.applySeatedLook();
    }
  }

  orbit(dx: number, dy: number): void {
    if (this.mode !== "overview" || this.flyT != null) return;
    this.spherical.theta -= dx * 0.005;
    this.spherical.phi = THREE.MathUtils.clamp(
      this.spherical.phi + dy * 0.005,
      0.25,
      1.45,
    );
    this.updateOverview();
  }

  zoom(delta: number): void {
    if (this.flyT != null) return;
    if (this.mode === "seated") {
      this.seatedFovDeg = THREE.MathUtils.clamp(
        this.seatedFovDeg + delta * 0.025,
        SEATED_FOV_MIN_DEG,
        SEATED_FOV_MAX_DEG,
      );
      this.camera.fov = this.seatedFovDeg;
      this.camera.updateProjectionMatrix();
      return;
    }
    const step = Math.max(0.02, this.spherical.radius * 0.002);
    this.spherical.radius = THREE.MathUtils.clamp(
      this.spherical.radius + delta * step,
      this.minRadius,
      this.maxRadius,
    );
    this.updateOverview();
  }

  look(dx: number, dy: number): void {
    if (this.mode !== "seated" || this.flyT != null) return;
    const nextYaw = this.lookYawOffset + dx * 0.0036;
    this.lookYawOffset = this.lookMode === "free"
      ? wrapSignedAngle(nextYaw)
      : THREE.MathUtils.clamp(nextYaw, -NATURAL_YAW_LIMIT_RAD, NATURAL_YAW_LIMIT_RAD);
    this.lookPitchOffset = THREE.MathUtils.clamp(
      this.lookPitchOffset - dy * 0.003,
      SEATED_PITCH_MIN_RAD,
      SEATED_PITCH_MAX_RAD,
    );
    this.applySeatedLook();
  }

  moveLean(lateralM: number, forwardM: number, verticalM: number): void {
    if (this.mode !== "seated" || this.flyT != null) return;
    this.lean = clampSeatLocalLean({
      lateral: this.lean.lateral + lateralM,
      forward: this.lean.forward + forwardM,
      vertical: this.lean.vertical + verticalM,
    });
    this.updateSeatedEye();
    this.applySeatedLook();
  }

  setLeanNormalized(lateral: number, forward: number, vertical: number): void {
    if (this.mode !== "seated" || this.flyT != null) return;
    this.lean = clampSeatLocalLean({
      lateral: lateral * SEATED_LEAN_LIMITS_M.lateral,
      forward: forward * SEATED_LEAN_LIMITS_M.forward,
      vertical: vertical * SEATED_LEAN_LIMITS_M.vertical,
    });
    this.updateSeatedEye();
    this.applySeatedLook();
  }

  setLookMode(mode: SeatedLookMode): void {
    this.lookMode = mode;
    if (mode === "natural") {
      this.lookYawOffset = THREE.MathUtils.clamp(
        this.lookYawOffset,
        -NATURAL_YAW_LIMIT_RAD,
        NATURAL_YAW_LIMIT_RAD,
      );
    }
    if (this.mode === "seated") this.applySeatedLook();
  }

  setLookOffsetsDegrees(yawDeg: number, pitchDeg: number): void {
    if (this.mode !== "seated" || this.flyT != null) return;
    const yawRad = THREE.MathUtils.degToRad(yawDeg);
    this.lookYawOffset = this.lookMode === "free"
      ? wrapSignedAngle(yawRad)
      : THREE.MathUtils.clamp(yawRad, -NATURAL_YAW_LIMIT_RAD, NATURAL_YAW_LIMIT_RAD);
    this.lookPitchOffset = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(pitchDeg),
      SEATED_PITCH_MIN_RAD,
      SEATED_PITCH_MAX_RAD,
    );
    this.applySeatedLook();
  }

  setSeatedFov(fovDeg: number): void {
    if (this.mode !== "seated" || this.flyT != null) return;
    this.seatedFovDeg = THREE.MathUtils.clamp(
      fovDeg,
      SEATED_FOV_MIN_DEG,
      SEATED_FOV_MAX_DEG,
    );
    this.camera.fov = this.seatedFovDeg;
    this.camera.updateProjectionMatrix();
  }

  setSeatedPerspective(id: SeatPerspectiveId): void {
    this.perspective = id;
    this.lookYawOffset = 0;
    this.lookPitchOffset = 0;
    const focus = PERSPECTIVE_FOCUS[id];
    if (focus) {
      this.focus = focus;
      this.useAuthenticForward = false;
    } else {
      this.useAuthenticForward = true;
      if (id === "left-context") this.lookYawOffset = Math.PI / 2;
      if (id === "right-context") this.lookYawOffset = -Math.PI / 2;
    }
    if (this.mode === "seated" && this.flyT == null) this.applySeatedLook();
  }

  resetSeatedForward(): void {
    this.setSeatedPerspective("authentic-forward");
  }

  resetSeatedPose(): void {
    this.lean = { lateral: 0, forward: 0, vertical: 0 };
    this.seatedFovDeg = 55;
    this.lookMode = "natural";
    this.camera.fov = this.seatedFovDeg;
    this.camera.updateProjectionMatrix();
    this.updateSeatedEye();
    this.setSeatedPerspective("authentic-forward");
  }

  flyToSeat(anchor: THREE.Vector3, yawRad: number): void {
    this.flyFrom.copy(this.camera.position);
    const currentDir = new THREE.Vector3();
    this.camera.getWorldDirection(currentDir);
    this.flyLookFrom.copy(this.camera.position).addScaledVector(currentDir, 30);

    this.seatAnchor.copy(anchor);
    this.seatYawRad = yawRad;
    this.baseForward.copy(seatedBasis(yawRad).forward);
    this.lean = { lateral: 0, forward: 0, vertical: 0 };
    this.lookYawOffset = 0;
    this.lookPitchOffset = 0;
    this.lookMode = "natural";
    this.perspective = "midfield";
    this.useAuthenticForward = false;
    this.seatedFovDeg = 55;
    this.camera.fov = this.seatedFovDeg;
    this.camera.near = 0.035;
    this.camera.far = 650;
    this.camera.updateProjectionMatrix();
    this.updateSeatedEye();

    this.flyTo.copy(this.seatedEye);
    const look = this.geometry
      ? focusTargetPosition(this.focus, this.geometry)
      : new THREE.Vector3(0, 0, 0);
    look.y = Math.max(look.y, 1.5);
    this.flyLookTo.copy(look);
    this.flyT = 0;
    this.mode = "seated";
  }

  returnToOverview(): void {
    this.mode = "overview";
    this.flyT = null;
    this.overviewTarget.set(0, 12, 0);
    this.spherical.set(214, 1.05, 0.82);
    this.minRadius = 45;
    this.updateOverview();
  }

  frameExplorerAnchor(anchor: THREE.Vector3, level: ExplorerFrameLevel): void {
    this.mode = "overview";
    this.flyT = null;
    this.overviewTarget.copy(anchor);
    this.overviewTarget.y += level === "section" ? 2.5 : 1.2;
    this.minRadius = level === "section" ? 34 : 16;
    const radius = level === "section" ? 78 : level === "row" ? 38 : 27;
    const phi = level === "section" ? 0.94 : 1.02;
    const theta = Math.atan2(anchor.x, anchor.z);
    this.spherical.set(radius, phi, theta);
    this.updateOverview();
  }

  setReferenceView(id: ReferenceCameraId): void {
    const frame = REFERENCE_CAMERAS[id];
    this.mode = "overview";
    this.flyT = null;
    this.camera.fov = frame.fovDeg;
    this.camera.near = frame.nearM;
    this.camera.far = frame.farM;
    this.camera.position.fromArray(frame.position);
    this.camera.lookAt(new THREE.Vector3().fromArray(frame.target));
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this.flyT == null) return;
    this.flyT += dt;
    const u = Math.min(1, this.flyT / this.flyDuration);
    const e = 1 - Math.pow(1 - u, 3);
    this.camera.position.lerpVectors(this.flyFrom, this.flyTo, e);
    const look = new THREE.Vector3().lerpVectors(this.flyLookFrom, this.flyLookTo, e);
    this.camera.lookAt(look);
    if (u >= 1) {
      this.flyT = null;
      this.seatedEye.copy(this.flyTo);
      this.applySeatedLook();
    }
  }

  getSeatOccupantDiagnostics(): Record<string, unknown> {
    const basis = seatedBasis(this.seatYawRad);
    const expectedEye = createSeatOccupantEye(
      this.seatAnchor,
      this.seatYawRad,
      this.eyeHeight,
      HEIGHT_PRESET_OFFSET_M[this.heightPreset],
      this.lean,
    );
    return {
      active: this.mode === "seated",
      transitionActive: this.flyT != null,
      contractVersion: SEATED_OCCUPANT_CONTRACT_VERSION,
      coordinateBasis: "meters-y-up-east+x-south+z; seat-local +z forward",
      seatAnchor: this.seatAnchor.toArray(),
      seatYawRad: this.seatYawRad,
      seatForward: basis.forward.toArray(),
      seatRight: basis.right.toArray(),
      eye: this.seatedEye.toArray(),
      expectedEye: expectedEye.toArray(),
      eyeMatchesContract: this.seatedEye.distanceTo(expectedEye) < 1e-6,
      eyeHeightAboveAnchorM: this.seatedEye.y - this.seatAnchor.y,
      lookMode: this.lookMode,
      perspective: this.perspective,
      yawOffsetDeg: THREE.MathUtils.radToDeg(this.lookYawOffset),
      pitchOffsetDeg: THREE.MathUtils.radToDeg(this.lookPitchOffset),
      fovDeg: this.camera.fov,
      leanM: { ...this.lean },
      limits: {
        naturalYawDeg: 110,
        pitchDeg: [-70, 70],
        fovDeg: [SEATED_FOV_MIN_DEG, SEATED_FOV_MAX_DEG],
        leanM: { ...SEATED_LEAN_LIMITS_M },
      },
    };
  }

  private updateOverview(): void {
    if (this.camera.fov !== 55 || this.camera.near !== 0.035 || this.camera.far !== 650) {
      this.camera.fov = 55;
      this.camera.near = 0.035;
      this.camera.far = 650;
      this.camera.updateProjectionMatrix();
    }
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.overviewTarget).add(offset);
    this.camera.lookAt(this.overviewTarget);
  }

  private updateSeatedEye(): void {
    this.seatedEye.copy(createSeatOccupantEye(
      this.seatAnchor,
      this.seatYawRad,
      this.eyeHeight,
      HEIGHT_PRESET_OFFSET_M[this.heightPreset],
      this.lean,
    ));
    if (this.seatedEye.y < this.seatAnchor.y + 0.8) {
      this.seatedEye.y = this.seatAnchor.y + 0.8;
    }
  }

  private applySeatedLook(): void {
    if (!this.geometry) return;
    this.camera.position.copy(this.seatedEye);

    const focus = this.useAuthenticForward
      ? this.seatedEye.clone().addScaledVector(this.baseForward, 40)
      : focusTargetPosition(this.focus, this.geometry);
    focus.y = this.useAuthenticForward ? this.seatedEye.y - 2.2 : Math.max(focus.y, 1.5);

    const toFocus = focus.clone().sub(this.seatedEye);
    if (toFocus.lengthSq() < 1e-6) toFocus.set(0, 0, -1);
    toFocus.normalize();

    const yawQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.lookYawOffset,
    );
    const pitched = toFocus.clone().applyQuaternion(yawQ);
    const right = new THREE.Vector3().crossVectors(pitched, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(right, this.lookPitchOffset);
    pitched.applyQuaternion(pitchQ);

    this.camera.lookAt(this.seatedEye.clone().add(pitched));
  }
}
