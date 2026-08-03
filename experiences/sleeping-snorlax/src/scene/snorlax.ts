import * as THREE from "three";
import { createMintGltfLoader } from "../loaders";
import { artifactMirrorUrl, localArtifactUrl } from "../assets";
import {
  BONE,
  BONE_COUNT,
  createPose,
  pickReaction,
  REACTION_MEMORY,
  resetPose,
  type Pose,
  type Reaction,
  type RigMotions,
} from "./reactions";
import { POSE_CONFIG, SNORLAX_PROFILE } from "./rigProfiles";
import {
  DEFAULT_GROWTH,
  GROWTH_PER_WAKE,
  growthCurve,
  growthWindow,
  type GrowthSettings,
} from "./growth";

export interface Snorlax {
  root: THREE.Group;
  /** The poke raycast target. */
  pokeTarget: THREE.Object3D;
  /** Tracks his mouth; the snore bubble rides here. */
  bubbleAnchor: THREE.Object3D;
  /** All three grow with him, so whatever reads them stays in proportion. */
  readonly sitHeight: number;
  readonly restHeight: number;
  readonly restFootprint: { width: number; depth: number };
  /** Current size multiplier; 1 at load, ×1.2 per wake, reset on refresh. */
  readonly growth: number;
  readonly breathPhase: number;
  readonly annoyance: number;
  readonly isWaking: boolean;
  /** Applies live — never reloads the model or resets his size. */
  setGrowthSettings(settings: GrowthSettings): void;
  onWake?: () => void;
  onImpact?: () => void;
  poke(worldPoint: THREE.Vector3, worldDirection: THREE.Vector3): void;
  update(dt: number): void;
  dispose(): void;
}

/** Overall size — his width in world units. Raise it to make him bigger. */
const TARGET_WIDTH = 13.6;

const BREATH_SECONDS = 4;
const MAX_POKES = 4;
const POKE_LIFETIME = 3;

// ~5 pokes/second fills the meter in about six seconds; one or two a second
// never gets there because decay outpaces the gain.
const ANNOY_PER_POKE = 0.055;
const ANNOY_DECAY = 0.11;

// Wake-up: heave up from lying, sit a while, flop back, land hard.
/**
 * The bubble bursts the instant the wake fires, so he holds still for a beat
 * first — the pop reads as what wakes him, rather than landing on top of him
 * already heaving upright.
 */
const WAKE_STIR_END = 0.5;
const WAKE_RISE_END = 1.7;
const WAKE_SIT_END = 4.2;
const WAKE_FALL_END = 4.95;
const WAKE_TOTAL = 6.6;

/** Phase times handed to the growth window, so the two cannot drift apart. */
const WAKE_TIMELINE = {
  riseStart: WAKE_STIR_END,
  riseEnd: WAKE_RISE_END,
  sitEnd: WAKE_SIT_END,
  fallEnd: WAKE_FALL_END,
  total: WAKE_TOTAL,
};
/** Limb splay applied while he sleeps. */
const SPRAWL_LEG = 1.15;
const SPRAWL_ARM = 0.3;

interface ShaderState {
  bones: THREE.Matrix4[];
  time: { value: number };
  pokePosTime: THREE.Vector4[];
  pokeDir: THREE.Vector4[];
  pokeRadius: number;
}

/**
 * Applies the bone deformation and poke dent in the vertex shader.
 *
 * `withNormals` is off for the depth material used to cast shadows: that
 * shader has no objectNormal to work with. Without this the shadow would be
 * cast from the undeformed mesh, so a sleeping Snorlax would throw a sitting
 * Snorlax's shadow.
 */
