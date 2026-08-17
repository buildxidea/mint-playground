import * as THREE from "three";
import type { EraGrade } from "./EraGrades";

/**
 * The one procedural studio set: seamless floor, curved cyclorama, plinth,
 * and a light rig. Geometry never changes; every era restyles it.
 */
export class Studio {
  readonly group = new THREE.Group();
  private floorMat: THREE.MeshStandardMaterial;
  private cycMat: THREE.MeshStandardMaterial;
  private key: THREE.SpotLight;
  private fill: THREE.DirectionalLight;
  private rimA: THREE.SpotLight;
  private rimB: THREE.SpotLight;
  private ambient: THREE.HemisphereLight;

  constructor() {
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x33363b, roughness: 0.3, metalness: 0.0,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // curved cyclorama — a big open cylinder behind the car
    this.cycMat = new THREE.MeshStandardMaterial({
      color: 0x24262a, roughness: 0.95, metalness: 0,
      side: THREE.BackSide,
    });
    const cyc = new THREE.Mesh(
      new THREE.CylinderGeometry(34, 34, 26, 48, 1, true),
      this.cycMat,
    );
    cyc.position.y = 12.8;
    this.group.add(cyc);

    this.key = new THREE.SpotLight(0xffffff, 300, 0, Math.PI / 5, 0.45, 1.6);
    this.key.position.set(5.5, 7.5, 4.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    this.group.add(this.key, this.key.target);

    this.fill = new THREE.DirectionalLight(0xffffff, 0.8);
    this.fill.position.set(-6, 4, 6);
    this.group.add(this.fill);

    this.rimA = new THREE.SpotLight(0xffffff, 150, 0, Math.PI / 4, 0.6, 1.8);
    this.rimA.position.set(-7, 3.2, -6);
    this.group.add(this.rimA, this.rimA.target);

    this.rimB = new THREE.SpotLight(0xffffff, 150, 0, Math.PI / 4, 0.6, 1.8);
    this.rimB.position.set(7.5, 2.6, -5.5);
    this.group.add(this.rimB, this.rimB.target);

    this.ambient = new THREE.HemisphereLight(0xdfe4ea, 0x14161a, 0.4);
    this.group.add(this.ambient);

    [this.key, this.rimA, this.rimB].forEach((l) => {
      l.target.position.set(0, 0.7, 0);
    });
  }

  applyGrade(g: EraGrade) {
    this.key.color.copy(g.key);
    this.key.intensity = g.keyIntensity;
    this.fill.color.copy(g.fill);
    this.fill.intensity = g.fillIntensity;
    this.rimA.color.copy(g.rimA);
    this.rimB.color.copy(g.rimB);
    this.rimA.intensity = g.rimIntensity;
    this.rimB.intensity = g.rimIntensity;
    this.ambient.intensity = g.ambient;
    this.floorMat.color.copy(g.floor);
    this.floorMat.roughness = g.floorRoughness;
    this.cycMat.color.copy(g.cyc);
  }
}
