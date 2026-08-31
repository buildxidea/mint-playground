import * as THREE from 'three';

export interface SwimUniforms {
  uTime: { value: number };
  uSwimAmp: { value: number };
  uSwimFreq: { value: number };
  uSwimSpeed: { value: number };
  uBodyHalf: { value: number };
  uPhase: { value: number };
}

export interface SwimOptions {
  /** Sideways travel of the tail, in local units. */
  amplitude: number;
  /** Waves per unit along the body. */
  frequency: number;
  /** Beat rate. */
  speed: number;
  /** Half the body length along local Z. */
  bodyHalf: number;
  /** Offset so a pod does not beat in lockstep. */
  phase?: number;
}

/**
 * Bend a creature's mesh with a travelling sine wave running from head to tail.
 *
 * This is what makes an animal read as swimming rather than sliding: the body
 * flexes, weighted so the nose barely moves and the tail sweeps widest. Mint's
 * rigged animation sets are humanoid-only, so the motion is done in the vertex
 * shader instead of on a skeleton.
 *
 * Materials are cloned per creature so each individual keeps its own phase.
 */
export function applySwimFlex(root: THREE.Object3D, options: SwimOptions): SwimUniforms {
  const uniforms: SwimUniforms = {
    uTime: { value: 0 },
    uSwimAmp: { value: options.amplitude },
    uSwimFreq: { value: options.frequency },
    uSwimSpeed: { value: options.speed },
    uBodyHalf: { value: Math.max(options.bodyHalf, 0.001) },
    uPhase: { value: options.phase ?? 0 },
  };

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material;
    const material = Array.isArray(source)
      ? source.map((entry) => entry.clone())
      : (source as THREE.Material).clone();
    child.material = material;

    const patch = (target: THREE.Material) => {
      target.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
             uniform float uTime;
             uniform float uSwimAmp;
             uniform float uSwimFreq;
             uniform float uSwimSpeed;
             uniform float uBodyHalf;
             uniform float uPhase;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             {
               // 0 at the tail, 1 at the nose.
               float along = clamp((transformed.z + uBodyHalf) / (2.0 * uBodyHalf), 0.0, 1.0);
               // The head stays steady; the tail sweeps widest.
               float weight = pow(1.0 - along, 1.6);
               float phase = transformed.z * uSwimFreq - uTime * uSwimSpeed + uPhase;
               transformed.x += sin(phase) * uSwimAmp * weight;
             }`,
          );
      };
      target.needsUpdate = true;
    };

    if (Array.isArray(material)) material.forEach(patch);
    else patch(material);
  });

  return uniforms;
}

/** Orient a creature nose-forward along +Z, scale it, and centre it on the origin. */
export function prepareCreature(
  model: THREE.Object3D,
  targetLength: number,
  extraYaw = 0,
): { bodyHalf: number; height: number } {
  const rawSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  if (rawSize.x > rawSize.z) model.rotateY(Math.PI / 2);
  if (extraYaw) model.rotateY(extraYaw);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = targetLength / Math.max(size.z, 0.001);
  model.scale.multiplyScalar(scale);

  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.sub(center);

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
    }
  });

  const finalSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  return { bodyHalf: finalSize.z / 2, height: finalSize.y };
}
