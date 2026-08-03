import * as THREE from 'three';

export type MintColliderMeshData = {
  name: string;
  vertices: Float32Array;
  indices: Uint32Array;
  triangles: number;
};

function buildTriangleIndices(geometry: THREE.BufferGeometry, vertexCount: number): Uint32Array {
  const source = geometry.getIndex();
  const indexCount = source?.count ?? vertexCount;
  if (indexCount % 3 !== 0) {
    throw new Error('Mint World collider geometry must contain complete triangles');
  }

  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    const vertexIndex = source ? source.getX(index) : index;
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
      throw new Error('Mint World collider geometry contains an invalid vertex index');
    }
    indices[index] = vertexIndex;
  }
  return indices;
}

/**
 * Bakes the complete World/collider hierarchy into simulation-space triangle
 * data. Rapier therefore receives the exact same root correction as Spark.
 */
export function extractMintColliderMeshes(root: THREE.Object3D): MintColliderMeshData[] {
  root.updateWorldMatrix(true, true);
  const meshes: MintColliderMeshData[] = [];

  const appendMesh = (
    geometry: THREE.BufferGeometry,
    worldMatrix: THREE.Matrix4,
    name: string,
  ): void => {
    const position = geometry.getAttribute('position');
    if (!position || position.itemSize < 3 || position.count < 3) return;
    const indices = buildTriangleIndices(geometry, position.count);
    if (indices.length === 0) return;

    const vertices = new Float32Array(position.count * 3);
    const point = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      point
        .set(position.getX(index), position.getY(index), position.getZ(index))
        .applyMatrix4(worldMatrix);
      if (![point.x, point.y, point.z].every(Number.isFinite)) {
        throw new Error('Mint World collider geometry produced a non-finite transformed vertex');
      }
      const offset = index * 3;
      vertices[offset] = point.x;
      vertices[offset + 1] = point.y;
      vertices[offset + 2] = point.z;
    }

    if (worldMatrix.determinant() < 0) {
      for (let index = 0; index < indices.length; index += 3) {
        const swap = indices[index + 1];
        indices[index + 1] = indices[index + 2];
        indices[index + 2] = swap;
      }
    }
    meshes.push({
      name,
      vertices,
      indices,
      triangles: indices.length / 3,
    });
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) return;

    const instancedMesh = object as THREE.InstancedMesh;
    if (instancedMesh.isInstancedMesh) {
      const instanceMatrix = new THREE.Matrix4();
      const worldMatrix = new THREE.Matrix4();
      for (let index = 0; index < instancedMesh.count; index += 1) {
        instancedMesh.getMatrixAt(index, instanceMatrix);
        worldMatrix.multiplyMatrices(instancedMesh.matrixWorld, instanceMatrix);
        appendMesh(
          instancedMesh.geometry,
          worldMatrix,
          `${instancedMesh.name || 'collider-instance'}:${index}`,
        );
      }
      return;
    }

    appendMesh(mesh.geometry, mesh.matrixWorld, mesh.name || `collider-mesh-${meshes.length + 1}`);
  });

  return meshes;
}