function injectDeformation(material: THREE.Material, state: ShaderState, withNormals = true) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = state.time;
    shader.uniforms.uBones = { value: state.bones };
    shader.uniforms.uPokeRadius = { value: state.pokeRadius };
    shader.uniforms.uPokePosTime = { value: state.pokePosTime };
    shader.uniforms.uPokeDir = { value: state.pokeDir };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform mat4 uBones[${BONE_COUNT}];
        uniform float uPokeRadius;
        uniform vec4 uPokePosTime[${MAX_POKES}];
        uniform vec4 uPokeDir[${MAX_POKES}];
        attribute vec4 aSkinA;
        attribute vec4 aSkinB;

        vec3 mintBoneOffset(vec3 pos) {
          vec3 d = vec3(0.0);
          d += aSkinA.x * ((uBones[0] * vec4(pos, 1.0)).xyz - pos);
          d += aSkinA.y * ((uBones[1] * vec4(pos, 1.0)).xyz - pos);
          d += aSkinA.z * ((uBones[2] * vec4(pos, 1.0)).xyz - pos);
          d += aSkinA.w * ((uBones[3] * vec4(pos, 1.0)).xyz - pos);
          d += aSkinB.x * ((uBones[4] * vec4(pos, 1.0)).xyz - pos);
          d += aSkinB.y * ((uBones[5] * vec4(pos, 1.0)).xyz - pos);
          d += aSkinB.z * ((uBones[6] * vec4(pos, 1.0)).xyz - pos);
          return d;
        }

        vec3 mintBoneNormal(vec3 n) {
          vec3 r = n;
          r += aSkinA.x * (mat3(uBones[0]) * n - n);
          r += aSkinA.y * (mat3(uBones[1]) * n - n);
          r += aSkinA.z * (mat3(uBones[2]) * n - n);
          r += aSkinA.w * (mat3(uBones[3]) * n - n);
          r += aSkinB.x * (mat3(uBones[4]) * n - n);
          r += aSkinB.y * (mat3(uBones[5]) * n - n);
          r += aSkinB.z * (mat3(uBones[6]) * n - n);
          return normalize(r);
        }
        `,
      )
      .replace(
        "#include <beginnormal_vertex>",
        withNormals
          ? /* glsl */ `
        #include <beginnormal_vertex>
        objectNormal = mintBoneNormal(objectNormal);
        `
          : "#include <beginnormal_vertex>",
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        transformed += mintBoneOffset(position);
        for (int i = 0; i < ${MAX_POKES}; i++) {
          float pokeStart = uPokePosTime[i].w;
          float pokeAge = uTime - pokeStart;
          if (pokeStart < 0.0 || pokeAge < 0.0 || pokeAge > ${POKE_LIFETIME.toFixed(1)}) continue;
          vec3 pokePos = uPokePosTime[i].xyz;
          vec3 pokeDir = uPokeDir[i].xyz;
          float pokeStrength = uPokeDir[i].w;
          float nd = distance(position, pokePos) / uPokeRadius;
          // Soft dent right at the poke point: quick press-in, smooth release.
          float press = exp(-pokeAge * 4.0) * smoothstep(0.0, 0.07, pokeAge);
          float dent = exp(-nd * nd * 5.5);
          transformed += pokeDir * (uPokeRadius * 0.2 * pokeStrength * press * dent);
          ${withNormals ? /* glsl */ `
          // Fluid ripple traveling outward from the dent, like a water balloon.
          float wave = sin(9.0 * nd - 7.5 * pokeAge) * exp(-nd * 1.7) * exp(-pokeAge * 1.8);
          transformed += objectNormal * (uPokeRadius * 0.05 * pokeStrength * wave * smoothstep(0.04, 0.22, pokeAge));
          ` : ""}
        }
        `,
      );
  };
  material.needsUpdate = true;
}

