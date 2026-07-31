import * as THREE from 'three';
import type { ElementData } from './types';
import { CATEGORY_COLOR, CATEGORY_LABEL } from './categories';
import {
  makeGlowTexture,
  makeParticleTexture,
  makePanelTexture,
  makeSummaryTexture,
  makeTitleTexture,
  type PanelRow,
} from './textures';

const fmt = (v: number | null | undefined, unit = '', digits = 3): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  let s: string;
  if (abs !== 0 && (abs < 0.001 || abs >= 100000)) s = v.toExponential(2);
  else s = Number(v.toFixed(abs >= 100 ? 1 : digits)).toString();
  return unit ? `${s} ${unit}` : s;
};

const fmtTemp = (k: number | null): string => {
  if (k === null || !Number.isFinite(k)) return '—';
  return `${fmt(k, 'K', 2)} (${fmt(k - 273.15, '°C', 2)})`;
};

const str = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

export interface PanelSection {
  title: string;
  rows: PanelRow[];
}

/** The element's property sheet, grouped into titled sections with units. */
export function buildSections(el: ElementData): PanelSection[] {
  return [
    {
      title: 'Identity',
      rows: [
        { label: 'Name', value: el.name },
        { label: 'Symbol', value: el.symbol },
        { label: 'Atomic number', value: String(el.z) },
        { label: 'Atomic mass', value: fmt(el.mass, 'u') },
        { label: 'Category', value: CATEGORY_LABEL[el.category] },
        { label: 'Period · Group', value: `${el.period ?? '—'} · ${el.group ?? '—'}` },
        { label: 'Phase (STP)', value: str(el.phase) },
        { label: 'Discovered', value: str(el.yearDiscovered) },
        { label: 'Discovered by', value: str(el.discoveredBy) },
      ],
    },
    {
      title: 'Atomic structure',
      rows: [
        { label: 'Protons', value: String(el.z) },
        { label: 'Neutrons', value: el.neutrons !== null ? String(el.neutrons) : '—' },
        { label: 'Electrons', value: String(el.z) },
        { label: 'Shells', value: el.shells.join(' · ') },
        { label: 'Configuration', value: str(el.ecSemantic) },
        { label: 'Full config', value: str(el.ecFull) },
      ],
    },
    {
      title: 'Chemical',
      rows: [
        { label: 'Electronegativity', value: fmt(el.electronegativity, 'Pauling') },
        { label: '1st ionization', value: fmt(el.ionizationEnergy, 'kJ/mol') },
        { label: 'Electron affinity', value: fmt(el.electronAffinity, 'kJ/mol') },
        { label: 'Oxidation states', value: str(el.oxidationStates) },
        { label: 'Atomic radius', value: fmt(el.atomicRadius, 'pm') },
        { label: 'Covalent radius', value: fmt(el.covalentRadius, 'pm') },
      ],
    },
    {
      title: 'Physical & mechanical',
      rows: [
        { label: 'Density', value: fmt(el.density, el.densityUnit) },
        { label: 'Melting point', value: fmtTemp(el.melt) },
        { label: 'Boiling point', value: fmtTemp(el.boil) },
        { label: 'Molar heat', value: fmt(el.molarHeat, 'J/(mol·K)') },
        { label: 'Thermal cond.', value: fmt(el.thermalConductivity, 'W/(m·K)') },
        { label: 'Electrical cond.', value: fmt(el.electricalConductivity, 'MS/m') },
        { label: 'Mohs hardness', value: fmt(el.mohs) },
        { label: "Young's modulus", value: fmt(el.youngs, 'GPa') },
      ],
    },
  ];
}

interface ShellRing {
  group: THREE.Group;
  radius: number;
  electronCount: number;
  speed: number;
  phase: number;
}

/**
 * The inside of one element: an animated Bohr-model atom in a dark void,
 * surrounded by floating data panels. Built on demand, disposed on exit.
 */
export class AtomScene {
  readonly scene = new THREE.Scene();
  readonly camDistance: number;
  readonly maxShellRadius: number;

  private rings: ShellRing[] = [];
  private electrons: THREE.InstancedMesh;
  private nucleus = new THREE.Group();
  private particles: THREE.Points;
  private panels: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private dummy = new THREE.Object3D();
  private time = 0;

