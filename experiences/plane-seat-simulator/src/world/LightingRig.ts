import * as THREE from "three";
import { DIMS } from "../data/cabin-layout";
import type { LightingPreset } from "../state/AppState";
import type { SkyColors, SkyEnvironment } from "./SkyEnvironment";

interface PresetValues {
  sky: SkyColors;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  cabinIntensity: number;
  cabinColor: number;
  exposure: number;
}

const PRESETS: Record<LightingPreset, PresetValues> = {
  day: {
    sky: { top: 0x3f7fd6, bottom: 0xdcecfa, cloudTint: 0xffffff, cloudOpacity: 0.9, stars: 0 },
    sunColor: 0xfff8ec,
    sunIntensity: 2.2,
    sunPosition: [30, 26, -10],
    hemiSky: 0xffffff,
    hemiGround: 0xb9bec7,
    hemiIntensity: 1.5,
    cabinIntensity: 0.5,
    cabinColor: 0xffffff,
    exposure: 1.15,
  },
  sunset: {
    sky: { top: 0x3b3f77, bottom: 0xf2925c, cloudTint: 0xffc9a1, cloudOpacity: 0.85, stars: 0 },
    sunColor: 0xff9a4d,
    sunIntensity: 1.9,
    sunPosition: [40, 6, 8],
    hemiSky: 0xe0a98e,
    hemiGround: 0x6d6a70,
    hemiIntensity: 0.85,
    cabinIntensity: 0.85,
    cabinColor: 0xffe9c8,
    exposure: 1.05,
  },
  night: {
    sky: { top: 0x060a18, bottom: 0x101a30, cloudTint: 0x2a3450, cloudOpacity: 0.5, stars: 0.9 },
    sunColor: 0x8fa8cc,
    sunIntensity: 0.12,
    sunPosition: [-20, 30, 10],
    hemiSky: 0x3a4356,
    hemiGround: 0x23252b,
    hemiIntensity: 0.5,
    cabinIntensity: 1.35,
    cabinColor: 0xfff0d8,
    exposure: 1.0,
  },
};

/** Owns all lights; presets swap parameters, never rebuild the rig. */
export class LightingRig {
  readonly group = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private cabinLights: THREE.PointLight[] = [];

  constructor(private sky: SkyEnvironment, private renderer: THREE.WebGLRenderer) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.group.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.group.add(this.hemi);
    const count = 8;
    for (let i = 0; i < count; i++) {
      const z = 1.4 + ((DIMS.length - 2.4) * i) / (count - 1);
      const light = new THREE.PointLight(0xffffff, 0.5, 7, 1.7);
      light.position.set(0, DIMS.height - 0.12, z);
      this.cabinLights.push(light);
      this.group.add(light);
    }
    this.apply("day");
  }

  apply(preset: LightingPreset) {
    const p = PRESETS[preset];
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.position.set(...p.sunPosition);
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    for (const light of this.cabinLights) {
      light.intensity = p.cabinIntensity;
      light.color.setHex(p.cabinColor);
    }
    this.sky.applyColors(p.sky);
    this.renderer.toneMappingExposure = p.exposure;
  }
}