export async function loadSnorlax(): Promise<Snorlax> {
  const profile = SNORLAX_PROFILE;
  const loader = createMintGltfLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(localArtifactUrl(profile.assetKey, "original_glb"));
  } catch (error) {
    // Hosts that ship source only have no local binary; fall back to the CDN.
    const mirror = artifactMirrorUrl(profile.assetKey, "original_glb");
    if (!mirror) throw error;
    gltf = await loader.loadAsync(mirror);
  }
  const model = gltf.scene;

  let found: THREE.Mesh | null = null;
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && !found) found = child as THREE.Mesh;
  });
  if (!found) throw new Error("The Snorlax model contains no mesh.");
  const bodyMesh = found as THREE.Mesh;

  // Paint bone weights from normalized position.
  const geometry = bodyMesh.geometry;
  geometry.computeBoundingBox();
  const localBox = geometry.boundingBox!;
  const localCenter = localBox.getCenter(new THREE.Vector3());
  const localHalf = localBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  localHalf.set(Math.max(localHalf.x, 1e-6), Math.max(localHalf.y, 1e-6), Math.max(localHalf.z, 1e-6));

  const positionAttr = geometry.getAttribute("position");
  const skinA = new Float32Array(positionAttr.count * 4);
  const skinB = new Float32Array(positionAttr.count * 4);
  for (let i = 0; i < positionAttr.count; i += 1) {
    const w = profile.weights(
      (positionAttr.getX(i) - localCenter.x) / localHalf.x,
      (positionAttr.getY(i) - localCenter.y) / localHalf.y,
      (positionAttr.getZ(i) - localCenter.z) / localHalf.z,
    );
    skinA[i * 4] = w[0];
    skinA[i * 4 + 1] = w[1];
    skinA[i * 4 + 2] = w[2];
    skinA[i * 4 + 3] = w[3];
    skinB[i * 4] = w[4];
    skinB[i * 4 + 1] = w[5];
    skinB[i * 4 + 2] = w[6];
  }
  geometry.setAttribute("aSkinA", new THREE.BufferAttribute(skinA, 4));
  geometry.setAttribute("aSkinB", new THREE.BufferAttribute(skinB, 4));

  const toLocal = (n: [number, number, number]) =>
    new THREE.Vector3(
      localCenter.x + n[0] * localHalf.x,
      localCenter.y + n[1] * localHalf.y,
      localCenter.z + n[2] * localHalf.z,
    );
  const pivots = profile.pivots.map(toLocal);
  const mouthLocal = toLocal(profile.mouth);

  geometry.computeBoundingSphere();
  const state: ShaderState = {
    bones: Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4()),
    time: { value: 0 },
    pokePosTime: Array.from({ length: MAX_POKES }, () => new THREE.Vector4(0, 0, 0, -1)),
    pokeDir: Array.from({ length: MAX_POKES }, () => new THREE.Vector4(0, 0, 1, 0)),
    pokeRadius: (geometry.boundingSphere?.radius ?? 1) * 0.5,
  };

  // Keep the generated felt finish matte rather than plastic.
  const material = bodyMesh.material as THREE.MeshStandardMaterial;
  if (material.isMeshStandardMaterial) {
    material.roughness = Math.max(material.roughness, 0.95);
    material.metalness = 0;
    material.envMapIntensity = 0.35;
  }
  injectDeformation(material, state);

  // Shadows are cast from a depth material, which knows nothing about the
  // deformation above, so give it the same treatment or the shadow keeps the
  // sculpted sitting pose while he lies down.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  injectDeformation(depthMaterial, state, false);
  bodyMesh.customDepthMaterial = depthMaterial;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;

  // Scale up and rest the sculpted sitting pose on the ground plane.
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = TARGET_WIDTH / (Math.max(size.x, size.z) || 1);
  model.scale.setScalar(scale);
  bounds.setFromObject(model);
  const worldCenter = bounds.getCenter(new THREE.Vector3());
  model.position.x -= worldCenter.x;
  model.position.z -= worldCenter.z;
  model.position.y -= bounds.min.y;
  bounds.setFromObject(model);

  const sculptHeight = bounds.max.y - bounds.min.y;
  const sculptDepth = bounds.max.z - bounds.min.z;
  const sculptWidth = bounds.max.x - bounds.min.x;
  const backZ = bounds.min.z;

  const sitHeight = sculptHeight;
  // Asleep he is tipped onto his back, so his depth becomes his height.
  const restHeight = sculptDepth * 0.7;
  const restFootprint = { width: sculptWidth, depth: sculptHeight };

  // root → ground → squash → center → wobble → lay hinge → breath → model
  const breathGroup = new THREE.Group();
  breathGroup.add(model);
  const layInner = new THREE.Group();
  layInner.position.z = -backZ;
  layInner.add(breathGroup);
  const layPivot = new THREE.Group();
  layPivot.position.z = backZ;
  layPivot.add(layInner);
  const wobbleGroup = new THREE.Group();
  wobbleGroup.add(layPivot);
  const centerGroup = new THREE.Group();
  centerGroup.add(wobbleGroup);
  const squashGroup = new THREE.Group();
  squashGroup.add(centerGroup);
  // Growth sits *below* groundGroup on purpose: the re-planting below writes a
  // world-space delta into groundGroup.position, which is only correct while
  // nothing above it is scaled.
  const growthGroup = new THREE.Group();
  growthGroup.add(squashGroup);
  const groundGroup = new THREE.Group();
  groundGroup.add(growthGroup);
  const root = new THREE.Group();
  root.add(groundGroup);

  const bubbleAnchor = new THREE.Object3D();
  breathGroup.add(bubbleAnchor);

  // Sampled vertices used to re-plant his true lowest point every frame.
  const groundSamples: { p: THREE.Vector3; bones: { index: number; weight: number }[] }[] = [];
  const sampleStride = Math.max(1, Math.floor(positionAttr.count / 300));
  for (let i = 0; i < positionAttr.count; i += sampleStride) {
    const weights = [
      skinA[i * 4], skinA[i * 4 + 1], skinA[i * 4 + 2], skinA[i * 4 + 3],
      skinB[i * 4], skinB[i * 4 + 1], skinB[i * 4 + 2],
    ];
    const bones: { index: number; weight: number }[] = [];
    for (let b = 0; b < BONE_COUNT; b += 1) {
      if (weights[b] > 0.01) bones.push({ index: b, weight: weights[b] });
    }
    groundSamples.push({
      p: new THREE.Vector3(positionAttr.getX(i), positionAttr.getY(i), positionAttr.getZ(i)),
      bones,
    });
  }

  const motions: RigMotions = profile.motions;
  const pose: Pose = createPose();
  const euler = new THREE.Euler();
  const pre = new THREE.Matrix4();
  const post = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const headMatrix = new THREE.Matrix4();
  const mouthWorking = new THREE.Vector3();
  const skinWorking = new THREE.Vector3();
  const skinOffset = new THREE.Vector3();
  const inverseMatrix = new THREE.Matrix4();
  const localPoint = new THREE.Vector3();
  const localDir = new THREE.Vector3();

  function composeBones() {
    for (let i = 0; i < BONE_COUNT; i += 1) {
      const bone = pose[i];
      const pivot = pivots[i];
      euler.set(bone.rx, bone.ry, bone.rz);
      rot.makeRotationFromEuler(euler);
      pre.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
      post.makeTranslation(pivot.x + bone.tx, pivot.y + bone.ty, pivot.z + bone.tz);
      state.bones[i].multiplyMatrices(post, rot.multiply(pre));
    }
    headMatrix.copy(state.bones[BONE.HEAD]);
  }

  let elapsed = 0;
  let breathPhase = 0;
  let annoyance = 0;
  let squash = 0;
  let squashVelocity = 0;
  let upright = 0;
  let pokeSlot = 0;

  let activeReaction: Reaction | null = null;
  let reactionTime = 0;
  let reactionAmp = 1;
  let reactionSide = 1;
  /** The last few reactions played, so the picker can avoid repeating them. */
  const recentReactions: Reaction[] = [];
  let wakeTime = -1;

  let growthSettings: GrowthSettings = { ...DEFAULT_GROWTH };
  let growthCurrent = 1;
  let growthFrom = 1;
  let growthTarget = 1;

  /** Authored wake gestures, written semantically. */
  function applyWakeGestures(m: RigMotions) {
    if (wakeTime < 0) return;
    const t = wakeTime;
    if (t < WAKE_STIR_END) {
      // The pop just went off. He only stirs — a twitch and a breath in.
      const k = t / WAKE_STIR_END;
      m.headNod(pose, 0.08 * Math.sin(k * Math.PI * 2));
      m.bellyPush(pose, 0.02 * Math.sin(k * Math.PI));
    } else if (t < WAKE_RISE_END) {
      const k = (t - WAKE_STIR_END) / (WAKE_RISE_END - WAKE_STIR_END);
      const eased = 1 - Math.pow(1 - k, 2.3);
      // His head lolls back at first, then catches up with his body.
      m.headNod(pose, 0.22 * Math.sin(k * Math.PI));
      m.armSweep(pose, -1, 0.28 * eased);
      m.armSweep(pose, 1, 0.28 * eased);
    } else if (t < WAKE_SIT_END) {
      // Sitting up, groggy: looks around and rubs an eye.
      const k = (t - WAKE_RISE_END) / (WAKE_SIT_END - WAKE_RISE_END);
      m.headYaw(pose, 0.32 * Math.sin(k * Math.PI * 2.2));
      m.headTilt(pose, 0.08 * Math.sin(k * Math.PI * 3.1));
      const rub = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (k - 0.18) / 0.5))));
      m.armLift(pose, 1, (0.75 + 0.14 * Math.sin(k * 24)) * rub);
      m.armSweep(pose, 1, 0.35 * rub);
    } else if (t < WAKE_FALL_END) {
      const k = (t - WAKE_SIT_END) / (WAKE_FALL_END - WAKE_SIT_END);
      m.armSweep(pose, -1, 0.3 * k);
      m.armSweep(pose, 1, 0.3 * k);
      m.headNod(pose, -0.25 * k * k);
    } else {
      const k = (t - WAKE_FALL_END) / (WAKE_TOTAL - WAKE_FALL_END);
      const decay = Math.exp(-3.6 * k);
      // Legs kick up from the impact, then wobble down to rest.
      m.legKick(pose, -1, 0.75 * decay * Math.sin(Math.PI * 4.2 * k));
      m.legKick(pose, 1, 0.62 * decay * Math.sin(Math.PI * 4.2 * k + 0.5));
      const bounce = decay * Math.sin(Math.PI * 5 * k);
      m.bellyPush(pose, 0.032 * bounce);
      m.headNod(pose, 0.14 * bounce);
    }
  }

  const api: Snorlax = {
    root,
    pokeTarget: wobbleGroup,
    bubbleAnchor,
    get sitHeight() {
      return sitHeight * growthCurrent;
    },
    get restHeight() {
      return restHeight * growthCurrent;
    },
    get restFootprint() {
      return {
        width: restFootprint.width * growthCurrent,
        depth: restFootprint.depth * growthCurrent,
      };
    },
    get growth() {
      return growthCurrent;
    },
    setGrowthSettings(settings) {
      growthSettings = { ...settings };
    },
    get breathPhase() {
      return breathPhase;
    },
    get annoyance() {
      return annoyance;
    },
    get isWaking() {
      return wakeTime >= 0;
    },
    poke(worldPoint, worldDirection) {
      const slot = pokeSlot;
      pokeSlot = (pokeSlot + 1) % MAX_POKES;
      bodyMesh.updateMatrixWorld();
      inverseMatrix.copy(bodyMesh.matrixWorld).invert();
      localPoint.copy(worldPoint).applyMatrix4(inverseMatrix);
      localDir.copy(worldDirection).transformDirection(inverseMatrix).normalize();
      const strength = 1 + annoyance * 0.6;
      state.pokePosTime[slot].set(localPoint.x, localPoint.y, localPoint.z, elapsed);
      state.pokeDir[slot].set(localDir.x, localDir.y, localDir.z, strength);
      squashVelocity -= 1.0 * strength;

      if (wakeTime >= 0) return;

      annoyance = Math.min(1, annoyance + ANNOY_PER_POKE);
      if (annoyance >= 1) {
        wakeTime = 0;
        activeReaction = null;
        // Every waking leaves him permanently bigger.
        growthFrom = growthCurrent;
        growthTarget = growthCurrent * GROWTH_PER_WAKE;
        api.onWake?.();
        return;
      }
      // Reactions grow bigger and more varied as annoyance climbs.
      if (!activeReaction || reactionTime > activeReaction.duration * 0.55) {
        activeReaction = pickReaction(annoyance, recentReactions);
        recentReactions.push(activeReaction);
        if (recentReactions.length > REACTION_MEMORY) recentReactions.shift();
        reactionTime = 0;
        reactionAmp = 0.45 + annoyance * 0.85;
        reactionSide = localPoint.x < 0 ? -1 : 1;
      }
    },
    update(dt: number) {
      elapsed += dt;
      state.time.value = elapsed;
      breathPhase = (elapsed % BREATH_SECONDS) / BREATH_SECONDS;
      const breath = Math.sin(breathPhase * Math.PI * 2);

      if (wakeTime >= 0) {
        wakeTime += dt;
        const t = wakeTime;
        if (t < WAKE_STIR_END) {
          // Still flat out: the bubble has popped but he has not moved yet.
          upright = 0;
        } else if (t < WAKE_RISE_END) {
          const k = (t - WAKE_STIR_END) / (WAKE_RISE_END - WAKE_STIR_END);
          const eased = 1 - Math.pow(1 - k, 2.3);
          // A touch of overshoot so he rocks up rather than gliding.
          upright = POSE_CONFIG.maxUpright * Math.min(1, eased * (1 + 0.06 * Math.sin(k * Math.PI)));
        } else if (t < WAKE_SIT_END) {
          upright = POSE_CONFIG.maxUpright;
        } else if (t < WAKE_FALL_END) {
          const k = (t - WAKE_SIT_END) / (WAKE_FALL_END - WAKE_SIT_END);
          upright = POSE_CONFIG.maxUpright * (1 - k * k);
        } else {
          if (wakeTime - dt < WAKE_FALL_END) {
            squashVelocity -= 3.6; // body-slam squash
            api.onImpact?.();
          }
          upright = 0;
        }
        // Inflate somewhere inside the wake, per the chosen timing and feel.
        const window = growthWindow(growthSettings.when, WAKE_TIMELINE);
        if (t >= window.start && growthTarget !== growthFrom) {
          const k = Math.min(1, (t - window.start) / window.duration);
          growthCurrent = growthFrom + (growthTarget - growthFrom) * growthCurve(growthSettings.feel, k);
        }

        if (t >= WAKE_TOTAL) {
          wakeTime = -1;
          annoyance = 0;
          upright = 0;
          // Land exactly on the target even if the window was cut short by a
          // settings change mid-wake.
          growthCurrent = growthTarget;
          growthFrom = growthTarget;
        }
      } else {
        annoyance = Math.max(0, annoyance - ANNOY_DECAY * dt);
        upright = 0;
        if (activeReaction) {
          reactionTime += dt;
          if (reactionTime >= activeReaction.duration) activeReaction = null;
        }
      }

      resetPose(pose);
      if (activeReaction) {
        activeReaction.apply(reactionTime, reactionAmp, reactionSide, pose, motions);
      }
      applyWakeGestures(motions);
      motions.bellyPush(pose, breath * 0.02);
      motions.headNod(pose, breath * 0.012);

      // Sprawl his limbs out as he lies down, so he is not a sitting sculpture
      // tipped onto its back.
      const down = 1 - upright;
      pose[BONE.FOOT_L].rx += SPRAWL_LEG * POSE_CONFIG.sprawl * down;
      pose[BONE.FOOT_R].rx += SPRAWL_LEG * POSE_CONFIG.sprawl * down;
      pose[BONE.ARM_L].rz += SPRAWL_ARM * POSE_CONFIG.sprawl * down;
      pose[BONE.ARM_R].rz += -SPRAWL_ARM * POSE_CONFIG.sprawl * down;

      composeBones();

      // Lying is a deformation of the sculpted sitting pose: tip him back onto
      // his shoulders, then squash him flat into the grass.
      layPivot.rotation.x = -(Math.PI / 2) * down;
      squashGroup.scale.y = 1 - POSE_CONFIG.flatten * down;
      // Keep both the sitting and sleeping silhouettes centred on the origin.
      centerGroup.position.z = sculptHeight * 0.5 * down;

      breathGroup.scale.setScalar(1 + breath * 0.008);
      growthGroup.scale.setScalar(growthCurrent);

      const stiffness = 34;
      const damping = 5.5;
      squashVelocity += (-stiffness * squash - damping * squashVelocity) * dt;
      squash += squashVelocity * dt;
      const clamped = THREE.MathUtils.clamp(squash, -0.12, 0.12);
      wobbleGroup.scale.set(1 - clamped * 0.5, 1 + clamped, 1 - clamped * 0.5);

      // Keep the snore bubble on the mouth as the head moves.
      mouthWorking.copy(mouthLocal).applyMatrix4(headMatrix);
      bubbleAnchor.position.set(
        mouthWorking.x * scale + model.position.x,
        mouthWorking.y * scale + model.position.y,
        mouthWorking.z * scale + model.position.z,
      );

      // Re-plant his true lowest point: tipping swings parts of him through the
      // ground by amounts that vary per pose.
      root.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const sample of groundSamples) {
        skinWorking.copy(sample.p);
        for (const bone of sample.bones) {
          skinOffset.copy(sample.p).applyMatrix4(state.bones[bone.index]).sub(sample.p);
          skinWorking.addScaledVector(skinOffset, bone.weight);
        }
        skinWorking.applyMatrix4(bodyMesh.matrixWorld);
        if (skinWorking.y < lowest) lowest = skinWorking.y;
      }
      if (Number.isFinite(lowest)) {
        // Pure Y translation, so this correction lands this same frame.
        groundGroup.position.y += root.position.y - lowest;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      root.removeFromParent();
    },
  };

  composeBones();
  return api;
}