  constructor(el: ElementData, lowQuality: boolean, aspect: number, htmlPanels: boolean) {
    this.scene.background = new THREE.Color(0x020204);
    const accentHex = CATEGORY_COLOR[el.category];
    const accent = new THREE.Color(accentHex);
    const accentCss = `#${accent.getHexString()}`;

    // ---- nucleus ----------------------------------------------------------
    const protons = el.z;
    const neutrons = el.neutrons ?? 0;
    const nucleons = protons + neutrons;
    const nucleusRadius = 0.16 * Math.cbrt(nucleons) + 0.12;

    const nucleonGeo = new THREE.SphereGeometry(0.085, lowQuality ? 8 : 12, lowQuality ? 8 : 12);
    this.disposables.push(nucleonGeo);
    const nucleonMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.1,
      emissive: 0x222222,
    });
    this.disposables.push(nucleonMat);
    const nucleons3d = new THREE.InstancedMesh(nucleonGeo, nucleonMat, nucleons);
    const protonColor = new THREE.Color(0xff6a5e);
    const neutronColor = new THREE.Color(0xb9c2cf);
    // deterministic ball packing: golden-spiral directions, cube-root radii
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < nucleons; i++) {
      const r = (nucleusRadius - 0.07) * Math.cbrt((i + 0.5) / nucleons);
      const yy = 1 - (2 * (i + 0.5)) / nucleons;
      const rad = Math.sqrt(1 - yy * yy);
      const th = golden * i;
      this.dummy.position.set(Math.cos(th) * rad * r, yy * r, Math.sin(th) * rad * r);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      nucleons3d.setMatrixAt(i, this.dummy.matrix);
      nucleons3d.setColorAt(i, i % 2 === 0 ? protonColor : neutronColor);
    }
    this.nucleus.add(nucleons3d);

    // warm core light + additive glow sprite
    const coreLight = new THREE.PointLight(0xffd0a8, 30, 30, 1.8);
    this.nucleus.add(coreLight);
    const glowTex = makeGlowTexture('rgba(255,180,130,1)');
    this.disposables.push(glowTex);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.disposables.push(glowMat);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(nucleusRadius * 5.2);
    this.nucleus.add(glow);
    this.scene.add(this.nucleus);

    // ---- shells + electrons ----------------------------------------------
    const shellCount = el.shells.length;
    const firstR = nucleusRadius + 0.9;
    el.shells.forEach((count, k) => {
      const radius = firstR + k * 0.62;
      const geo = new THREE.TorusGeometry(radius, 0.0075, 6, 160);
      this.disposables.push(geo);
      const mat = new THREE.MeshBasicMaterial({
        color: accentHex,
        transparent: true,
        opacity: 0.32,
      });
      this.disposables.push(mat);
      const ring = new THREE.Mesh(geo, mat);
      const group = new THREE.Group();
      group.add(ring);
      group.rotation.x = 0.5 * Math.sin(k * 1.9) + 0.25;
      group.rotation.y = 0.35 * Math.cos(k * 1.3);
      this.scene.add(group);
      this.rings.push({
        group,
        radius,
        electronCount: count,
        speed: 0.9 / (1 + k * 0.35),
        phase: k * 1.7,
      });
    });
    this.maxShellRadius = firstR + (shellCount - 1) * 0.62;

    const electronGeo = new THREE.SphereGeometry(0.055, 10, 10);
    this.disposables.push(electronGeo);
    const electronMat = new THREE.MeshBasicMaterial({ color: 0xe8f6ff });
    this.disposables.push(electronMat);
    this.electrons = new THREE.InstancedMesh(electronGeo, electronMat, el.z);
    this.scene.add(this.electrons);

    // ---- ambient particles ------------------------------------------------
    const particleCount = lowQuality ? 140 : 420;
    const span = this.maxShellRadius + 4.5;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = span * (0.35 + 0.65 * Math.pow((i + 1) / particleCount, 0.7));
      const a = i * golden * 7.3;
      const b = Math.acos(1 - (2 * ((i * 37) % particleCount)) / particleCount);
      positions[i * 3] = r * Math.sin(b) * Math.cos(a);
      positions[i * 3 + 1] = r * Math.cos(b) * 0.7;
      positions[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.disposables.push(particleGeo);
    const particleTex = makeParticleTexture();
    this.disposables.push(particleTex);
    const particleMat = new THREE.PointsMaterial({
      size: 0.06,
      map: particleTex,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: accentHex,
    });
    this.disposables.push(particleMat);
    this.particles = new THREE.Points(particleGeo, particleMat);
    this.scene.add(this.particles);

    // ---- lighting ---------------------------------------------------------
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.5));
    const rim = new THREE.DirectionalLight(0xbfd8ff, 1.1);
    rim.position.set(-6, 8, 6);
    this.scene.add(rim);

    // ---- camera framing ---------------------------------------------------
    // rest distance leaves room for the side panels inside the frustum
    this.camDistance = Math.max(this.maxShellRadius * 2.6 + 4.6, 9.5);
    const tanHalf = Math.tan((45 / 2) * (Math.PI / 180));
    const halfH = tanHalf * this.camDistance;
    const halfWAtPanels = tanHalf * (this.camDistance - 1.4) * Math.max(aspect, 0.6);

    // ---- floating data panels (HTML sheet instead on narrow screens) -----
    const layout = htmlPanels ? null : this.buildPanels(el, accentCss, halfWAtPanels);

    // floating title above the atom
    const title = makeTitleTexture(el.symbol, el.name, el.z, accentCss);
    this.disposables.push(title.texture);
    const titleY = Math.min(this.maxShellRadius + 1.6, halfH * 0.92 - 0.45);
    this.addBillboard(title.texture, 5.2, title.aspect, 0, titleY, 0);

    if (el.summary && layout) {
      const text = el.summary.length > 320 ? el.summary.slice(0, 317).trimEnd() + '…' : el.summary;
      const summary = makeSummaryTexture(text);
      this.disposables.push(summary.texture);
      // keep the strip between the two panel columns and above the frustum edge
      const gapW = 2 * (layout.sideX - layout.panelW / 2) - 0.4;
      const summaryW = Math.max(Math.min(6.6, gapW), 3.4);
      const summaryHalfH = (summaryW * summary.aspect) / 2;
      const summaryY = Math.min(
        Math.max(this.maxShellRadius + 1.35, 3.3),
        halfH * 0.92 - summaryHalfH
      );
      this.addBillboard(summary.texture, summaryW, summary.aspect, 0, -summaryY, 1.2);
    }
  }

  private addBillboard(
    texture: THREE.Texture,
    width: number,
    aspect: number,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(width, width * aspect);
    this.disposables.push(geo);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.panels.push({ mesh, baseY: y, phase: this.panels.length * 1.4 });
    return mesh;
  }

  private buildPanels(
    el: ElementData,
    accentCss: string,
    halfW: number
  ): { sideX: number; panelW: number } {
    const sections = buildSections(el);
    const panelW = Math.min(3.6, halfW * 0.52);
    const sideX = Math.min(this.maxShellRadius + 3.6, halfW - panelW * 0.62);
    const placement = [
      { x: -sideX, y: 1.6, ry: 0.42 },
      { x: -sideX, y: -1.9, ry: 0.42 },
      { x: sideX, y: 1.55, ry: -0.42 },
      { x: sideX, y: -1.95, ry: -0.42 },
    ];
    sections.forEach((section, i) => {
      const p = placement[i];
      const { texture, aspect } = makePanelTexture(section.title, section.rows, accentCss);
      this.disposables.push(texture);
      const mesh = this.addBillboard(texture, panelW, aspect, p.x, p.y, 1.4);
      mesh.rotation.y = p.ry;
    });
    return { sideX, panelW };
  }

  update(dt: number): void {
    this.time += dt;
    this.nucleus.rotation.y += dt * 0.25;
    this.nucleus.rotation.x = Math.sin(this.time * 0.3) * 0.12;
    this.particles.rotation.y += dt * 0.02;

    // electrons ride their tilted shell rings
    let e = 0;
    for (const ring of this.rings) {
      ring.group.rotation.z += dt * 0.05;
      ring.group.updateMatrixWorld();
      for (let j = 0; j < ring.electronCount; j++) {
        const a = ring.phase + this.time * ring.speed + (j / ring.electronCount) * Math.PI * 2;
        this.dummy.position
          .set(Math.cos(a) * ring.radius, Math.sin(a) * ring.radius, 0)
          .applyMatrix4(ring.group.matrixWorld);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.electrons.setMatrixAt(e++, this.dummy.matrix);
      }
    }
    this.electrons.instanceMatrix.needsUpdate = true;

    // panels gently float
    for (const p of this.panels) {
      p.mesh.position.y = p.baseY + Math.sin(this.time * 0.7 + p.phase) * 0.06;
    }
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
