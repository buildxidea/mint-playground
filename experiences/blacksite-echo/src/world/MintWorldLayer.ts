import {
  SparkRenderer,
  SplatMesh,
} from '@sparkjsdev/spark';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CENTER,
  MeshBVH,
  type ExtendedTriangle,
} from 'three-mesh-bvh';
import type {
  MintWorldRecord,
} from '../assets/MintAssetRuntime';
import type { PhysicsWorld } from '../systems/PhysicsWorld';
import type { Collider } from '@dimforge/rapier3d-compat';
import {
  CUT_FLOOR_SHADER_GUARD,
  MAX_SPLAT_CUT_VOLUMES,
  type SplatCutVolume,
} from './SplatCutVolume';
import {
  MAX_SPLAT_TRIM_PLANES,
  trimPlaneNormal,
  type SplatTrimPlane,
} from './SplatTrimPlane';
import { createPagedRadSplat } from './PagedRadSplat';

const WORLD_SCALE = 2.5;
const WORLD_Y = 1.5;
const WORLD_ROTATION: [number, number, number] = [
  Math.PI,
  Math.PI,
  0,
];
const ZOMBIES_SOURCE_COLLISION_GROUPS = 0x0002_fffe;
const DELIVERY_LOD_SPLAT_COUNT = 2_500_000;
// Authored doorway apertures occupy only part of the frame. Giving their
// isolated behind pass the full 2.5M owner budget doubled sort/page work for
// pixels outside the opening and made movement near portals crawl.
const PORTAL_LOD_SPLAT_COUNT = 420_000;
// The active LoD target is 2.5M splats. An 8M page pool leaves more than 3x
// working headroom without eagerly allocating the former 25.2M-splat pool.
// With extended paged splats, that former base allocation alone reserved
// roughly 768 MiB across the packed/extended CPU texture arrays.
const MAX_PAGED_SPLATS = 8_388_608;
// Cap depth sorting to the 60 Hz gameplay target while moving. On 120/144 Hz
// displays the old zero interval could sort millions of splats every refresh.
// When the view is stable we relax toward ~36 Hz sorts without cutting the
// 2.5M high-quality LoD budget.
const MIN_SORT_INTERVAL_MS = 16;
const STABLE_SORT_INTERVAL_MS = 33;
const MOVING_LOD_RENDER_SCALE = 0.82;
// Pager records only need to stay newer than Spark's cleanup window. Touching
// every room from every gameplay frame needlessly walks all resident LoD
// records (and was done twice on ownership fast-path frames).
const RESIDENT_PAGER_TOUCH_INTERVAL_MS = 250;
const LOD_FETCHERS = 3;
// A root page alone is enough to prove the stream is attached, but it is not
// enough to fill a doorway. Require a small, stable visible mapping before a
// room may take ownership of the gameplay camera.
const MIN_HANDOFF_ACTIVE_SPLATS = 10_000;
const HANDOFF_READY_STABLE_MS = 100;
// RAD traversal keeps discovering finer chunks as pages arrive, so 100%
// coverage is a moving target and can hold a visually complete doorway closed
// forever. A stable 10K+ live mapping plus coarse requested-page coverage is
// sufficient to eliminate clear-color holes; detail continues refining after
// the handoff.
const HANDOFF_REQUIRED_CHUNK_COVERAGE = 0.1;
// Keep the look-direction cone at full LoD while allowing Spark to spend less
// paging/sort weight on peripheral and behind-camera data. The high tier still
// selects up to 2.5M splats; foveation only changes which ones win the budget.
const FULL_DETAIL_CONE_DEGREES = 95;
const FOVEATION_CONE_DEGREES = 145;
/** High keeps the 2.5M delivery target; medium/low trade density for frame time. */
const QUALITY_LOD_PRESETS = {
  high: {
    lodSplatCount: DELIVERY_LOD_SPLAT_COUNT,
    lodRenderScale: 1,
    coneFov0: FULL_DETAIL_CONE_DEGREES,
    coneFov: FOVEATION_CONE_DEGREES,
    coneFoveate: 0.78,
    behindFoveate: 0.48,
    focalAdjustment: 1.15,
    blurAmount: 0.1,
  },
  medium: {
    lodSplatCount: 1_200_000,
    lodRenderScale: 0.9,
    coneFov0: 95,
    coneFov: 140,
    coneFoveate: 0.75,
    behindFoveate: 0.45,
    focalAdjustment: 1.15,
    blurAmount: 0.12,
  },
  low: {
    lodSplatCount: 700_000,
    lodRenderScale: 0.8,
    coneFov0: 85,
    coneFov: 125,
    coneFoveate: 0.8,
    behindFoveate: 0.5,
    focalAdjustment: 1.1,
    blurAmount: 0.1,
  },
} as const;
export type MintSplatQualityTier = keyof typeof QUALITY_LOD_PRESETS;
let appliedSplatQualityTier: MintSplatQualityTier = 'high';
let analysisSplatBudgetOverride: number | null = null;
let appliedSortIntervalMs = MIN_SORT_INTERVAL_MS;
let lastResidentPagerTouchMs = Number.NEGATIVE_INFINITY;
const cutPrepareCameraPosition = new THREE.Vector3(
  Number.POSITIVE_INFINITY,
  0,
  Number.POSITIVE_INFINITY,
);
const cutPrepareCameraQuaternion = new THREE.Quaternion();
let cutPrepareForce = true;
let sharedSpark: SparkRenderer | null = null;
/**
 * Isolated scene for the FP viewmodel overlay pass.
 * Must never contain Spark — a second `renderer.render(gameplayScene)` lets
 * Spark publish an empty display and leaves subsequent frames on clear color.
 */
export const fpViewmodelOverlayScene = new THREE.Scene();
/** @deprecated Use fpViewmodelOverlayScene */
export const emptyOverlayScene = fpViewmodelOverlayScene;
let sharedPortalSpark: SparkRenderer | null = null;
let sharedSparkScene: THREE.Scene | null = null;
let sharedSparkReferences = 0;
let sharedSparkPendingLoads = 0;
let continuousPortalCompositeFrames = 0;
let continuousPortalFallbackFrames = 0;
let continuousPortalBehindActiveSplats = 0;
let continuousPortalBehindSourceSplats = 0;
let continuousPortalBehindMappings: Array<{
  name: string;
  count: number;
}> = [];
let continuousPortalDestinationId: string | null = null;
let continuousPortalDestinationReady = false;
let activeSplatCutVolumes: SplatCutVolume[] = [];
let activeSplatTrimPlanes: SplatTrimPlane[] = [];
let activeSplatRenderOwnerId: string | null = null;
let activeSplatRenderSecondaryId: string | null = null;
let activeSplatRenderTertiaryId: string | null = null;
let viewIsCurrentlyMoving = false;
const roomMovingLodScales = new Map<string, number>();
const splatByRoomId = new Map<string, SplatMesh>();
const portalLayers = new Set<MintWorldLayer>();
const portalCamera = new THREE.PerspectiveCamera();
const handoffSortCamera = new THREE.PerspectiveCamera(82, 16 / 9, 0.06, 280);
const portalSparseCaptureBackdrop = new THREE.Color(0x34423f);
const portalScissorPrevious = new THREE.Vector4();
const portalScissorDrawingBuffer = new THREE.Vector2();
const portalScissorCorner = new THREE.Vector3();
const portalScissorRect = new THREE.Vector4();
const portalPreviousClearColor = new THREE.Color();
export const MINT_PRIMARY_SPLAT_LAYER = 28;
handoffSortCamera.layers.enable(MINT_PRIMARY_SPLAT_LAYER);
const CONTINUOUS_PORTAL_LAYER = 29;

const CONTINUOUS_PORTAL_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

#include <splatDefines>

uniform float near;
uniform float far;
uniform mat4 projectionMatrix;
uniform bool encodeLinear;
uniform float time;
uniform bool debugFlag;
uniform float maxStdDev;
uniform float minAlpha;
uniform bool disableFalloff;
uniform float falloff;

uniform vec3 portalCenter;
uniform vec3 portalNormal;
uniform vec3 portalRight;
uniform vec3 portalUp;
uniform vec2 portalHalfSize;
uniform int portalPass;

// Zombies keeps its owner and up to two prefetched neighbors in one Spark
// display. Visibility is selected here instead of baking alpha into each
// SplatMesh, so an ownership flip does not regenerate and temporarily discard
// the already-warmed destination mapping.
uniform int renderOwnerFilterEnabled;
uniform int renderOwnerBase;
uniform int renderOwnerCount;
uniform int renderSecondaryBase;
uniform int renderSecondaryCount;
uniform int renderTertiaryBase;
uniform int renderTertiaryCount;

const int MAX_SPLAT_CUTS = 16;
uniform int cutCount;
uniform vec3 cutCenters[MAX_SPLAT_CUTS];
uniform vec3 cutAxesX[MAX_SPLAT_CUTS];
uniform vec3 cutAxesY[MAX_SPLAT_CUTS];
uniform vec3 cutAxesZ[MAX_SPLAT_CUTS];
uniform vec3 cutHalfSizes[MAX_SPLAT_CUTS];
uniform float cutFloorGuards[MAX_SPLAT_CUTS];
uniform int cutOwnerBases[MAX_SPLAT_CUTS];
uniform int cutOwnerCounts[MAX_SPLAT_CUTS];

const int MAX_SPLAT_TRIMS = 8;
uniform int trimCount;
uniform vec3 trimCenters[MAX_SPLAT_TRIMS];
uniform vec3 trimNormals[MAX_SPLAT_TRIMS];
uniform float trimKeepSigns[MAX_SPLAT_TRIMS];
uniform int trimOwnerBases[MAX_SPLAT_TRIMS];
uniform int trimOwnerCounts[MAX_SPLAT_TRIMS];

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in uint vSplatIndex;
flat in float adjustedStdDev;

// DEBUG_SPLAT_PAINT=1 forces opaque splat color so we can tell whether Spark
// is compositing at all versus our owner/cut/portal discards emptying the frame.
uniform int debugSplatPaint;

