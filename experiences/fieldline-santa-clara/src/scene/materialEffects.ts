import * as THREE from "three";

export function applyCameraProximityFade(
  input: THREE.Material | THREE.Material[],
  radiusM: number,
): void {
  const materials = Array.isArray(input) ? input : [input];
  for (const material of materials) {
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vFieldlineWorldPosition;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vFieldlineWorldPosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          #else
            vFieldlineWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vFieldlineWorldPosition;",
        )
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>
          if (distance(vFieldlineWorldPosition, cameraPosition) < ${radiusM.toFixed(3)}) discard;`,
        );
    };
    material.customProgramCacheKey = () => `${previousKey()}|fieldline-camera-fade-${radiusM}`;
    material.needsUpdate = true;
  }
}