void main() {
  if (debugSplatPaint != 0) {
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
  int renderSourceIndex = int(vSplatIndex);
  bool renderInOwner = true;
  bool renderInSecondary = false;
  bool renderInTertiary = false;
  if (renderOwnerFilterEnabled != 0) {
    renderInOwner =
      renderOwnerCount > 0 &&
      renderSourceIndex >= renderOwnerBase &&
      renderSourceIndex < renderOwnerBase + renderOwnerCount;
    renderInSecondary =
      renderSecondaryCount > 0 &&
      renderSourceIndex >= renderSecondaryBase &&
      renderSourceIndex < renderSecondaryBase + renderSecondaryCount;
    renderInTertiary =
      renderTertiaryCount > 0 &&
      renderSourceIndex >= renderTertiaryBase &&
      renderSourceIndex < renderTertiaryBase + renderTertiaryCount;
    if (!renderInOwner && !renderInSecondary && !renderInTertiary) discard;
  }
  vec3 viewDir = normalize(vec3(
    vNdc.x / projectionMatrix[0][0],
    vNdc.y / projectionMatrix[1][1],
    -1.0
  ));
  float ndcZ = vNdc.z;
  float depth =
    (2.0 * near * far) / (far + near - ndcZ * (far - near));
  float rayT = depth / max(1e-6, -viewDir.z);
  vec3 viewPosition = viewDir * rayT;

  for (int cutIndex = 0; cutIndex < MAX_SPLAT_CUTS; cutIndex++) {
    if (cutIndex >= cutCount) break;
    int sourceIndex = int(vSplatIndex);
    int ownerBase = cutOwnerBases[cutIndex];
    int ownerCount = cutOwnerCounts[cutIndex];
    if (
      ownerCount <= 0 ||
      sourceIndex < ownerBase ||
      sourceIndex >= ownerBase + ownerCount
    ) continue;
    vec3 cutOffset = viewPosition - cutCenters[cutIndex];
    vec3 cutLocal = vec3(
      dot(cutOffset, cutAxesX[cutIndex]),
      dot(cutOffset, cutAxesY[cutIndex]),
      dot(cutOffset, cutAxesZ[cutIndex])
    );
    // Raise the effective aperture off the floor so thick floor gaussians
    // inside the OBB are kept. Cuts open walls, not the walkable plate.
    vec3 halfSize = cutHalfSizes[cutIndex];
    float floorGuard = min(
      cutFloorGuards[cutIndex],
      max(0.0, halfSize.y * 0.85)
    );
    float minLocalY = -halfSize.y + floorGuard;
    if (
      abs(cutLocal.x) <= halfSize.x &&
      cutLocal.y >= minLocalY &&
      cutLocal.y <= halfSize.y &&
      abs(cutLocal.z) <= halfSize.z
    ) {
      discard;
    }
  }

  for (int trimIndex = 0; trimIndex < MAX_SPLAT_TRIMS; trimIndex++) {
    if (trimIndex >= trimCount) break;
    int sourceIndex = int(vSplatIndex);
    int ownerBase = trimOwnerBases[trimIndex];
    int ownerCount = trimOwnerCounts[trimIndex];
    if (
      ownerCount <= 0 ||
      sourceIndex < ownerBase ||
      sourceIndex >= ownerBase + ownerCount
    ) continue;
    float distanceToPlane = dot(
      viewPosition - trimCenters[trimIndex],
      trimNormals[trimIndex]
    ) * trimKeepSigns[trimIndex];
    if (distanceToPlane < 0.0) discard;
  }

  if (portalPass != 0) {
    vec3 normal = normalize(portalNormal);
    float denom = dot(viewDir, normal);
    bool hitsDoor = false;
    float doorT = 0.0;
    if (abs(denom) > 1e-6) {
      doorT = dot(portalCenter, normal) / denom;
      if (doorT > 0.0 || (portalPass == 4 && doorT > -0.45)) {
        // Keep the aperture continuous while the eye crosses its physical
        // plane. Without this thickness, doorT reaches zero for one frame and
        // restores the wall exactly at the seam.
        doorT = max(0.02, doorT);
        vec3 hitOffset = doorT * viewDir - portalCenter;
        hitsDoor =
          abs(dot(hitOffset, normalize(portalRight))) <= portalHalfSize.x &&
          abs(dot(hitOffset, normalize(portalUp))) <= portalHalfSize.y;
      }
    }

    float eps = 1e-4 * max(1.0, abs(doorT));
    if (portalPass == 4) {
      if (renderInSecondary) {
        if (!hitsDoor || rayT <= doorT + eps) discard;
      } else if (hitsDoor && rayT >= doorT - eps) {
        discard;
      }
    } else if (portalPass > 2) {
      discard;
    } else if (portalPass > 1) {
      if (!hitsDoor || rayT <= doorT + eps) discard;
    } else if (portalPass > 0) {
      if (!hitsDoor || rayT <= doorT + eps) discard;
    } else if (hitsDoor && rayT >= doorT - eps) {
      discard;
    }
  }

  vec4 rgba = vRgba;
  float z2 = dot(vSplatUv, vSplatUv);
  if (z2 > (adjustedStdDev * adjustedStdDev)) discard;

  float a = rgba.a;
  float shifted = sqrt(z2) - max(0.0, a - 1.0);
  float exponent = -0.5 * max(1.0, a) * sqr(max(0.0, shifted));
  rgba.a = min(1.0, a) * exp(exponent);

  if (rgba.a < minAlpha) discard;
  if (encodeLinear) rgba.rgb = srgbToLinear(rgba.rgb);
  #ifdef PREMULTIPLIED_ALPHA
    fragColor = vec4(rgba.rgb * rgba.a, rgba.a);
  #else
    fragColor = rgba;
  #endif
}
`;

type PortalShaderUniforms = {
  portalCenter: { value: THREE.Vector3 };
  portalNormal: { value: THREE.Vector3 };
  portalRight: { value: THREE.Vector3 };
  portalUp: { value: THREE.Vector3 };
  portalHalfSize: { value: THREE.Vector2 };
  portalPass: { value: number };
  renderOwnerFilterEnabled: { value: number };
  renderOwnerBase: { value: number };
  renderOwnerCount: { value: number };
  renderSecondaryBase: { value: number };
  renderSecondaryCount: { value: number };
  renderTertiaryBase: { value: number };
  renderTertiaryCount: { value: number };
};

type CutShaderUniforms = {
  cutCount: { value: number };
  cutCenters: { value: THREE.Vector3[] };
  cutAxesX: { value: THREE.Vector3[] };
  cutAxesY: { value: THREE.Vector3[] };
  cutAxesZ: { value: THREE.Vector3[] };
  cutHalfSizes: { value: THREE.Vector3[] };
  cutFloorGuards: { value: Float32Array };
  cutOwnerBases: { value: Int32Array };
  cutOwnerCounts: { value: Int32Array };
  trimCount: { value: number };
  trimCenters: { value: THREE.Vector3[] };
  trimNormals: { value: THREE.Vector3[] };
  trimKeepSigns: { value: Float32Array };
  trimOwnerBases: { value: Int32Array };
  trimOwnerCounts: { value: Int32Array };
};

export type MintContinuousSplatAperture = {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  halfWidth: number;
  halfHeight: number;
};

export type MintContinuousSplatPortal = MintContinuousSplatAperture & {
  destinationAperture: MintContinuousSplatAperture;
  destinationCameraPosition: THREE.Vector3;
  destinationCameraQuaternion: THREE.Quaternion;
  lodCameraPosition: THREE.Vector3;
  lodCameraQuaternion: THREE.Quaternion;
  lodSplatCount: number;
};

function portalUniforms(): PortalShaderUniforms &
  CutShaderUniforms & { debugSplatPaint: { value: number } } {
  const cutVectors = () =>
    Array.from(
      { length: MAX_SPLAT_CUT_VOLUMES },
      () => new THREE.Vector3(),
    );
  const trimVectors = () =>
    Array.from(
      { length: MAX_SPLAT_TRIM_PLANES },
      () => new THREE.Vector3(),
    );
  return {
    portalCenter: { value: new THREE.Vector3() },
    portalNormal: { value: new THREE.Vector3(0, 0, 1) },
    portalRight: { value: new THREE.Vector3(1, 0, 0) },
    portalUp: { value: new THREE.Vector3(0, 1, 0) },
    portalHalfSize: { value: new THREE.Vector2(1, 1.2) },
    portalPass: { value: 0 },
    renderOwnerFilterEnabled: { value: 0 },
    renderOwnerBase: { value: 0 },
    renderOwnerCount: { value: 0 },
    renderSecondaryBase: { value: 0 },
    renderSecondaryCount: { value: 0 },
    renderTertiaryBase: { value: 0 },
    renderTertiaryCount: { value: 0 },
    cutCount: { value: 0 },
    cutCenters: { value: cutVectors() },
    cutAxesX: { value: cutVectors() },
    cutAxesY: { value: cutVectors() },
    cutAxesZ: { value: cutVectors() },
    cutHalfSizes: { value: cutVectors() },
    cutFloorGuards: { value: new Float32Array(MAX_SPLAT_CUT_VOLUMES) },
    cutOwnerBases: { value: new Int32Array(MAX_SPLAT_CUT_VOLUMES) },
    cutOwnerCounts: { value: new Int32Array(MAX_SPLAT_CUT_VOLUMES) },
    trimCount: { value: 0 },
    trimCenters: { value: trimVectors() },
    trimNormals: { value: trimVectors() },
    trimKeepSigns: { value: new Float32Array(MAX_SPLAT_TRIM_PLANES) },
    trimOwnerBases: { value: new Int32Array(MAX_SPLAT_TRIM_PLANES) },
    trimOwnerCounts: { value: new Int32Array(MAX_SPLAT_TRIM_PLANES) },
    debugSplatPaint: { value: 0 },
  };
}

function setPortalShader(
  spark: SparkRenderer,
  camera: THREE.Camera,
  portal: MintContinuousSplatAperture,
  pass: -1 | 0 | 1 | 2 | 3 | 4,
): void {
  const uniforms = spark.uniforms as typeof spark.uniforms &
    PortalShaderUniforms;
  uniforms.portalPass.value = pass;
  if (pass === 0) return;
  camera.updateMatrixWorld(true);
  const worldToView = camera.matrixWorldInverse;
  uniforms.portalCenter.value
    .copy(portal.center)
    .applyMatrix4(worldToView);
  uniforms.portalNormal.value
    .copy(portal.normal)
    .transformDirection(worldToView);
  uniforms.portalRight.value
    .copy(portal.right)
    .transformDirection(worldToView);
  uniforms.portalUp.value
    .copy(portal.up)
    .transformDirection(worldToView);
  uniforms.portalHalfSize.value.set(
    portal.halfWidth,
    portal.halfHeight,
  );
}

function splatOwnerRange(
  spark: SparkRenderer,
  roomId: string,
): { base: number; count: number } {
  const owner = splatByRoomId.get(roomId);
  const mapping = owner
    ? spark.display.mapping.find((entry) => entry.node === owner)
    : undefined;
  return mapping
    ? { base: mapping.base, count: mapping.count }
    : { base: 0, count: 0 };
}

let lastShaderOwnerId: string | null = null;

function setRenderOwnerShader(
  spark: SparkRenderer,
  ownerId: string | null,
  secondaryId: string | null,
  retainPreviousOwner = false,
  tertiaryId: string | null = null,
): boolean {
  const uniforms = spark.uniforms as typeof spark.uniforms &
    PortalShaderUniforms;
  if (!ownerId) {
    uniforms.renderOwnerFilterEnabled.value = 0;
    uniforms.renderOwnerBase.value = 0;
    uniforms.renderOwnerCount.value = 0;
    uniforms.renderSecondaryBase.value = 0;
    uniforms.renderSecondaryCount.value = 0;
    uniforms.renderTertiaryBase.value = 0;
    uniforms.renderTertiaryCount.value = 0;
    lastShaderOwnerId = null;
    return true;
  }
  const ownerRange = splatOwnerRange(spark, ownerId);
  // A cold owner should never turn a complete source frame into a clear
  // frame — but only retain the previous range when it belongs to the SAME
  // owner. Retaining another room's index range (campus → Maps, or hub →
  // neighbor) discards every splat and leaves the clear-color void.
  if (ownerRange.count <= 0) {
    if (
      retainPreviousOwner &&
      lastShaderOwnerId === ownerId &&
      uniforms.renderOwnerCount.value > 0
    ) {
      return false;
    }
    uniforms.renderOwnerFilterEnabled.value = 0;
    uniforms.renderOwnerBase.value = 0;
    uniforms.renderOwnerCount.value = 0;
    uniforms.renderSecondaryBase.value = 0;
    uniforms.renderSecondaryCount.value = 0;
    uniforms.renderTertiaryBase.value = 0;
    uniforms.renderTertiaryCount.value = 0;
    return false;
  }
  const secondaryRange = secondaryId
    ? splatOwnerRange(spark, secondaryId)
    : { base: 0, count: 0 };
  const tertiaryRange = tertiaryId
    ? splatOwnerRange(spark, tertiaryId)
    : { base: 0, count: 0 };
  uniforms.renderOwnerFilterEnabled.value = 1;
  uniforms.renderOwnerBase.value = ownerRange.base;
  uniforms.renderOwnerCount.value = ownerRange.count;
  uniforms.renderSecondaryBase.value = secondaryRange.base;
  uniforms.renderSecondaryCount.value = secondaryRange.count;
  uniforms.renderTertiaryBase.value = tertiaryRange.base;
  uniforms.renderTertiaryCount.value = tertiaryRange.count;
  lastShaderOwnerId = ownerId;
  return true;
}

function setCutShader(
  spark: SparkRenderer,
  camera: THREE.Camera,
  cuts: readonly SplatCutVolume[],
  trims: readonly SplatTrimPlane[],
): void {
  const uniforms = spark.uniforms as typeof spark.uniforms & CutShaderUniforms;
  const active = cuts
    .filter((cut) => cut.enabled)
    .slice(0, MAX_SPLAT_CUT_VOLUMES);
  uniforms.cutCount.value = active.length;
  camera.updateMatrixWorld(true);
  const worldToView = camera.matrixWorldInverse;
  const quaternion = new THREE.Quaternion();
  for (let index = 0; index < MAX_SPLAT_CUT_VOLUMES; index += 1) {
    const cut = active[index];
    if (!cut) {
      uniforms.cutHalfSizes.value[index]!.set(0, 0, 0);
      uniforms.cutFloorGuards.value[index] = 0;
      uniforms.cutOwnerCounts.value[index] = 0;
      continue;
    }
    const range = splatOwnerRange(spark, cut.roomId);
    uniforms.cutOwnerBases.value[index] = range.base;
    uniforms.cutOwnerCounts.value[index] = range.count;
    quaternion.setFromEuler(new THREE.Euler(...cut.rotation));
    uniforms.cutCenters.value[index]!
      .set(...cut.position)
      .applyMatrix4(worldToView);
    uniforms.cutAxesX.value[index]!
      .set(1, 0, 0)
      .applyQuaternion(quaternion)
      .transformDirection(worldToView);
    uniforms.cutAxesY.value[index]!
      .set(0, 1, 0)
      .applyQuaternion(quaternion)
      .transformDirection(worldToView);
    uniforms.cutAxesZ.value[index]!
      .set(0, 0, 1)
      .applyQuaternion(quaternion)
      .transformDirection(worldToView);
    uniforms.cutHalfSizes.value[index]!
      .set(...cut.size)
      .multiplyScalar(0.5);
    uniforms.cutFloorGuards.value[index] = CUT_FLOOR_SHADER_GUARD;
  }
  const activeTrims = trims
    .filter((trim) => trim.enabled)
    .slice(0, MAX_SPLAT_TRIM_PLANES);
  uniforms.trimCount.value = activeTrims.length;
  for (let index = 0; index < MAX_SPLAT_TRIM_PLANES; index += 1) {
    const trim = activeTrims[index];
    if (!trim) {
      uniforms.trimOwnerCounts.value[index] = 0;
      continue;
    }
    const range = splatOwnerRange(spark, trim.roomId);
    uniforms.trimOwnerBases.value[index] = range.base;
    uniforms.trimOwnerCounts.value[index] = range.count;
    uniforms.trimCenters.value[index]!
      .set(...trim.position)
      .applyMatrix4(worldToView);
    uniforms.trimNormals.value[index]!
      .copy(trimPlaneNormal(trim))
      .transformDirection(worldToView);
    uniforms.trimKeepSigns.value[index] =
      trim.keepSide === 'positive' ? 1 : -1;
  }
}

function refreshCutOwnerRanges(
  spark: SparkRenderer,
  cuts: readonly SplatCutVolume[],
  trims: readonly SplatTrimPlane[],
): void {
  const uniforms = spark.uniforms as typeof spark.uniforms & CutShaderUniforms;
  const activeCuts = cuts
    .filter((cut) => cut.enabled)
    .slice(0, MAX_SPLAT_CUT_VOLUMES);
  for (let index = 0; index < MAX_SPLAT_CUT_VOLUMES; index += 1) {
    const cut = activeCuts[index];
    const range = cut
      ? splatOwnerRange(spark, cut.roomId)
      : { base: 0, count: 0 };
    uniforms.cutOwnerBases.value[index] = range.base;
    uniforms.cutOwnerCounts.value[index] = range.count;
  }
  const activeTrims = trims
    .filter((trim) => trim.enabled)
    .slice(0, MAX_SPLAT_TRIM_PLANES);
  for (let index = 0; index < MAX_SPLAT_TRIM_PLANES; index += 1) {
    const trim = activeTrims[index];
    const range = trim
      ? splatOwnerRange(spark, trim.roomId)
      : { base: 0, count: 0 };
    uniforms.trimOwnerBases.value[index] = range.base;
    uniforms.trimOwnerCounts.value[index] = range.count;
  }
}

function ensurePortalSparkRenderer(frontSpark: SparkRenderer): SparkRenderer {
  if (sharedPortalSpark) return sharedPortalSpark;
  sharedPortalSpark = new SparkRenderer({
    renderer: frontSpark.renderer,
    enableLod: true,
    enableDriveLod: false,
    lodSplatCount: Math.min(
      PORTAL_LOD_SPLAT_COUNT,
      frontSpark.lodSplatCount ?? DELIVERY_LOD_SPLAT_COUNT,
    ),
    lodRenderScale: 1,
    minSortIntervalMs: MIN_SORT_INTERVAL_MS,
    coneFov0: FULL_DETAIL_CONE_DEGREES,
    coneFov: FOVEATION_CONE_DEGREES,
    coneFoveate: 0.55,
    behindFoveate: 0.2,
    focalAdjustment: 1.35,
    blurAmount: 0.15,
    sortRadial: false,
    accumExtSplats: true,
    pagedExtSplats: true,
    maxPagedSplats: MAX_PAGED_SPLATS,
    numLodFetchers: LOD_FETCHERS,
    extraUniforms: portalUniforms(),
    fragmentShader: CONTINUOUS_PORTAL_FRAGMENT_SHADER,
  });
  sharedPortalSpark.name = 'mint-world-continuous-portal-renderer';
  return sharedPortalSpark;
}

export type MintSplatRenderState =
  | 'primary'
  | 'portal'
  | 'prefetch'
  | 'resident'
  | 'hidden';

export type MintWorldProgress = {
  progress: number;
  label: string;
};

export type MintWorldSplatDiagnostics = {
  id: string;
  integrationMode: 'remote_stream';
  runtimeUrl: string;
  colliderUrl: string;
  sourceKind: 'Spark SplatMesh / paged RAD';
  isSplatMesh: true;
  initialized: boolean;
  paged: boolean;
  pagerAttached: boolean;
  lodTreeRegistered: boolean;
  rootPageResident: boolean;
  rootPageWarmed: boolean;
  activeSplats: number;
  selectedSplats: number;
  mappedSplats: number;
  requestedChunks: number;
  residentRequestedChunks: number;
  missingRequestedChunks: number;
  handoffReady: boolean;
  portalLodInstanceReady: boolean;
  renderState: MintSplatRenderState;
  rootVisible: boolean;
  splatVisible: boolean;
  splatOpacity: number;
  colliderRootVisible: boolean;
  colliderMeshCount: number;
  physicsColliderCount: number;
  visibleColliderMeshes: number;
  visualFallbackActive: false;
};

export type MintWorldLoadOptions = {
  /** When false, collision can be registered after the authored transform. */
  registerCollision?: boolean;
  /**
   * Skip the World Labs collider GLB download/decode. Use for release-ready
   * Zombies rooms that navigate on authored surfaces and never register the
   * dense trimesh. Bounds come from the initialized splat instead.
   */
  skipCollider?: boolean;
};

export type MintWorldColliderHit = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};

export type MintWorldSurfaceKind = 'wall' | 'floor';

export type MintWorldSurfaceRequest = {
  id: string;
  reference: THREE.Vector3;
  kind: MintWorldSurfaceKind;
  maxDistance: number;
};

export class MintWorldLayer {
  readonly root: THREE.Group;
  readonly bounds: THREE.Box3;
  private readonly basePosition = new THREE.Vector3();
  private readonly baseRotation = new THREE.Euler();
  private readonly baseScale = new THREE.Vector3(1, 1, 1);
  private readonly colliderBvhs = new Map<THREE.BufferGeometry, MeshBVH>();
  private renderState: MintSplatRenderState = 'hidden';
  private handoffPrefetchVisible = false;
  private rootPageWarmed = false;
  private handoffReadySince = 0;
  private handoffReadyLatched = false;
  private collisionEnabled = true;
  private cutVolumes: SplatCutVolume[] = [];
  private trimPlanes: SplatTrimPlane[] = [];

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly world: MintWorldRecord,
    private readonly splat: SplatMesh,
    private readonly collider: THREE.Group,
    private physicsColliders: Collider[],
    root: THREE.Group,
    bounds: THREE.Box3,
    private readonly colliderMeshCount: number,
  ) {
    this.root = root;
    this.bounds = bounds;
    this.basePosition.copy(root.position);
    this.baseRotation.copy(root.rotation);
    this.baseScale.copy(root.scale);
    portalLayers.add(this);
  }

  static async load(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    physics: PhysicsWorld,
    world: MintWorldRecord,
    onProgress: (event: MintWorldProgress) => void,
    options: MintWorldLoadOptions = {},
  ): Promise<MintWorldLayer> {
    const registerCollision = options.registerCollision ?? true;
    onProgress({ progress: 0.04, label: 'Opening World Labs RAD stream' });
    if (!sharedSpark) {
      const qualityPreset = QUALITY_LOD_PRESETS[appliedSplatQualityTier];
      sharedSpark = new SparkRenderer({
        renderer,
        enableLod: true,
        // The former 300K / 2px / heavy-foveation budget made overlapping
        // world captures read as one soft Gaussian field. Preserve the RAD
        // source detail across the whole gameplay frame on the high tier.
        lodSplatCount:
          analysisSplatBudgetOverride ?? qualityPreset.lodSplatCount,
        lodRenderScale: qualityPreset.lodRenderScale,
        minSortIntervalMs: appliedSortIntervalMs,
        coneFov0: qualityPreset.coneFov0,
        coneFov: qualityPreset.coneFov,
        coneFoveate: qualityPreset.coneFoveate,
        behindFoveate: qualityPreset.behindFoveate,
        focalAdjustment: qualityPreset.focalAdjustment,
        blurAmount: qualityPreset.blurAmount,
        sortRadial: false,
        // Keep paged RAD pages and the intermediary accumulator in EXT encoding
        // together. Mismatched formats decode to zero-alpha centers and the
        // vertex shader culls every instance (resident counters stay healthy).
        accumExtSplats: true,
        pagedExtSplats: true,
        maxPagedSplats: MAX_PAGED_SPLATS,
        // Spark's worker pool has four threads. The documented value of three
        // leaves one available for loading/decoding instead of starving it.
        numLodFetchers: LOD_FETCHERS,
        extraUniforms: portalUniforms(),
        fragmentShader: CONTINUOUS_PORTAL_FRAGMENT_SHADER,
      });
      // Spark 2.1 disposes the least-recently-touched LoD tree after three
      // seconds. A software-WebGL traversal/sort can itself exceed that
      // interval, causing the active tree to be collected before the next
      // game frame can refresh it; the cached RAD root then remains stuck at
      // one splat because its tree payload is not replayed. This renderer owns
      // a fixed six-room campus, so retain those tiny tree records and let the
      // existing bounded 8.39M SplatPager continue to LRU-evict page data.
      const fixedCampusSpark = sharedSpark as unknown as {
        cleanupLodTrees(): Promise<void>;
      };
      fixedCampusSpark.cleanupLodTrees = async () => undefined;
      sharedSpark.name = 'mint-world-spark-renderer';
      // The primary Spark mesh also participates in the isolated portal
      // camera pass. Ordinary gameplay meshes stay on layer 0 and therefore
      // cannot leak into that virtual destination view.
      sharedSpark.layers.enable(CONTINUOUS_PORTAL_LAYER);
      sharedSparkScene = scene;
      scene.add(sharedSpark);
    }
    const spark = sharedSpark;
    sharedSparkPendingLoads += 1;

    const placement = world.placement ?? {
      position: [0, WORLD_Y, 0] as [number, number, number],
      rotation: WORLD_ROTATION,
      scale: WORLD_SCALE,
    };
    const root = new THREE.Group();
    root.name = `mint-world-${world.id}`;
    root.position.set(...placement.position);
    root.rotation.set(...placement.rotation);
    root.scale.setScalar(placement.scale);
    root.visible = false;
    scene.add(root);

    const splat = createPagedRadSplat({
      url: world.runtime.runtimeUrl,
      raycastable: false,
      onFrame: () => {},
      onProgress: (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        const ratio = THREE.MathUtils.clamp(event.loaded / event.total, 0, 1);
        onProgress({
          progress: 0.06 + ratio * 0.54,
          label: 'Streaming World Labs environment',
        });
      },
    });
    splat.name = `mint-world-rad:${world.id}`;
    splatByRoomId.set(world.id, splat);
    splat.layers.set(MINT_PRIMARY_SPLAT_LAYER);
    root.add(splat);

    try {
      const skipCollider = options.skipCollider === true;
      let collider: THREE.Group;
      let physicsColliders: Collider[] = [];
      let colliderMeshCount = 0;
      let bounds: THREE.Box3;

      if (skipCollider) {
        await splat.initialized;
        onProgress({
          progress: 0.84,
          label: 'Measuring splat bounds (collider deferred)',
        });
        root.updateMatrixWorld(true);
        bounds = new THREE.Box3().setFromObject(splat);
        if (bounds.isEmpty()) {
          // Authored placement fallback when the pager has not expanded yet.
          const extent = Math.max(8, placement.scale * 6);
          bounds = new THREE.Box3(
            new THREE.Vector3(-extent, -2, -extent).add(root.position),
            new THREE.Vector3(extent, 6, extent).add(root.position),
          );
        }
        collider = new THREE.Group();
        collider.name = 'mint-world-collider-deferred';
        root.add(collider);
      } else {
        const colliderPromise = new GLTFLoader().loadAsync(
          world.runtime.collider.runtimeUrl,
          (event) => {
            if (!event.lengthComputable || event.total <= 0) return;
            const ratio = THREE.MathUtils.clamp(event.loaded / event.total, 0, 1);
            onProgress({
              progress: 0.6 + ratio * 0.2,
              label: 'Loading World Labs collider',
            });
          },
        );
        const [, colliderGltf] = await Promise.all([
          splat.initialized,
          colliderPromise,
        ]);
        collider = colliderGltf.scene;
        collider.name = 'mint-world-collider';
        root.add(collider);
        root.updateMatrixWorld(true);

        onProgress({
          progress: 0.84,
          label: registerCollision
            ? 'Registering world collision'
            : 'Measuring world bounds',
        });
        collider.traverse((object) => {
          if (object instanceof THREE.Mesh) colliderMeshCount += 1;
        });
        if (colliderMeshCount === 0) {
          throw new Error(
            'World Labs collider contains no usable triangle meshes.',
          );
        }
        if (registerCollision) {
          physicsColliders = physics.addTrimeshSceneColliders(
            collider,
            `mint-world:${world.id}`,
            world.role === 'zombies'
              ? ZOMBIES_SOURCE_COLLISION_GROUPS
              : undefined,
          );
          if (physicsColliders.length === 0) {
            throw new Error(
              'World Labs collider contains no usable triangle meshes.',
            );
          }
        }

        bounds = new THREE.Box3().setFromObject(collider);
        if (bounds.isEmpty()) {
          throw new Error('World Labs collider has empty bounds.');
        }
        collider.traverse((object) => {
          object.visible = false;
        });
      }
      if (!splat.paged) {
        throw new Error(
          'World Labs RAD source is unavailable for portal rendering.',
        );
      }
      onProgress({ progress: 1, label: 'World Labs environment ready' });
      sharedSparkReferences += 1;
      sharedSparkPendingLoads = Math.max(0, sharedSparkPendingLoads - 1);
      return new MintWorldLayer(
        scene,
        physics,
        world,
        splat,
        collider,
        physicsColliders,
        root,
        bounds,
        colliderMeshCount,
      );
    } catch (error) {
      sharedSparkPendingLoads = Math.max(0, sharedSparkPendingLoads - 1);
      root.remove(splat);
      scene.remove(root);
      splat.dispose();
      if (splatByRoomId.get(world.id) === splat) {
        splatByRoomId.delete(world.id);
      }
      if (
        sharedSpark === spark &&
        sharedSparkReferences === 0 &&
        sharedSparkPendingLoads === 0
      ) {
        scene.remove(spark);
        spark.dispose();
        if (sharedPortalSpark) {
          scene.remove(sharedPortalSpark);
          sharedPortalSpark.dispose();
          sharedPortalSpark = null;
        }
        sharedSpark = null;
        sharedSparkScene = null;
      }
      throw error;
    }
  }

  recomputeBounds(): void {
    this.root.updateMatrixWorld(true);
    this.bounds.setFromObject(this.collider);
  }

  getVisualBounds(target = new THREE.Box3()): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    const local = this.splat.getBoundingBox(false);
    const size = local.getSize(new THREE.Vector3());
    if (
      local.isEmpty() ||
      ![size.x, size.y, size.z].every(Number.isFinite) ||
      size.lengthSq() <= 0.001
    ) {
      return target.makeEmpty();
    }
    return target.copy(local).applyMatrix4(this.splat.matrixWorld);
  }

  getColliderBounds(target = new THREE.Box3()): THREE.Box3 {
    this.recomputeBounds();
    return target.copy(this.bounds);
  }

  get colliderCount(): number {
    return this.physicsColliders.length;
  }

  /** Invisible World Labs collider root used for runtime navigation bakes. */
  getColliderRoot(): THREE.Group {
    return this.collider;
  }

  /**
   * Bake the collider only after the room's authored splat transform is final.
   * This matches the golf-world flow and avoids registering a partial or
   * manifest-space mesh before room alignment.
   */
  registerCollision(): number {
    // Deferred/skipped colliders have no triangle meshes. Authored navigation
    // owns Zombies containment, so treat this as a no-op instead of throwing.
    if (this.colliderMeshCount === 0) {
      this.unregisterCollision();
      return 0;
    }
    this.unregisterCollision();
    this.root.updateMatrixWorld(true);
    this.physicsColliders = this.physics.addTrimeshSceneColliders(
      this.collider,
      `mint-world:${this.world.id}`,
      this.world.role === 'zombies'
        ? ZOMBIES_SOURCE_COLLISION_GROUPS
        : undefined,
      this.cutVolumes,
      this.trimPlanes,
    );
    if (this.physicsColliders.length === 0) {
      throw new Error(
        `World Labs collider for ${this.world.id} contains no usable triangle meshes.`,
      );
    }
    this.physicsColliders.forEach((collider) =>
      collider.setEnabled(this.collisionEnabled),
    );
    return this.physicsColliders.length;
  }

  unregisterCollision(): void {
    if (this.physicsColliders.length === 0) return;
    this.physics.removeColliders(this.physicsColliders);
    this.physicsColliders = [];
  }

  setCutVolumes(cuts: readonly SplatCutVolume[]): void {
    const next = cuts
      .filter((cut) => cut.roomId === this.world.id && cut.enabled)
      .map((cut) => ({
        ...cut,
        position: [...cut.position] as [number, number, number],
        rotation: [...cut.rotation] as [number, number, number],
        size: [...cut.size] as [number, number, number],
      }));
    if (JSON.stringify(next) === JSON.stringify(this.cutVolumes)) return;
    const rebuildCollision = this.physicsColliders.length > 0;
    this.cutVolumes = next;
    if (rebuildCollision) this.registerCollision();
  }

  setTrimPlanes(trims: readonly SplatTrimPlane[]): void {
    const next = trims
      .filter((trim) => trim.roomId === this.world.id && trim.enabled)
      .map((trim) => ({
        ...trim,
        position: [...trim.position] as [number, number, number],
        rotation: [...trim.rotation] as [number, number, number],
      }));
    if (JSON.stringify(next) === JSON.stringify(this.trimPlanes)) return;
    const rebuildCollision = this.physicsColliders.length > 0;
    this.trimPlanes = next;
    if (rebuildCollision) this.registerCollision();
  }

  /**
   * Query the same transformed source mesh used to build Rapier collision.
   * Placement systems use this to seat wall props on actual reconstructed
   * surfaces instead of trusting rectangular navigation bounds.
   */
  raycastCollider(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): MintWorldColliderHit | null {
    if (
      !Number.isFinite(maxDistance) ||
      maxDistance <= 0 ||
      direction.lengthSq() < 1e-8
    ) {
      return null;
    }
    this.root.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(
      origin,
      direction.clone().normalize(),
      0,
      maxDistance,
    );
    const meshes: THREE.Mesh[] = [];
    const materialSides = new Map<THREE.Material, THREE.Side>();
    this.collider.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes.push(object);
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!materialSides.has(material)) {
          materialSides.set(material, material.side);
        }
        material.side = THREE.DoubleSide;
      }
    });
    const hit = raycaster.intersectObjects(meshes, false)[0];
    for (const [material, side] of materialSides) material.side = side;
    if (!hit?.face) return null;
    const normal = hit.face.normal
      .clone()
      .applyMatrix3(
        new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
      )
      .normalize();
    // The prop should face the query origin even when source triangle winding
    // is inconsistent across collider chunks.
    if (normal.dot(direction) > 0) normal.negate();
    return {
      point: hit.point.clone(),
      normal,
      distance: hit.distance,
    };
  }

  /**
   * Find the closest qualified point on a source collider triangle. A geometry
   * BVH keeps the analyzer exact without linearly scanning the generated mesh.
   */
  nearestColliderSurface(
    reference: THREE.Vector3,
    kind: MintWorldSurfaceKind,
    maxDistance: number,
  ): MintWorldColliderHit | null {
    return (
      this.nearestColliderSurfaces([
        { id: 'single', reference, kind, maxDistance },
      ]).get('single') ?? null
    );
  }

  /**
   * Resolve a room's placement requests against cached per-mesh BVHs.
   */
  nearestColliderSurfaces(
    requests: readonly MintWorldSurfaceRequest[],
  ): Map<string, MintWorldColliderHit> {
    const valid = requests.filter(
      (request) =>
        Number.isFinite(request.maxDistance) && request.maxDistance > 0,
    );
    if (valid.length === 0) return new Map();
    this.root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    this.collider.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    const hits = new Map<string, MintWorldColliderHit>();
    const inverse = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    const localReference = new THREE.Vector3();
    const localClosest = new THREE.Vector3();
    const worldClosest = new THREE.Vector3();
    const localNormal = new THREE.Vector3();
    const worldNormal = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (const request of valid) {
      let bestDistance = request.maxDistance;
      let bestPoint: THREE.Vector3 | null = null;
      let bestNormal: THREE.Vector3 | null = null;
      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        if (!position || position.count < 3) continue;
        let bvh = this.colliderBvhs.get(geometry);
        if (!bvh) {
          bvh = new MeshBVH(geometry, {
            strategy: CENTER,
            targetLeafSize: 20,
            verbose: false,
          });
          this.colliderBvhs.set(geometry, bvh);
        }
        inverse.copy(mesh.matrixWorld).invert();
        normalMatrix.getNormalMatrix(mesh.matrixWorld);
        localReference.copy(request.reference).applyMatrix4(inverse);
        scale.setFromMatrixScale(mesh.matrixWorld);
        const worldScale = Math.max(scale.x, scale.y, scale.z, 1e-6);
        bvh.shapecast({
          boundsTraverseOrder: (box) =>
            box.distanceToPoint(localReference),
          intersectsBounds: (box, _isLeaf, score) =>
            (score ?? box.distanceToPoint(localReference)) * worldScale <
            bestDistance,
          intersectsTriangle: (triangle: ExtendedTriangle) => {
            triangle.getNormal(localNormal);
            worldNormal.copy(localNormal).applyMatrix3(normalMatrix).normalize();
            if (
              (request.kind === 'wall' &&
                Math.abs(worldNormal.y) > 0.42) ||
              (request.kind === 'floor' &&
                Math.abs(worldNormal.y) < 0.55)
            ) {
              return false;
            }
            triangle.closestPointToPoint(localReference, localClosest);
            worldClosest.copy(localClosest).applyMatrix4(mesh.matrixWorld);
            const distance = worldClosest.distanceTo(request.reference);
            if (distance >= bestDistance) return false;
            bestDistance = distance;
            bestPoint = worldClosest.clone();
            bestNormal = worldNormal.clone();
            return false;
          },
        });
      }
      if (!bestPoint || !bestNormal) continue;
      const resolvedPoint = bestPoint as THREE.Vector3;
      const resolvedNormal = bestNormal as THREE.Vector3;
      if (request.kind === 'floor') {
        if (resolvedNormal.y < 0) resolvedNormal.negate();
      } else {
        const towardReference = request.reference.clone().sub(resolvedPoint);
        if (resolvedNormal.dot(towardReference) < 0) resolvedNormal.negate();
      }
      hits.set(request.id, {
        point: resolvedPoint,
        normal: resolvedNormal,
        distance: bestDistance,
      });
    }
    return hits;
  }

  /** Restore manifest placement before a fresh world-space alignment. */
  resetTransform(): void {
    const rebuildCollision = this.physicsColliders.length > 0;
    this.root.position.copy(this.basePosition);
    this.root.rotation.copy(this.baseRotation);
    this.root.scale.copy(this.baseScale);
    this.refreshTransform();
    this.recomputeBounds();
    if (rebuildCollision) this.registerCollision();
  }

  applyAuthoredTransform(
    position: readonly [number, number, number],
    rotation: readonly [number, number, number],
    scale: number,
  ): void {
    const rebuildCollision = this.physicsColliders.length > 0;
    this.root.position.set(...position);
    this.root.rotation.set(...rotation);
    this.root.scale.setScalar(scale);
    this.refreshTransform();
    this.recomputeBounds();
    if (rebuildCollision) this.registerCollision();
  }

  translateWorld(delta: THREE.Vector3): void {
    const rebuildCollision = this.physicsColliders.length > 0;
    this.root.position.add(delta);
    this.refreshTransform();
    this.recomputeBounds();
    if (rebuildCollision) this.registerCollision();
  }

  /**
   * Spark caches paged splat traversal against parent matrices. Editor drags
   * mutate `root` directly, so make that matrix change explicit to both Spark
   * renderers before the next frame can reuse an old room position.
   */
  refreshTransform(): void {
    this.root.updateMatrixWorld(true);
    this.splat.updateMatrixWorld(true);
    if (sharedSpark) {
      sharedSpark.lodDirty = true;
      sharedSpark.dirty = true;
    }
    if (sharedPortalSpark) {
      sharedPortalSpark.lodDirty = true;
      sharedPortalSpark.dirty = true;
    }
  }

  get splatRenderState(): MintSplatRenderState {
    return this.renderState;
  }

  setVisible(visible: boolean): void {
    this.setRenderState(visible ? 'primary' : 'hidden');
  }

  setCollisionEnabled(enabled: boolean): void {
    this.collisionEnabled = enabled;
    this.physicsColliders.forEach((collider) => collider.setEnabled(enabled));
  }

  /**
   * Spark creates the shared paged-RAD allocator on its first visible update.
   * Loading every room hidden and revealing all six at once can race the
   * library's asynchronous LoD initializer. Warm each source through the same
   * renderer before the loading gate opens.
   */
  async waitForPagerAttached(timeoutMs = 30_000): Promise<boolean> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (sharedSpark?.pager && this.splat.paged) {
        this.splat.paged.pager ??= sharedSpark.pager;
      }
      if (this.splat.paged?.pager) return true;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return false;
  }

  /**
   * Populate this RAD's root and visible LoD pages before the loading screen
   * opens. Spark's camera override drives paging without moving the player or
   * exposing a test teleport to gameplay.
   */
  async warmPagedSource(
    timeoutMs = 12_000,
    options: { stealLodCamera?: boolean } = {},
  ): Promise<boolean> {
    const spark = sharedSpark;
    if (!spark || !this.splat.paged) return false;
    const stealLodCamera = options.stealLodCamera ?? true;
    const previousPosition = spark.lodPosOverride;
    const previousQuaternion = spark.lodQuatOverride;
    const warmPosition = this.root.getWorldPosition(new THREE.Vector3());
    const warmQuaternion = this.root.getWorldQuaternion(new THREE.Quaternion());
    // Never steal the live camera for a background warm. Spark uses one shared
    // display mapping, so an off-room override can temporarily remove the
    // current room from the rendered frame. Visible prefetch meshes still put
    // their root chunks in the pager priority list without an override.
    if (stealLodCamera) {
      spark.lodPosOverride = warmPosition;
      spark.lodQuatOverride = warmQuaternion;
    }
    spark.lodDirty = true;
    spark.dirty = true;
    this.setRenderState(stealLodCamera ? 'primary' : 'prefetch');

    const startedAt = performance.now();
    let readySince = 0;
    try {
      while (performance.now() - startedAt < timeoutMs) {
        if (spark.pager && this.splat.paged) {
          this.splat.paged.pager ??= spark.pager;
        }
        const residency = this.pagerResidency();
        const selectionReady =
          this.splat.paged.numSplats >= MIN_HANDOFF_ACTIVE_SPLATS;
        const pagesReady =
          residency.requestedChunks > 0 &&
          residency.missingRequestedChunks === 0;
        // Chunk zero only proves allocator attachment. Spark must consume its
        // LoD-tree payload and publish a real selection before this room may be
        // hidden; otherwise a later traversal has no children to request and
        // remains permanently stuck on the one-splat root.
        const readyNow =
          residency.rootPageResident && selectionReady && pagesReady;
        if (readyNow) {
          if (readySince <= 0) readySince = performance.now();
          if (performance.now() - readySince < HANDOFF_READY_STABLE_MS) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            continue;
          }
          this.rootPageWarmed = true;
          if (!stealLodCamera) this.setRenderState('resident');
          return true;
        }
        readySince = 0;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      if (!stealLodCamera) this.setRenderState('resident');
      return false;
    } finally {
      if (stealLodCamera) {
        spark.lodPosOverride = previousPosition;
        spark.lodQuatOverride = previousQuaternion;
      }
      spark.lodDirty = true;
      spark.dirty = true;
    }
  }

  /**
   * Warm the pages required immediately after a portal handoff. Prefetching a
   * destination from the source-room camera can prove allocator residency yet
   * still leave the first destination view unmapped. Driving Spark from the
   * authored landing pose makes the readiness signal match the frame the
   * player will actually see after crossing.
   */
  async warmPagedView(
    worldPosition: THREE.Vector3,
    worldQuaternion: THREE.Quaternion,
    timeoutMs = 1_800,
    signal?: AbortSignal,
    options: {
      stealLodCamera?: boolean;
      publishDisplayMapping?: boolean;
    } = {},
  ): Promise<boolean> {
    const spark = sharedSpark;
    if (!spark || !this.splat.paged) return false;
    const stealLodCamera = options.stealLodCamera ?? false;
    const publishDisplayMapping =
      options.publishDisplayMapping ?? false;
    const previousPosition = spark.lodPosOverride;
    const previousQuaternion = spark.lodQuatOverride;
    const previousAutoUpdate = spark.autoUpdate;
    if (stealLodCamera) {
      // Spark's LoD worker is asynchronous with respect to the ordinary
      // render update. Keep ownership of the preload camera until both the
      // traversal and the resulting display mapping have landed; restoring
      // the override immediately after a render only warms the one-splat RAD
      // root and is the source of the visible black doorway.
      if (publishDisplayMapping) spark.autoUpdate = false;
      spark.lodPosOverride = worldPosition.clone();
      spark.lodQuatOverride = worldQuaternion.clone();
      handoffSortCamera.position.copy(worldPosition);
      handoffSortCamera.quaternion.copy(worldQuaternion);
      handoffSortCamera.updateMatrixWorld(true);
      spark.lodDirty = true;
      spark.dirty = true;
    }
    if (this.renderState !== 'primary') this.setRenderState('prefetch');

    const startedAt = performance.now();
    let readySince = 0;
    try {
      while (performance.now() - startedAt < timeoutMs) {
        if (signal?.aborted) return false;
        if (
          stealLodCamera &&
          !publishDisplayMapping &&
          sharedSparkScene
        ) {
          const visibleSplats: SplatMesh[] = [];
          sharedSparkScene.traverseVisible((object) => {
            if (
              object instanceof SplatMesh &&
              handoffSortCamera.layers.test(object.layers)
            ) {
              visibleSplats.push(object);
            }
          });
          // Spark 2.1's public prefetch-camera surface is commented out, but
          // its LoD driver is deliberately separate from display generation.
          // Drive that narrow path so preload page requests cannot be blocked
          // behind a multi-million-splat display sort.
          const lodDriver = spark as unknown as {
            driveLod(args: {
              visibleGenerators: SplatMesh[];
              camera: THREE.Camera;
              scene: THREE.Scene;
            }): void;
          };
          lodDriver.driveLod({
            visibleGenerators: visibleSplats,
            camera: handoffSortCamera,
            scene: sharedSparkScene,
          });
        }
        if (
          stealLodCamera &&
          publishDisplayMapping &&
          sharedSparkScene
        ) {
          try {
            // update() completes the display/sort phase. The LoD worker is
            // deliberately fire-and-forget inside Spark, so repeated updates
            // are required to consume fetched RAD pages and publish the next
            // mapping. Keeping the same camera makes this deterministic.
            await spark.update({
              scene: sharedSparkScene,
              camera: handoffSortCamera,
            });
          } catch (error) {
            // A render-frame update can have borrowed both accumulator
            // buffers just before autoUpdate was paused. Retry once it
            // returns one instead of abandoning the deployment warm.
            if (
              !(error instanceof Error) ||
              !error.message.includes('accumulator')
            ) {
              throw error;
            }
          }
        }
        if (spark.pager && this.splat.paged) {
          this.splat.paged.pager ??= spark.pager;
        }
        const residency = this.pagerResidency();
        const coverage =
          residency.requestedChunks > 0
            ? residency.residentRequestedChunks / residency.requestedChunks
            : 0;
        const viewSplats =
          stealLodCamera && !publishDisplayMapping
            ? this.splat.paged.numSplats
            : residency.mappedSplats;
        const currentLod = spark.currentLod;
        const lodPoseReady =
          !stealLodCamera ||
          Boolean(
            currentLod &&
              currentLod.pos.distanceToSquared(worldPosition) < 0.01 &&
              Math.abs(currentLod.quat.dot(worldQuaternion)) > 0.995,
          );
        const readyNow =
          residency.rootPageResident &&
          lodPoseReady &&
          viewSplats >= MIN_HANDOFF_ACTIVE_SPLATS &&
          residency.requestedChunks > 0 &&
          coverage >= HANDOFF_REQUIRED_CHUNK_COVERAGE;
        if (readyNow) {
          if (readySince <= 0) readySince = performance.now();
          if (performance.now() - readySince >= HANDOFF_READY_STABLE_MS) {
            this.rootPageWarmed = true;
            this.handoffReadyLatched = true;
            this.handoffReadySince = readySince;
            return true;
          }
        } else {
          readySince = 0;
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      return false;
    } finally {
      if (stealLodCamera) {
        spark.lodPosOverride = previousPosition;
        spark.lodQuatOverride = previousQuaternion;
        // Always return to live autoUpdate after a display-mapping warm.
        // Restoring a stale `false` (from an interrupted handoff) leaves every
        // later gameplay frame on the clear color while residency stays green.
        if (publishDisplayMapping) spark.autoUpdate = true;
        else spark.autoUpdate = previousAutoUpdate;
      }
      spark.lodDirty = true;
      spark.dirty = true;
    }
  }

  /** Keep Spark's already-warmed destination mapping sorted for a handoff. */
  static async setHandoffLodCamera(
    worldPosition: THREE.Vector3,
    worldQuaternion: THREE.Quaternion,
  ): Promise<boolean> {
    const spark = sharedSpark;
    const scene = sharedSparkScene;
    if (!spark || !scene) return false;
    spark.autoUpdate = false;
    spark.lodPosOverride = worldPosition.clone();
    spark.lodQuatOverride = worldQuaternion.clone();
    spark.lodDirty = true;
    spark.dirty = true;
    handoffSortCamera.position.copy(worldPosition);
    handoffSortCamera.quaternion.copy(worldQuaternion);
    handoffSortCamera.updateMatrixWorld(true);
    const handoffDirection = handoffSortCamera.getWorldDirection(
      new THREE.Vector3(),
    );

    // Spark chains a dirty follow-up sort synchronously when the current worker
    // finishes, so `sorting` may never be observable as false from a render
    // frame. Re-submit the landing view while the old job drains; with
    // autoUpdate paused it becomes the final queued camera, and sortedCenter /
    // sortedDir prove that exact job completed.
    const startedAt = performance.now();
    while (performance.now() - startedAt < 8_000) {
      try {
        await spark.update({ scene, camera: handoffSortCamera });
      } catch (error) {
        // Concurrent Spark updates can temporarily consume both accumulator
        // buffers. The active worker returns one on completion; retry on the
        // next animation frame without opening the seam early.
        if (!(error instanceof Error && error.message.includes('accumulator'))) {
          throw error;
        }
      }
      if (
        spark.sortedCenter.distanceToSquared(worldPosition) < 0.01 &&
        spark.sortedDir.dot(handoffDirection) > 0.995
      ) {
        return true;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return false;
  }

  /** Return paging and sorting to the live gameplay camera after promotion. */
  static clearHandoffLodCamera(): void {
    if (!sharedSpark) return;
    const changed =
      sharedSpark.lodPosOverride !== undefined ||
      sharedSpark.lodQuatOverride !== undefined ||
      !sharedSpark.autoUpdate;
    if (!changed) return;
    sharedSpark.lodPosOverride = undefined;
    sharedSpark.lodQuatOverride = undefined;
    sharedSpark.autoUpdate = true;
    sharedSpark.lodDirty = true;
    sharedSpark.dirty = true;
  }

  /**
   * Guarantee the shared Spark renderer is driven by the live gameplay camera.
   * Warm/handoff paths pause autoUpdate; if restore is skipped, every later
   * frame stays on the clear color even while pager residency looks healthy.
   */
  static ensureLiveSparkCamera(): void {
    MintWorldLayer.clearHandoffLodCamera();
  }

  static isSparkAutoUpdateEnabled(): boolean {
    return sharedSpark?.autoUpdate !== false;
  }

  /** Snapshot Spark's per-renderer frame stamp (Three increments it each render). */
  static captureSparkFrameStamp(): number | null {
    return sharedSpark ? sharedSpark.lastFrame : null;
  }

  static restoreSparkFrameStamp(stamp: number | null): void {
    if (!sharedSpark || stamp === null) return;
    sharedSpark.lastFrame = stamp;
  }

  static setSparkAutoUpdate(enabled: boolean): boolean {
    if (!sharedSpark) return true;
    const previous = sharedSpark.autoUpdate !== false;
    sharedSpark.autoUpdate = enabled;
    return previous;
  }

  static setSparkVisible(visible: boolean): boolean {
    if (!sharedSpark) return true;
    const previous = sharedSpark.visible !== false;
    sharedSpark.visible = visible;
    return previous;
  }

  static readonly fpViewmodelOverlayScene = fpViewmodelOverlayScene;
  /** @deprecated Use fpViewmodelOverlayScene */
  static readonly emptyOverlayScene = fpViewmodelOverlayScene;

  /**
   * Read back the first ordering texel from the GPU to verify the integer
   * DataTexture actually uploaded. CPU image.data can look valid while the
   * GL texture stays empty/sentinel and the vertex shader culls every instance.
   */
  /** Render Spark into an offscreen target and sample center luminance. */
  static probePaintedLuminance(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): {
    mean: number;
    max: number;
    std: number;
    nonClearPct: number;
    clearColor: string;
  } | null {
    if (!sharedSpark) return null;
    MintWorldLayer.ensureLiveSparkCamera();
    const previousTarget = renderer.getRenderTarget();
    const previousClear = new THREE.Color();
    renderer.getClearColor(previousClear);
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    const width = 64;
    const height = 64;
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    const buffer = new Uint8Array(width * height * 4);
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = true;
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClear, previousAlpha);
      renderer.autoClear = previousAutoClear;
      target.dispose();
    }
    let sum = 0;
    let max = 0;
    let nonClear = 0;
    const luminances: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      const lum = (buffer[i]! + buffer[i + 1]! + buffer[i + 2]!) / 3;
      luminances.push(lum);
      sum += lum;
      if (lum > max) max = lum;
      if (lum > 8) nonClear += 1;
    }
    const n = luminances.length;
    const mean = sum / n;
    let variance = 0;
    for (const lum of luminances) variance += (lum - mean) ** 2;
    return {
      mean,
      max,
      std: Math.sqrt(variance / n),
      nonClearPct: (100 * nonClear) / n,
      clearColor: previousClear.getHexString(),
    };
  }

  static probeDisplayTextures(renderer: THREE.WebGLRenderer): {
    hasTarget: boolean;
    textureCount: number;
    layer0First: number[] | null;
    nonZeroTexels: number;
    glError: number;
    emptyTextureBound: boolean;
  } | null {
    if (!sharedSpark) return null;
    const display = sharedSpark.display as unknown as {
      target?: {
        textures?: THREE.Texture[];
      } | null;
      getTextures: () => THREE.Texture[];
    };
    const textures = display.getTextures();
    const emptyTextures = (
      sharedSpark.display.constructor as unknown as {
        emptyTextures?: THREE.Texture[];
      }
    ).emptyTextures;
    const hasTarget = Boolean(display.target);
    const tex0 = textures?.[0] ?? null;
    if (!tex0) {
      return {
        hasTarget,
        textureCount: textures?.length ?? 0,
        layer0First: null,
        nonZeroTexels: 0,
        glError: 0,
        emptyTextureBound: textures === emptyTextures,
      };
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const props = renderer.properties.get(tex0) as {
      __webglTexture?: WebGLTexture;
    } | null;
    const glTexture = props?.__webglTexture ?? null;
    if (!glTexture) {
      return {
        hasTarget,
        textureCount: textures.length,
        layer0First: null,
        nonZeroTexels: 0,
        glError: gl.getError(),
        emptyTextureBound: Boolean(
          emptyTextures && textures[0] === emptyTextures[0],
        ),
      };
    }
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const fb = gl.createFramebuffer();
    const out = new Uint32Array(4);
    let nonZeroTexels = 0;
    let glError = 0;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      // Sample a few layers/coords for non-zero packed data.
      for (const layer of [0, 1, 2]) {
        gl.framebufferTextureLayer(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          glTexture,
          0,
          layer,
        );
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          continue;
        }
        for (const x of [0, 1, 16, 32]) {
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.readPixels(x, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
          const err = gl.getError();
          if (err) glError = err;
          if (out.some((v) => v !== 0)) nonZeroTexels += 1;
          if (layer === 0 && x === 0) {
            // keep first
          }
        }
      }
      gl.framebufferTextureLayer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        glTexture,
        0,
        0,
      );
      gl.readPixels(0, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.deleteFramebuffer(fb);
    }
    return {
      hasTarget,
      textureCount: textures.length,
      layer0First: Array.from(out),
      nonZeroTexels,
      glError,
      emptyTextureBound: Boolean(
        emptyTextures && textures[0] === emptyTextures[0],
      ),
    };
  }

  static probeOrderingGpuUpload(renderer: THREE.WebGLRenderer): {
    cpuFirst: number[];
    gpuFirst: number[] | null;
    glError: number;
    textureReady: boolean;
  } | null {
    if (!sharedSpark?.orderingTexture) return null;
    const texture = sharedSpark.orderingTexture;
    const cpuData = texture.image?.data as Uint32Array | undefined;
    const cpuFirst = cpuData ? Array.from(cpuData.slice(0, 8)) : [];
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const props = renderer.properties.get(texture) as {
      __webglTexture?: WebGLTexture;
    } | null;
    const glTexture = props?.__webglTexture ?? null;
    if (!glTexture) {
      return {
        cpuFirst,
        gpuFirst: null,
        glError: gl.getError(),
        textureReady: false,
      };
    }
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const fb = gl.createFramebuffer();
    const gpuFirst: number[] = [];
    let glError = 0;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        glTexture,
        0,
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        return {
          cpuFirst,
          gpuFirst: null,
          glError: status,
          textureReady: true,
        };
      }
      const out = new Uint32Array(4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
      glError = gl.getError();
      gpuFirst.push(...out);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.deleteFramebuffer(fb);
    }
    return { cpuFirst, gpuFirst, glError, textureReady: true };
  }

  /** Test-only: force opaque magenta splat fragments to prove Spark composites. */
  static setDebugSplatPaint(enabled: boolean): void {
    if (!sharedSpark) return;
    const uniforms = sharedSpark.uniforms as typeof sharedSpark.uniforms & {
      debugSplatPaint?: { value: number };
    };
    if (!uniforms.debugSplatPaint) {
      uniforms.debugSplatPaint = { value: 0 };
    }
    uniforms.debugSplatPaint.value = enabled ? 1 : 0;
    sharedSpark.dirty = true;
  }

  static liveShaderUniforms(): {
    portalPass: number;
    renderOwnerFilterEnabled: number;
    renderOwnerBase: number;
    renderOwnerCount: number;
    renderSecondaryBase: number;
    renderSecondaryCount: number;
    cutCount: number;
    trimCount: number;
    debugSplatPaint: number;
    minAlpha: number;
    falloff: number;
    encodeLinear: boolean;
  } | null {
    if (!sharedSpark) return null;
    const u = sharedSpark.uniforms as typeof sharedSpark.uniforms &
      PortalShaderUniforms &
      CutShaderUniforms & { debugSplatPaint?: { value: number } };
    return {
      portalPass: u.portalPass?.value ?? -1,
      renderOwnerFilterEnabled: u.renderOwnerFilterEnabled?.value ?? -1,
      renderOwnerBase: u.renderOwnerBase?.value ?? -1,
      renderOwnerCount: u.renderOwnerCount?.value ?? -1,
      renderSecondaryBase: u.renderSecondaryBase?.value ?? -1,
      renderSecondaryCount: u.renderSecondaryCount?.value ?? -1,
      cutCount: u.cutCount?.value ?? -1,
      trimCount: u.trimCount?.value ?? -1,
      debugSplatPaint: u.debugSplatPaint?.value ?? -1,
      minAlpha: u.minAlpha?.value ?? -1,
      falloff: u.falloff?.value ?? -1,
      encodeLinear: Boolean(u.encodeLinear?.value),
    };
  }

  static sparkMeshDiagnostics() {
    if (!sharedSpark) return null;
    const material = sharedSpark.material as THREE.ShaderMaterial & {
      program?: { program?: WebGLProgram | null } | null;
    };
    const uniforms = sharedSpark.uniforms as typeof sharedSpark.uniforms & {
      extSplats?: { value: unknown };
      extSplats2?: { value: unknown };
      ordering?: { value: unknown };
    };
    let parentVisible = true;
    let ancestor: THREE.Object3D | null = sharedSpark.parent;
    while (ancestor) {
      if (!ancestor.visible) parentVisible = false;
      ancestor = ancestor.parent;
    }
    const geometry = sharedSpark.geometry;
    return {
      visible: sharedSpark.visible,
      parentVisible,
      layersMask: sharedSpark.layers.mask,
      frustumCulled: sharedSpark.frustumCulled,
      activeSplats: sharedSpark.activeSplats,
      instanceCount:
        geometry instanceof THREE.InstancedBufferGeometry
          ? geometry.instanceCount
          : undefined,
      geometryType: geometry.type,
      isInstancedBufferGeometry: geometry instanceof THREE.InstancedBufferGeometry,
      geometryDrawRange: {
        start: geometry.drawRange.start,
        count: geometry.drawRange.count,
      },
      indexCount: geometry.index?.count ?? 0,
      positionCount: geometry.getAttribute('position')?.count ?? 0,
      materialType: material?.type ?? 'none',
      materialTransparent: Boolean(material?.transparent),
      materialDepthWrite: Boolean(material?.depthWrite),
      materialDepthTest: Boolean(material?.depthTest),
      materialBlending: material?.blending ?? -1,
      materialOpacity: material?.opacity ?? -1,
      materialSide: material?.side ?? -1,
      materialNeedsUpdate: Boolean(material?.needsUpdate),
      vertexShaderLen: material?.vertexShader?.length ?? 0,
      fragmentShaderLen: material?.fragmentShader?.length ?? 0,
      fragmentHasDebug: Boolean(
        material?.fragmentShader?.includes('debugSplatPaint'),
      ),
      programOk:
        material?.program === undefined
          ? null
          : Boolean(material.program?.program),
      extSplatsBound: Boolean(uniforms.extSplats?.value),
      extSplats2Bound: Boolean(uniforms.extSplats2?.value),
      orderingBound: Boolean(uniforms.ordering?.value),
      enableExtSplats: Boolean(
        (uniforms as { enableExtSplats?: { value: boolean } }).enableExtSplats
          ?.value,
      ),
      displayNumSplats: sharedSpark.display?.numSplats ?? 0,
      displayExtSplats: Boolean(sharedSpark.display?.extSplats),
      pagedExtSplats: Boolean(sharedSpark.pagedExtSplats),
      accumExtSplats: Boolean(sharedSpark.accumExtSplats),
      autoUpdate: sharedSpark.autoUpdate,
      dirty: sharedSpark.dirty,
      sorting: sharedSpark.sorting,
      scale: {
        x: sharedSpark.scale.x,
        y: sharedSpark.scale.y,
        z: sharedSpark.scale.z,
      },
      matrixWorld: sharedSpark.matrixWorld.toArray(),
      orderingSample: (() => {
        const texture = sharedSpark.orderingTexture as THREE.DataTexture | null;
        const data = texture?.image?.data as Uint32Array | undefined;
        if (!data || data.length === 0) {
          return {
            length: 0,
            nonSentinel: 0,
            maxIndex: -1,
            first: [] as number[],
          };
        }
        const SENTINEL = 0xffffffff;
        let nonSentinel = 0;
        let maxIndex = -1;
        const first: number[] = [];
        for (let i = 0; i < data.length; i += 1) {
          const value = data[i]!;
          if (value === SENTINEL) continue;
          nonSentinel += 1;
          if (value > maxIndex) maxIndex = value;
          if (first.length < 16) first.push(value);
        }
        return {
          length: data.length,
          nonSentinel,
          maxIndex,
          first,
        };
      })(),
      viewOrigin: {
        x: sharedSpark.display?.viewOrigin?.x ?? null,
        y: sharedSpark.display?.viewOrigin?.y ?? null,
        z: sharedSpark.display?.viewOrigin?.z ?? null,
      },
    };
  }

  /** One RAD owns gameplay; adjacent prefetched rooms fill authored cuts. */
  setRenderState(
    state: MintSplatRenderState,
    prefetchLodScale?: number,
  ): void {
    if (sharedSpark?.pager && this.splat.paged) {
      this.splat.paged.pager ??= sharedSpark.pager;
    }
    // Spark 2.1 disposes an LoD tree after three seconds without a visible
    // traversal. Keep an already-initialized resident record alive explicitly
    // so zero-opacity rooms can be removed from generation and sorting without
    // losing the root-page state needed for a fast revisit.
    if (state === 'resident' && sharedSpark && this.splat.paged) {
      const lodRecord = sharedSpark.lodIds.get(this.splat.paged);
      if (lodRecord) lodRecord.lastTouched = performance.now();
    }
    // Game ownership is evaluated frequently, but Spark state only needs to
    // change at a room/prefetch transition. Reapplying an identical state
    // dirtied LoD and sorting six times per frame and traversed every collider.
    if (this.renderState === state) {
      if (state === 'prefetch' && prefetchLodScale !== undefined) {
        this.setPrefetchLodScale(prefetchLodScale);
      }
      return;
    }
    const previousVisible = this.splat.visible;
    const previousOpacity = this.splat.opacity;
    const previousLodScale = this.splat.lodScale;
    this.renderState = state;
    if (state !== 'prefetch') this.handoffPrefetchVisible = false;
    const registered =
      state === 'primary' ||
      state === 'portal' ||
      state === 'prefetch';
    this.root.visible = registered;
    this.splat.visible = registered;
    // Prefetch is a data/LoD state, not permission to paint another room over
    // the current one. The isolated portal clone supplies destination pixels
    // only inside the owner-side aperture.
    this.splat.layers.set(MINT_PRIMARY_SPLAT_LAYER);
    this.splat.opacity =
      state === 'primary' ||
      state === 'portal' ||
      (state === 'prefetch' && activeSplatRenderOwnerId !== null)
        ? 1
        : 0;
    // Restoring primary scale marks the shared traversal dirty and requests
    // full detail as the player approaches or enters the room.
    this.splat.lodScale =
      state === 'primary' || state === 'portal'
        ? 1
        : state === 'prefetch'
          ? THREE.MathUtils.clamp(prefetchLodScale ?? 0.35, 0.08, 1)
          : 0.04;
    const displayChanged =
      previousVisible !== this.splat.visible ||
      previousOpacity !== this.splat.opacity ||
      Math.abs(previousLodScale - this.splat.lodScale) >= 0.001;
    // A portal crossing commonly swaps a full-resolution primary and a
    // full-resolution prefetch. Those two states have identical renderer
    // properties, so invalidating Spark's shared display here discards the
    // already-mapped destination and creates a brief clear-color frame. Only
    // regenerate when visibility, opacity, or the effective LoD scale really
    // changed.
    if (sharedSpark && displayChanged) {
      sharedSpark.lodDirty = true;
      sharedSpark.dirty = true;
    }
    // Collider GLBs are spatial data only. Presenting them as ordinary meshes
    // hides the RAD capture and makes a splat room look like a gray mesh room.
    // Keep every collider node visually disabled in every render state.
    this.collider.traverse((object) => {
      object.visible = false;
    });
    // Roots stay attached for transform/lifecycle ownership even while a
    // resident room is excluded from visible Spark generation.
    if (!this.root.parent) this.scene.add(this.root);
  }

  /**
   * Reveal a warm destination at the open end of an authored physical
   * connector. The connector's opaque walls provide the spatial mask, so the
   * destination is seen at its real world position rather than stretched into
   * a screen-space doorway rectangle. Short wall cuts keep using the isolated
   * portal compositor and never call this path.
   */
  setPhysicalConnectorPrefetchVisible(visible: boolean): void {
    if (this.renderState !== 'prefetch') return;
    if (this.handoffPrefetchVisible === visible) return;
    this.handoffPrefetchVisible = visible;
    // Zombies visibility is now an index-range shader selection. Keep every
    // prefetched mesh at full source alpha so a later ownership promotion is
    // uniform-only; setRenderOwners exposes the physical-connector neighbor
    // as its optional secondary range.
    if (activeSplatRenderOwnerId !== null) return;
    this.splat.opacity = visible ? 1 : 0;
    if (sharedSpark) sharedSpark.dirty = true;
  }

  /**
   * Give the predicted doorway destination more of the existing LoD budget
   * without increasing the global 2.5M-splat target or pager allocation.
   */
  setPrefetchLodScale(scale: number): void {
    if (this.renderState !== 'prefetch') return;
    const next = THREE.MathUtils.clamp(scale, 0.08, 1);
    if (Math.abs(this.splat.lodScale - next) < 0.001) return;
    this.splat.lodScale = next;
    if (sharedSpark) {
      sharedSpark.lodDirty = true;
      sharedSpark.dirty = true;
    }
  }

  /**
   * Composite a physically adjacent destination RAD through one rectangular
   * opening. The source remains in place; only source splat fragments behind
   * the authored door plane are removed, so traversal never teleports.
   */
  renderContinuousPortal(
    destination: MintWorldLayer,
    camera: THREE.PerspectiveCamera,
    portal: MintContinuousSplatPortal,
  ): boolean {
    const frontSpark = sharedSpark;
    if (!frontSpark || sharedSparkScene !== this.scene) {
      continuousPortalFallbackFrames += 1;
      return false;
    }
    // Allocate the second renderer only while a nearby authored portal is
    // active. Ordinary room rendering remains a single Spark pass.
    const behindSpark = ensurePortalSparkRenderer(frontSpark);
    const portalBudget = Math.min(
      PORTAL_LOD_SPLAT_COUNT,
      portal.lodSplatCount,
      frontSpark.lodSplatCount ?? DELIVERY_LOD_SPLAT_COUNT,
    );
    if (behindSpark.lodSplatCount !== portalBudget) {
      behindSpark.lodSplatCount = portalBudget;
      behindSpark.lodDirty = true;
      behindSpark.dirty = true;
    }
    if (continuousPortalDestinationId !== destination.world.id) {
      continuousPortalDestinationId = destination.world.id;
      continuousPortalDestinationReady = false;
    }
    portalCamera.copy(camera, false);
    portalCamera.position.copy(portal.destinationCameraPosition);
    portalCamera.quaternion.copy(portal.destinationCameraQuaternion);
    portalCamera.layers.set(CONTINUOUS_PORTAL_LAYER);
    portalCamera.updateMatrixWorld(true);

    behindSpark.lodInstances.clear();
    for (const [mesh, data] of frontSpark.lodInstances) {
      behindSpark.lodInstances.set(mesh, data);
    }

    const renderer = frontSpark.renderer;
    renderer.getDrawingBufferSize(portalScissorDrawingBuffer);
    let minimumNdcX = Number.POSITIVE_INFINITY;
    let maximumNdcX = Number.NEGATIVE_INFINITY;
    let minimumNdcY = Number.POSITIVE_INFINITY;
    let maximumNdcY = Number.NEGATIVE_INFINITY;
    for (const horizontal of [-1, 1]) {
      for (const vertical of [-1, 1]) {
        portalScissorCorner
          .copy(portal.center)
          .addScaledVector(portal.right, horizontal * portal.halfWidth)
          .addScaledVector(portal.up, vertical * portal.halfHeight)
          .project(camera);
        minimumNdcX = Math.min(minimumNdcX, portalScissorCorner.x);
        maximumNdcX = Math.max(maximumNdcX, portalScissorCorner.x);
        minimumNdcY = Math.min(minimumNdcY, portalScissorCorner.y);
        maximumNdcY = Math.max(maximumNdcY, portalScissorCorner.y);
      }
    }
    const clippedMinimumX = THREE.MathUtils.clamp(minimumNdcX, -1, 1);
    const clippedMaximumX = THREE.MathUtils.clamp(maximumNdcX, -1, 1);
    const clippedMinimumY = THREE.MathUtils.clamp(minimumNdcY, -1, 1);
    const clippedMaximumY = THREE.MathUtils.clamp(maximumNdcY, -1, 1);
    if (
      clippedMaximumX <= clippedMinimumX ||
      clippedMaximumY <= clippedMinimumY
    ) {
      return false;
    }
    const scissorPadding = 8;
    const scissorX = Math.max(
      0,
      Math.floor(
        (clippedMinimumX * 0.5 + 0.5) * portalScissorDrawingBuffer.x,
      ) - scissorPadding,
    );
    const scissorY = Math.max(
      0,
      Math.floor(
        (clippedMinimumY * 0.5 + 0.5) * portalScissorDrawingBuffer.y,
      ) - scissorPadding,
    );
    const scissorMaximumX = Math.min(
      portalScissorDrawingBuffer.x,
      Math.ceil(
        (clippedMaximumX * 0.5 + 0.5) * portalScissorDrawingBuffer.x,
      ) + scissorPadding,
    );
    const scissorMaximumY = Math.min(
      portalScissorDrawingBuffer.y,
      Math.ceil(
        (clippedMaximumY * 0.5 + 0.5) * portalScissorDrawingBuffer.y,
      ) + scissorPadding,
    );
    portalScissorRect.set(
      scissorX,
      scissorY,
      Math.max(1, scissorMaximumX - scissorX),
      Math.max(1, scissorMaximumY - scissorY),
    );
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer
      .getClearColor(portalPreviousClearColor)
      .clone();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousScissorTest = renderer.getScissorTest();
    renderer.getScissor(portalScissorPrevious);
    const previousBackground = this.scene.background;
    let backgroundSuppressed = false;
    const previousOwnerVisible = this.splat.visible;
    const previousDestinationVisible = destination.splat.visible;
    const previousDestinationOpacity = destination.splat.opacity;
    const previousDestinationLayerMask = destination.splat.layers.mask;
    const previousLodPositionOverride = frontSpark.lodPosOverride;
    const previousLodQuaternionOverride = frontSpark.lodQuatOverride;
    const portalLodOverrideActive = false;
    let primarySplatStateRestored = false;
    try {
      // Establish a fresh opaque source color buffer before opening the RAD
      // aperture. Gaussian captures legitimately contain transparent pixels;
      // clearing to black before the destination pass exposed those holes as
      // a solid dark rectangle even at full LoD.
      this.splat.visible = true;
      // Keep the destination registered so the primary renderer continues
      // driving its LoD tree, but suppress it in the source pass. Rendering a
      // full-opacity prefetch here exposes the destination RAD's rectangular
      // capture bounds across the whole source room. The isolated layer pass
      // below is the only destination contribution that belongs on screen.
      // The owner-range shader now enforces that isolation without toggling
      // opacity twice per frame (which forced Spark to regenerate 420K splats
      // on every active-doorway render).
      destination.splat.visible = true;
      // Predictive warm already pages the landing view before this compositor
      // becomes eligible. Never steal the front renderer's live LoD camera
      // here: doing so can remove the source-room mapping while the player is
      // still approaching the doorway.
      // Remove only source-room fragments that lie behind the visible
      // doorway plane. Pass 0 disables the aperture entirely and caused the
      // source wall to remain blended over the destination, producing the
      // recorded dark/warped rectangle at close range.
      // Do not cut the source aperture until the isolated renderer has a
      // destination mapping it can actually draw. On its first frame the
      // portal renderer may still contain the previous room (or no splats at
      // all); opening the source at that point exposes only the sparse-capture
      // backdrop and reads as a flat black/green hole. The zero-output portal
      // pass below still warms the destination, while this frame remains a
      // complete source-room image.
      const destinationDisplayReady =
        behindSpark.activeSplats > 1_000 &&
        behindSpark.display.mapping.some(
          (mapping) =>
            mapping.node === destination.splat &&
            mapping.count > 1_000,
        );
      setPortalShader(
        frontSpark,
        camera,
        portal,
        destinationDisplayReady ? -1 : 0,
      );
      setRenderOwnerShader(frontSpark, this.world.id, null, true);
      setCutShader(frontSpark, camera, [], []);
      // Interior Gaussian captures intentionally have transparent pixels at
      // their scan boundaries. During a live doorway composite, back those
      // sparse pixels with a neutral corridor tone instead of exposing the
      // engine clear color as a rectangular black/green void. Destination
      // residency and mapped-splat readiness are still mandatory above.
      this.scene.background = portalSparseCaptureBackdrop;
      // Spark drives WebGLRenderer directly and does not consistently honor a
      // Three scene background for transparent RAD pixels. Set the renderer's
      // actual clear color for this isolated pass so capture gaps receive the
      // neutral corridor tone instead of the engine's near-black clear color.
      renderer.setClearColor(portalSparseCaptureBackdrop, 1);
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      frontSpark.render(this.scene, camera);

      // Reuse the already-warmed destination mesh for the isolated doorway
      // pass. A second SplatMesh sharing the same PagedSplats source makes
      // Spark attempt to register duplicate shared LoD trees, which can trap
      // its WASM worker in an `unreachable` retry loop. The layer mutation is
      // strictly scoped to this pass and restored before returning.
      destination.splat.layers.set(CONTINUOUS_PORTAL_LAYER);
      destination.splat.visible = true;
      // The non-driving renderer supplies LoD/display data through
      // sparkOverride while the in-scene primary renderer owns the material
      // and portal uniforms. Preserve the source color, reset its depth, and
      // alpha-composite only destination fragments physically behind the
      // source aperture. A switched renderer can still hold the previous
      // room's sorted display for a frame, so pass 3 warms the new mapping
      // with zero fragment output instead of paying for a third source pass.
      setPortalShader(
        frontSpark,
        portalCamera,
        portal.destinationAperture,
        destinationDisplayReady ? 2 : 3,
      );
      setRenderOwnerShader(
        frontSpark,
        destination.world.id,
        null,
      );
      setPortalShader(
        behindSpark,
        portalCamera,
        portal.destinationAperture,
        destinationDisplayReady ? 2 : 3,
      );
      setRenderOwnerShader(
        behindSpark,
        destination.world.id,
        null,
      );
      setCutShader(
        frontSpark,
        portalCamera,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
      setCutShader(
        behindSpark,
        portalCamera,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
      renderer.autoClear = false;
      this.scene.background = null;
      backgroundSuppressed = true;
      renderer.setScissor(
        portalScissorRect.x,
        portalScissorRect.y,
        portalScissorRect.z,
        portalScissorRect.w,
      );
      renderer.setScissorTest(true);
      renderer.clearDepth();
      behindSpark.render(this.scene, portalCamera);
      continuousPortalBehindActiveSplats = behindSpark.activeSplats;
      continuousPortalBehindSourceSplats =
        destination.splat.numSplats;
      continuousPortalBehindMappings = behindSpark.display.mapping.map(
        (mapping) => ({
          name: mapping.node.name,
          count: mapping.count,
        }),
      );
      const destinationDisplayStillReady =
        behindSpark.activeSplats > 1_000 &&
        behindSpark.display.mapping.some(
          (mapping) =>
            mapping.node === destination.splat &&
            mapping.count > 1_000,
        );
      continuousPortalDestinationReady =
        destinationDisplayReady && destinationDisplayStillReady;

      this.splat.visible = previousOwnerVisible;
      destination.splat.layers.mask = previousDestinationLayerMask;
      destination.splat.visible = previousDestinationVisible;
      destination.splat.opacity = previousDestinationOpacity;
      primarySplatStateRestored = true;
      if (!continuousPortalDestinationReady) {
        continuousPortalFallbackFrames += 1;
        return true;
      }
      continuousPortalCompositeFrames += 1;
      return true;
    } finally {
      if (portalLodOverrideActive) {
        frontSpark.lodPosOverride = previousLodPositionOverride;
        frontSpark.lodQuatOverride = previousLodQuaternionOverride;
      }
      if (!primarySplatStateRestored) {
        this.splat.visible = previousOwnerVisible;
        destination.splat.layers.mask = previousDestinationLayerMask;
        destination.splat.visible = previousDestinationVisible;
        destination.splat.opacity = previousDestinationOpacity;
      }
      if (backgroundSuppressed) {
        this.scene.background = previousBackground;
      }
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.setScissor(
        portalScissorPrevious.x,
        portalScissorPrevious.y,
        portalScissorPrevious.z,
        portalScissorPrevious.w,
      );
      renderer.setScissorTest(previousScissorTest);
      setPortalShader(frontSpark, camera, portal, 0);
      setRenderOwnerShader(
        frontSpark,
        activeSplatRenderOwnerId,
        activeSplatRenderSecondaryId,
        true,
        activeSplatRenderTertiaryId,
      );
      if (sharedPortalSpark) {
        setPortalShader(sharedPortalSpark, camera, portal, 0);
      }
      setCutShader(
        frontSpark,
        camera,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
    }
  }

  get activeSplats(): number {
    return this.splat.splats?.getNumSplats() ?? 0;
  }

  meetsResidency(minimumActiveSplats: number): boolean {
    const residency = this.pagerResidency();
    const minimum = Math.max(
      MIN_HANDOFF_ACTIVE_SPLATS,
      minimumActiveSplats,
    );
    const chunkCoverage =
      residency.requestedChunks > 0
        ? residency.residentRequestedChunks / residency.requestedChunks
        : 0;
    const readyNow =
      residency.rootPageResident &&
      residency.requestedChunks > 0 &&
      chunkCoverage >= HANDOFF_REQUIRED_CHUNK_COVERAGE &&
      residency.mappedSplats >= minimum;
    if (
      !residency.rootPageResident ||
      residency.mappedSplats < minimum
    ) {
      this.handoffReadySince = 0;
      this.handoffReadyLatched = false;
      return false;
    }
    // Once a doorway has proven visual coverage, do not close it merely
    // because promotion to primary requests additional detail pages. The root
    // and existing mapping remain visible while those refinements arrive.
    if (this.handoffReadyLatched) return true;
    if (!readyNow) {
      this.handoffReadySince = 0;
      return false;
    }
    const now = performance.now();
    if (this.handoffReadySince <= 0) this.handoffReadySince = now;
    if (now - this.handoffReadySince < HANDOFF_READY_STABLE_MS) return false;
    this.handoffReadyLatched = true;
    return true;
  }

  /** Treat an already-resident root page as warmed without a camera steal. */
  markWarmedIfResident(): boolean {
    if (!this.pagerResidency().rootPageResident) {
      this.rootPageWarmed = false;
      return false;
    }
    this.rootPageWarmed = true;
    return true;
  }

  /**
   * Owner-only paging never keeps root pages for off-camera residents. A
   * pager-attached stream-ready room is warm enough to promote later.
   */
  markWarmedFromPagerAttach(): boolean {
    // Pager attachment proves only that the allocator exists. Keep this
    // compatibility method honest by requiring the room's real root chunk.
    return this.markWarmedIfResident();
  }

  private pagerResidency(): {
    rootPageResident: boolean;
    mappedSplats: number;
    requestedChunks: number;
    residentRequestedChunks: number;
    missingRequestedChunks: number;
  } {
    const paged = this.splat.paged;
    const pager = paged?.pager ?? sharedSpark?.pager;
    if (!paged || !pager) {
      return {
        rootPageResident: false,
        mappedSplats: 0,
        requestedChunks: 0,
        residentRequestedChunks: 0,
        missingRequestedChunks: 0,
      };
    }
    paged.pager ??= pager;
    const rootPage = pager.getSplatsChunk(paged, 0);
    const lodRecord = sharedSpark?.lodIds.get(paged);
    // Spark 2.1 keeps record.rootPage after the pager recycles chunk zero.
    // Synchronize it to the allocator's authoritative mapping so a recycled
    // page can never make a different room appear resident.
    if (lodRecord) lodRecord.rootPage = rootPage?.page;
    const requested = new Set(
      pager.fetchPriority
        .filter((entry) => entry.splats === paged)
        .map((entry) => entry.chunk),
    );
    let residentRequestedChunks = 0;
    for (const chunk of requested) {
      if (pager.getSplatsChunk(paged, chunk)) residentRequestedChunks += 1;
    }
    const mappedSplats =
      sharedSpark?.display.mapping.find(
        (entry) => entry.node === this.splat,
      )?.count ?? 0;
    return {
      rootPageResident: Boolean(rootPage),
      mappedSplats,
      requestedChunks: requested.size,
      residentRequestedChunks,
      missingRequestedChunks: requested.size - residentRequestedChunks,
    };
  }

  diagnostics(): MintWorldSplatDiagnostics {
    let visibleColliderMeshes = 0;
    this.collider.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible) {
        visibleColliderMeshes += 1;
      }
    });
    const residency = this.pagerResidency();
    if (!residency.rootPageResident) this.rootPageWarmed = false;
    const handoffReady = this.meetsResidency(MIN_HANDOFF_ACTIVE_SPLATS);
    return {
      id: this.world.id,
      integrationMode: this.world.integrationMode,
      runtimeUrl: this.world.runtime.runtimeUrl,
      colliderUrl: this.world.runtime.collider.runtimeUrl,
      sourceKind: 'Spark SplatMesh / paged RAD',
      isSplatMesh: true,
      initialized: this.splat.isInitialized,
      paged: Boolean(this.splat.paged),
      pagerAttached: Boolean(this.splat.paged?.pager),
      lodTreeRegistered:
        Boolean(this.splat.paged) &&
        Boolean(sharedSpark?.lodIds.has(this.splat.paged!)),
      rootPageResident: residency.rootPageResident,
      rootPageWarmed: this.rootPageWarmed,
      activeSplats: this.activeSplats,
      // PagedSplats.numSplats is the latest LoD worker selection. The display
      // mapping below can trail it while Spark publishes/sorts the selection;
      // exposing both distinguishes traversal failure from sort latency.
      selectedSplats: this.splat.paged?.numSplats ?? 0,
      mappedSplats: residency.mappedSplats,
      requestedChunks: residency.requestedChunks,
      residentRequestedChunks: residency.residentRequestedChunks,
      missingRequestedChunks: residency.missingRequestedChunks,
      handoffReady,
      portalLodInstanceReady:
        Boolean(
          (this.splat.paged && this.activeSplats > 0) ||
            sharedSpark?.lodInstances.has(this.splat),
        ),
      renderState: this.renderState,
      rootVisible: this.root.visible,
      splatVisible: this.splat.visible,
      splatOpacity: this.splat.opacity,
      colliderRootVisible: this.collider.visible,
      colliderMeshCount: this.colliderMeshCount,
      physicsColliderCount: this.physicsColliders.length,
      visibleColliderMeshes,
      visualFallbackActive: false,
    };
  }

  static qualityDiagnostics(): {
    activeRenderOwnerId: string | null;
    activeRenderSecondaryId: string | null;
    activeRenderTertiaryId: string | null;
    activeRenderOwnerRange: { base: number; count: number };
    activeRenderSecondaryRange: { base: number; count: number };
    activeRenderTertiaryRange: { base: number; count: number };
    lodSplatCount: number;
    lodRenderScale: number;
    minSortIntervalMs: number;
    maxPagedSplats: number;
    numLodFetchers: number;
    pagedBaseAllocationMiB: number;
    focalAdjustment: number;
    blurAmount: number;
    foveationDisabled: boolean;
    sortMode: 'z-depth' | 'radial';
    activeSplats: number;
    autoUpdate: boolean;
    sorting: boolean;
    sortDirty: boolean;
    sortedCenter: { x: number; y: number; z: number };
    currentLodCenter: { x: number; y: number; z: number } | null;
    currentLodAgeMs: number | null;
    continuousPortalCompositeFrames: number;
    continuousPortalFallbackFrames: number;
    continuousPortalBehindActiveSplats: number;
    continuousPortalBehindSourceSplats: number;
    continuousPortalBehindMappings: Array<{
      name: string;
      count: number;
    }>;
    continuousPortalDestinationId: string | null;
    continuousPortalDestinationReady: boolean;
    clipBindings: Array<{
      id: string;
      kind: 'cut' | 'trim';
      roomId: string;
      ownerRegistered: boolean;
      ownerBase: number;
      ownerCount: number;
    }>;
    splatMappings: Array<{
      name: string;
      base: number;
      count: number;
    }>;
  } | null {
    if (!sharedSpark) return null;
    const activeRenderOwnerRange = activeSplatRenderOwnerId
      ? splatOwnerRange(sharedSpark, activeSplatRenderOwnerId)
      : { base: 0, count: 0 };
    const activeRenderSecondaryRange = activeSplatRenderSecondaryId
      ? splatOwnerRange(sharedSpark, activeSplatRenderSecondaryId)
      : { base: 0, count: 0 };
    const activeRenderTertiaryRange = activeSplatRenderTertiaryId
      ? splatOwnerRange(sharedSpark, activeSplatRenderTertiaryId)
      : { base: 0, count: 0 };
    return {
      activeRenderOwnerId: activeSplatRenderOwnerId,
      activeRenderSecondaryId: activeSplatRenderSecondaryId,
      activeRenderTertiaryId: activeSplatRenderTertiaryId,
      activeRenderOwnerRange,
      activeRenderSecondaryRange,
      activeRenderTertiaryRange,
      lodSplatCount: sharedSpark.lodSplatCount ?? 0,
      lodRenderScale: sharedSpark.lodRenderScale,
      minSortIntervalMs: sharedSpark.minSortIntervalMs,
      maxPagedSplats: sharedSpark.maxPagedSplats,
      numLodFetchers: sharedSpark.numLodFetchers,
      pagedBaseAllocationMiB: Number(
        (
          (sharedSpark.maxPagedSplats *
            (sharedSpark.pagedExtSplats ? 32 : 16)) /
          (1024 * 1024)
        ).toFixed(1),
      ),
      focalAdjustment: sharedSpark.focalAdjustment,
      blurAmount: sharedSpark.blurAmount,
      foveationDisabled:
        sharedSpark.coneFov0 === 0 && sharedSpark.coneFov === 0,
      sortMode: sharedSpark.sortRadial ? 'radial' : 'z-depth',
      activeSplats: sharedSpark.activeSplats,
      autoUpdate: sharedSpark.autoUpdate,
      sorting: sharedSpark.sorting,
      sortDirty: sharedSpark.sortDirty,
      sortedCenter: {
        x: sharedSpark.sortedCenter.x,
        y: sharedSpark.sortedCenter.y,
        z: sharedSpark.sortedCenter.z,
      },
      currentLodCenter: sharedSpark.currentLod
        ? {
            x: sharedSpark.currentLod.pos.x,
            y: sharedSpark.currentLod.pos.y,
            z: sharedSpark.currentLod.pos.z,
          }
        : null,
      currentLodAgeMs: sharedSpark.currentLod
        ? performance.now() - sharedSpark.currentLod.timestamp
        : null,
      continuousPortalCompositeFrames,
      continuousPortalFallbackFrames,
      continuousPortalBehindActiveSplats,
      continuousPortalBehindSourceSplats,
      continuousPortalBehindMappings,
      continuousPortalDestinationId,
      continuousPortalDestinationReady,
      clipBindings: [
        ...activeSplatCutVolumes.map((cut) => {
          const owner = splatOwnerRange(sharedSpark!, cut.roomId);
          return {
            id: cut.id,
            kind: 'cut' as const,
            roomId: cut.roomId,
            ownerRegistered: splatByRoomId.has(cut.roomId),
            ownerBase: owner.base,
            ownerCount: owner.count,
          };
        }),
        ...activeSplatTrimPlanes.map((trim) => {
          const owner = splatOwnerRange(sharedSpark!, trim.roomId);
          return {
            id: trim.id,
            kind: 'trim' as const,
            roomId: trim.roomId,
            ownerRegistered: splatByRoomId.has(trim.roomId),
            ownerBase: owner.base,
            ownerCount: owner.count,
          };
        }),
      ],
      splatMappings: sharedSpark.display.mapping.map((mapping) => ({
        name: mapping.node.name,
        base: mapping.base,
        count: mapping.count,
      })),
    };
  }

  static setAnalysisSplatBudget(lodSplatCount: number | null): number | null {
    analysisSplatBudgetOverride =
      lodSplatCount === null
        ? null
        : THREE.MathUtils.clamp(
            Math.round(lodSplatCount),
            100_000,
            DELIVERY_LOD_SPLAT_COUNT,
          );
    // Preserve a pre-deployment QA override even if the shared renderer has
    // not been constructed yet; load() consumes this value at creation.
    if (!sharedSpark) return analysisSplatBudgetOverride;
    sharedSpark.lodSplatCount =
      analysisSplatBudgetOverride ??
      QUALITY_LOD_PRESETS[appliedSplatQualityTier].lodSplatCount;
    sharedSpark.lodDirty = true;
    sharedSpark.dirty = true;
    return sharedSpark.lodSplatCount;
  }

  /**
   * Apply gameplay quality tiers to the shared Spark LoD budget. High retains
   * the 2.5M delivery target; medium/low lower density for steadier frame time.
   * Analysis overrides still win until cleared.
   */
  static applyQualityTier(quality: MintSplatQualityTier): void {
    appliedSplatQualityTier = quality;
    if (!sharedSpark) return;
    const preset = QUALITY_LOD_PRESETS[quality];
    if (analysisSplatBudgetOverride === null) {
      sharedSpark.lodSplatCount = preset.lodSplatCount;
    }
    sharedSpark.lodRenderScale = preset.lodRenderScale;
    sharedSpark.coneFov0 = preset.coneFov0;
    sharedSpark.coneFov = preset.coneFov;
    sharedSpark.coneFoveate = preset.coneFoveate;
    sharedSpark.behindFoveate = preset.behindFoveate;
    sharedSpark.focalAdjustment = preset.focalAdjustment;
    sharedSpark.blurAmount = preset.blurAmount;
    sharedSpark.lodDirty = true;
    sharedSpark.dirty = true;
  }

  static qualityTier(): MintSplatQualityTier {
    return appliedSplatQualityTier;
  }

  /**
   * Keep the 2.5M high LoD budget, but sort less often when the view is stable.
   * Fast look/move keeps the 16 ms cadence so nearby detail stays correct.
   */
  static updateFramePacing(viewIsMoving: boolean): void {
    if (!sharedSpark) return;
    viewIsCurrentlyMoving = viewIsMoving;
    const next = viewIsMoving ? MIN_SORT_INTERVAL_MS : STABLE_SORT_INTERVAL_MS;
    const owner = activeSplatRenderOwnerId
      ? splatByRoomId.get(activeSplatRenderOwnerId)
      : null;
    const ownerScale = activeSplatRenderOwnerId
      ? roomMovingLodScales.get(activeSplatRenderOwnerId) ?? 1
      : 1;
    if (owner) {
      const nextOwnerScale = viewIsMoving ? ownerScale : 1;
      if (Math.abs(owner.lodScale - nextOwnerScale) >= 0.001) {
        owner.lodScale = nextOwnerScale;
        // SplatMesh does not invalidate the shared Spark traversal when its
        // public lodScale field is assigned. Without this, owner-specific
        // motion budgets are inert until an unrelated room/state transition.
        sharedSpark.lodDirty = true;
        sharedSpark.dirty = true;
      }
    }
    if (next === appliedSortIntervalMs) return;
    appliedSortIntervalMs = next;
    sharedSpark.minSortIntervalMs = next;
    // Preserve the high tier's 2.5M delivery ceiling, but spend less vertex and
    // fragment work while pixels are changing too quickly for the extra density
    // to be perceived. Full preset fidelity returns when the view settles.
    sharedSpark.lodRenderScale = viewIsMoving
      ? Math.min(
          QUALITY_LOD_PRESETS[appliedSplatQualityTier].lodRenderScale,
          MOVING_LOD_RENDER_SCALE,
          ownerScale,
        )
      : QUALITY_LOD_PRESETS[appliedSplatQualityTier].lodRenderScale;
    sharedSpark.lodDirty = true;
    sharedSpark.dirty = true;
  }

  /** Per-room motion detail measured by the headless owner profiler. */
  static setRoomMovingLodScales(scales: Readonly<Record<string, number>>): void {
    roomMovingLodScales.clear();
    for (const [roomId, scale] of Object.entries(scales)) {
      roomMovingLodScales.set(roomId, THREE.MathUtils.clamp(scale, 0.45, 1));
    }
  }

  /**
   * Temporary LoD climb into the high-quality 2.5M delivery target. Opening
   * frames warm/sort faster; steady-state still reaches full fidelity.
   */
  static beginDeliveryLodRamp(
    fromSplatCount = 800_000,
    durationMs = 1200,
  ): void {
    if (!sharedSpark) return;
    // Deterministic QA budgets are already the requested final value. Do not
    // lower them to the ramp start and then immediately cancel the ramp.
    if (analysisSplatBudgetOverride !== null) {
      sharedSpark.lodSplatCount = analysisSplatBudgetOverride;
      sharedSpark.lodDirty = true;
      sharedSpark.dirty = true;
      return;
    }
    const target =
      QUALITY_LOD_PRESETS[appliedSplatQualityTier].lodSplatCount;
    if (appliedSplatQualityTier !== 'high' || target < DELIVERY_LOD_SPLAT_COUNT) {
      return;
    }
    const start = THREE.MathUtils.clamp(
      Math.round(fromSplatCount),
      100_000,
      target,
    );
    sharedSpark.lodSplatCount = start;
    sharedSpark.lodDirty = true;
    sharedSpark.dirty = true;
    const startedAt = performance.now();
    const tick = () => {
      if (!sharedSpark) return;
      if (appliedSplatQualityTier !== 'high') return;
      const elapsed = performance.now() - startedAt;
      const t = THREE.MathUtils.clamp(elapsed / Math.max(1, durationMs), 0, 1);
      // Ease-out so early frames stay light, then snap to full delivery.
      const eased = 1 - (1 - t) ** 2;
      sharedSpark.lodSplatCount = Math.round(
        THREE.MathUtils.lerp(start, DELIVERY_LOD_SPLAT_COUNT, eased),
      );
      sharedSpark.lodDirty = true;
      if (t < 1) {
        requestAnimationFrame(tick);
        return;
      }
      sharedSpark.lodSplatCount = DELIVERY_LOD_SPLAT_COUNT;
      sharedSpark.dirty = true;
    };
    requestAnimationFrame(tick);
  }

  /** Keep every registered room LoD tree alive without reassigning state. */
  static touchResidentPagers(force = false): void {
    if (!sharedSpark) return;
    const now = performance.now();
    if (
      !force &&
      now - lastResidentPagerTouchMs < RESIDENT_PAGER_TOUCH_INTERVAL_MS
    ) {
      return;
    }
    lastResidentPagerTouchMs = now;
    for (const layer of portalLayers) {
      if (!layer.splat.paged) continue;
      const lodRecord = sharedSpark.lodIds.get(layer.splat.paged);
      if (lodRecord) lodRecord.lastTouched = now;
    }
  }

  /**
   * Restrict doorway cut/trim uniforms to the rooms that can contribute visible
   * splat fragments (owner + optional prefetch/destination).
   */
  static filterClipsForRooms<T extends { roomId: string; enabled: boolean }>(
    clips: readonly T[],
    roomIds: ReadonlySet<string> | readonly string[],
  ): T[] {
    const allowed =
      roomIds instanceof Set ? roomIds : new Set(roomIds);
    if (allowed.size === 0) return [];
    return clips.filter(
      (clip) => clip.enabled && allowed.has(clip.roomId),
    );
  }

  static setGlobalCutVolumes(cuts: readonly SplatCutVolume[]): void {
    activeSplatCutVolumes = cuts
      .filter((cut) => cut.enabled)
      .slice(0, MAX_SPLAT_CUT_VOLUMES)
      .map((cut) => ({
        ...cut,
        position: [...cut.position] as [number, number, number],
        rotation: [...cut.rotation] as [number, number, number],
        size: [...cut.size] as [number, number, number],
      }));
    cutPrepareForce = true;
    if (sharedSpark) sharedSpark.dirty = true;
    if (sharedPortalSpark) sharedPortalSpark.dirty = true;
  }

  static setGlobalTrimPlanes(trims: readonly SplatTrimPlane[]): void {
    activeSplatTrimPlanes = trims
      .filter((trim) => trim.enabled)
      .slice(0, MAX_SPLAT_TRIM_PLANES)
      .map((trim) => ({
        ...trim,
        position: [...trim.position] as [number, number, number],
        rotation: [...trim.rotation] as [number, number, number],
      }));
    cutPrepareForce = true;
    if (sharedSpark) sharedSpark.dirty = true;
    if (sharedPortalSpark) sharedPortalSpark.dirty = true;
  }

  /**
   * Select which already-generated room mappings may paint the gameplay
   * frame. Prefetched rooms remain full-alpha inputs to Spark so promoting one
   * to owner is a uniform-only switch, not a costly splat regeneration.
   */
  /** True when Spark has published a non-empty display range for this room. */
  static ownerMappingReady(roomId: string): boolean {
    if (!sharedSpark) return false;
    return splatOwnerRange(sharedSpark, roomId).count > 0;
  }

  static setRenderOwners(
    ownerId: string | null,
    secondaryId: string | null = null,
    tertiaryId: string | null = null,
  ): void {
    if (
      activeSplatRenderOwnerId === ownerId &&
      activeSplatRenderSecondaryId === secondaryId &&
      activeSplatRenderTertiaryId === tertiaryId
    ) {
      return;
    }
    activeSplatRenderOwnerId = ownerId;
    activeSplatRenderSecondaryId = secondaryId;
    activeSplatRenderTertiaryId = tertiaryId;
    const owner = ownerId ? splatByRoomId.get(ownerId) : null;
    if (owner && ownerId) {
      const nextOwnerScale = viewIsCurrentlyMoving
        ? roomMovingLodScales.get(ownerId) ?? 1
        : 1;
      if (Math.abs(owner.lodScale - nextOwnerScale) >= 0.001) {
        owner.lodScale = nextOwnerScale;
        if (sharedSpark) {
          sharedSpark.lodDirty = true;
          sharedSpark.dirty = true;
        }
      }
    }
    cutPrepareForce = true;
  }

  /**
   * Register a non-paged local Gaussian connector with the same owner-range
   * shader used by streamed RAD rooms. The connector remains in Spark's shared
   * display but cannot paint a pixel unless gameplay explicitly selects its
   * owner id as the active secondary range.
   */
  static registerAdditionalSplatOwner(
    ownerId: string,
    splat: SplatMesh,
  ): () => void {
    splatByRoomId.set(ownerId, splat);
    if (sharedSpark) {
      sharedSpark.lodDirty = true;
      sharedSpark.dirty = true;
    }
    cutPrepareForce = true;
    return () => {
      if (splatByRoomId.get(ownerId) === splat) {
        splatByRoomId.delete(ownerId);
      }
      if (sharedSpark) {
        sharedSpark.lodDirty = true;
        sharedSpark.dirty = true;
      }
      cutPrepareForce = true;
    };
  }

  /** Mask the real, authored neighbor mapping to its owner-side doorway. */
  static prepareWorldSpacePortal(
    camera: THREE.Camera,
    aperture: MintContinuousSplatAperture | null,
  ): void {
    if (!sharedSpark) return;
    if (!aperture) {
      // Values are ignored for pass zero; retain the existing vectors.
      (sharedSpark.uniforms as typeof sharedSpark.uniforms &
        PortalShaderUniforms).portalPass.value = 0;
      return;
    }
    setPortalShader(sharedSpark, camera, aperture, 4);
  }

  static prepareCutRendering(camera: THREE.Camera): void {
    // Mapping bases can change after an asynchronous LoD sort even when the
    // camera is stationary, so refresh owner ranges before the movement-based
    // cut-uniform fast path.
    if (sharedSpark) {
      setRenderOwnerShader(
        sharedSpark,
        activeSplatRenderOwnerId,
        activeSplatRenderSecondaryId,
        true,
        activeSplatRenderTertiaryId,
      );
      refreshCutOwnerRanges(
        sharedSpark,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
    }
    if (sharedPortalSpark) {
      setRenderOwnerShader(
        sharedPortalSpark,
        activeSplatRenderOwnerId,
        activeSplatRenderSecondaryId,
        true,
        activeSplatRenderTertiaryId,
      );
      refreshCutOwnerRanges(
        sharedPortalSpark,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
    }
    const positionMoved =
      camera.position.distanceToSquared(cutPrepareCameraPosition) > 1e-6;
    const rotationMoved =
      1 - Math.abs(camera.quaternion.dot(cutPrepareCameraQuaternion)) > 1e-6;
    if (!cutPrepareForce && !positionMoved && !rotationMoved) return;
    cutPrepareForce = false;
    cutPrepareCameraPosition.copy(camera.position);
    cutPrepareCameraQuaternion.copy(camera.quaternion);
    if (sharedSpark) {
      setCutShader(
        sharedSpark,
        camera,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
    }
    if (sharedPortalSpark) {
      setCutShader(
        sharedPortalSpark,
        camera,
        activeSplatCutVolumes,
        activeSplatTrimPlanes,
      );
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    portalLayers.delete(this);
    this.unregisterCollision();
    this.splat.dispose();
    if (splatByRoomId.get(this.world.id) === this.splat) {
      splatByRoomId.delete(this.world.id);
    }
    sharedSparkReferences = Math.max(0, sharedSparkReferences - 1);
    if (
      sharedSparkReferences === 0 &&
      sharedSparkPendingLoads === 0 &&
      sharedSpark
    ) {
      sharedSparkScene?.remove(sharedSpark);
      sharedSpark.dispose();
      if (sharedPortalSpark) {
        sharedSparkScene?.remove(sharedPortalSpark);
        sharedPortalSpark.dispose();
        sharedPortalSpark = null;
      }
      sharedSpark = null;
      sharedSparkScene = null;
    }
    this.collider.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.colliderBvhs.clear();
  }
}
