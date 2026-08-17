import * as THREE from "three";

/**
 * Per-era weather layers, world-space around the active car. Sparse and
 * slow (Kage-style), budgeted, and only simulated for the centered slice
 * and its neighbors. Order matches ERAS: dust, leaves, rain, sand, pollen,
 * aurora.
 */

const BOUNDS = { x: 5.5, yTop: 4.4, z: 5 };

function spriteTexture(kind: "dot" | "streak" | "leaf") {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  if (kind === "dot") {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  } else if (kind === "streak") {
    const g = ctx.createLinearGradient(32, 0, 32, 64);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(28, 0, 8, 64);
  } else {
    ctx.translate(32, 32);
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(180,180,180,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(24, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface PointsLayer {
  kind: "points";
  points: THREE.Points;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  phases: Float32Array;
  baseOpacity: number;
  motion: "drift" | "fall" | "gust" | "rise";
}

interface LeafLayer {
  kind: "leaves";
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  state: { pos: THREE.Vector3; vy: number; phase: number; spin: number }[];
  baseOpacity: number;
}

interface AuroraLayer {
  kind: "aurora";
  ribbon: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  sparks: PointsLayer;
  baseOpacity: number;
}

type Layer = (PointsLayer | LeafLayer | AuroraLayer) & { root: THREE.Group };

function makePoints(
  count: number,
  size: number,
  color: string,
  texture: THREE.Texture,
  motion: PointsLayer["motion"],
  baseOpacity: number,
  yRange: [number, number] = [0, BOUNDS.yTop],
  additive = false,
): PointsLayer {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * BOUNDS.x;
    positions[i * 3 + 1] = yRange[0] + Math.random() * (yRange[1] - yRange[0]);
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * BOUNDS.z;
    phases[i] = Math.random() * Math.PI * 2;
    if (motion === "fall") {
      velocities[i * 3] = -0.6 - Math.random() * 0.5;
      velocities[i * 3 + 1] = -(6.5 + Math.random() * 2.5);
      velocities[i * 3 + 2] = 0;
    } else if (motion === "gust") {
      velocities[i * 3] = 1.6 + Math.random() * 2.2;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    } else if (motion === "rise") {
      velocities[i * 3] = (Math.random() - 0.5) * 0.15;
      velocities[i * 3 + 1] = 0.25 + Math.random() * 0.35;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
    } else {
      velocities[i * 3] = (Math.random() - 0.5) * 0.25;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: texture,
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { kind: "points", points, material, velocities, phases, baseOpacity, motion };
}

export class Weather {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private reduced: boolean;

  constructor(reduced: boolean) {
    this.reduced = reduced;
    const dot = spriteTexture("dot");
    const streak = spriteTexture("streak");
    const leaf = spriteTexture("leaf");

    const wrap = (layer: PointsLayer | LeafLayer | AuroraLayer): Layer => {
      const root = new THREE.Group();
      if (layer.kind === "points") root.add(layer.points);
      else if (layer.kind === "leaves") root.add(layer.mesh);
      else root.add(layer.ribbon, layer.sparks.points);
      this.group.add(root);
      this.layers.push({ ...layer, root } as Layer);
      return this.layers[this.layers.length - 1];
    };

    // 0 — 1948 warm dust motes
    wrap(makePoints(this.budget(260), 0.055, "#e8cf9e", dot, "drift", 0.4));

    // 1 — 1965 falling autumn leaves
    const leafCount = this.budget(200);
    const leafMat = new THREE.MeshBasicMaterial({
      map: leaf, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
      color: 0xffffff,
    });
    const leafMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.11), leafMat, leafCount,
    );
    leafMesh.frustumCulled = false;
    const leafColors = ["#c9722e", "#a8542a", "#d9a441", "#8e5b2f"];
    const state: LeafLayer["state"] = [];
    const color = new THREE.Color();
    for (let i = 0; i < leafCount; i++) {
      state.push({
        pos: new THREE.Vector3(
          (Math.random() * 2 - 1) * BOUNDS.x,
          Math.random() * BOUNDS.yTop,
          (Math.random() * 2 - 1) * BOUNDS.z,
        ),
        vy: 0.5 + Math.random() * 0.45,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 3,
      });
      leafMesh.setColorAt(i, color.set(leafColors[i % leafColors.length]));
    }
    wrap({ kind: "leaves", mesh: leafMesh, material: leafMat, state, baseOpacity: 0.95 });

    // 2 — 1987 rain streaks
    wrap(makePoints(this.budget(520), 0.34, "#9fb6cc", streak, "fall", 0.5, [0, BOUNDS.yTop]));

    // 3 — 2004 clean air (Japanese road: no weather by design)
    wrap(makePoints(2, 0.001, "#ffffff", dot, "drift", 0));

    // 4 — 2026 studio: barely-there drifting specks
    wrap(makePoints(this.budget(80), 0.04, "#fff7dd", dot, "drift", 0.12));

    // 5 — 2040s aurora + rising light
    const ribbonCanvas = document.createElement("canvas");
    ribbonCanvas.width = 256;
    ribbonCanvas.height = 64;
    const rctx = ribbonCanvas.getContext("2d")!;
    const rg = rctx.createLinearGradient(0, 0, 0, 64);
    rg.addColorStop(0, "rgba(93,224,200,0)");
    rg.addColorStop(0.45, "rgba(93,224,200,0.8)");
    rg.addColorStop(0.65, "rgba(60,140,220,0.5)");
    rg.addColorStop(1, "rgba(93,224,200,0)");
    rctx.fillStyle = rg;
    rctx.fillRect(0, 0, 256, 64);
    const ribbonTex = new THREE.CanvasTexture(ribbonCanvas);
    const ribbon = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 3.2, 64, 1),
      new THREE.MeshBasicMaterial({
        map: ribbonTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    ribbon.position.set(0, 5.6, -5.5);
    ribbon.rotation.x = 0.25;
    const ribbonBase = (ribbon.geometry.attributes.position.array as Float32Array).slice();
    ribbon.userData.base = ribbonBase;
    const sparks = makePoints(this.budget(140), 0.07, "#5de0c8", dot, "rise", 0.6, [0, 5], true);
    wrap({ kind: "aurora", ribbon, sparks, baseOpacity: 0.5 });
  }

  private budget(desktop: number) {
    return window.innerWidth < 900 ? Math.floor(desktop / 2) : desktop;
  }

  update(dt: number, elapsed: number, eraFloat: number, finaleT: number) {
    this.layers.forEach((layer, i) => {
      const proximity = THREE.MathUtils.clamp(1 - Math.abs(i - eraFloat), 0, 1);
      const w = this.reduced
        ? 0
        : Math.max(proximity * (1 - finaleT), finaleT * 0.35);
      this.setOpacity(layer, w);
      if (w < 0.01) {
        layer.root.visible = false;
        return;
      }
      layer.root.visible = true;
      this.simulate(layer, dt, elapsed);
    });
  }

  private setOpacity(layer: Layer, w: number) {
    if (layer.kind === "points") layer.material.opacity = layer.baseOpacity * w;
    else if (layer.kind === "leaves") layer.material.opacity = layer.baseOpacity * w;
    else {
      layer.ribbon.material.opacity = layer.baseOpacity * w;
      layer.sparks.material.opacity = layer.sparks.baseOpacity * w;
    }
  }

  private simulate(layer: Layer, dt: number, elapsed: number) {
    if (layer.kind === "points") this.simulatePoints(layer, dt, elapsed);
    else if (layer.kind === "leaves") this.simulateLeaves(layer, dt, elapsed);
    else {
      this.simulatePoints(layer.sparks, dt, elapsed);
      const geo = layer.ribbon.geometry;
      const base = layer.ribbon.userData.base as Float32Array;
      const arr = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i];
        arr[i + 1] = base[i + 1] + Math.sin(x * 0.55 + elapsed * 0.6) * 0.4;
        arr[i + 2] = base[i + 2] + Math.sin(x * 0.3 - elapsed * 0.4) * 0.3;
      }
      geo.attributes.position.needsUpdate = true;
    }
  }

  private simulatePoints(layer: PointsLayer, dt: number, elapsed: number) {
    const arr = layer.points.geometry.attributes.position.array as Float32Array;
    const v = layer.velocities;
    for (let i = 0; i < arr.length / 3; i++) {
      const j = i * 3;
      arr[j] += v[j] * dt + (layer.motion === "drift" ? Math.sin(elapsed * 0.5 + layer.phases[i]) * 0.15 * dt : 0);
      arr[j + 1] += v[j + 1] * dt;
      arr[j + 2] += v[j + 2] * dt;
      // wrap
      if (arr[j] > BOUNDS.x) arr[j] = -BOUNDS.x;
      if (arr[j] < -BOUNDS.x) arr[j] = BOUNDS.x;
      if (arr[j + 2] > BOUNDS.z) arr[j + 2] = -BOUNDS.z;
      if (arr[j + 2] < -BOUNDS.z) arr[j + 2] = BOUNDS.z;
      if (layer.motion === "fall" && arr[j + 1] < 0) arr[j + 1] = BOUNDS.yTop;
      else if (layer.motion === "rise" && arr[j + 1] > 5) arr[j + 1] = 0;
      else if (arr[j + 1] > BOUNDS.yTop) arr[j + 1] = 0;
      else if (arr[j + 1] < 0) arr[j + 1] = BOUNDS.yTop;
    }
    layer.points.geometry.attributes.position.needsUpdate = true;
  }

  private simulateLeaves(layer: LeafLayer, dt: number, elapsed: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    layer.state.forEach((leaf, i) => {
      leaf.pos.y -= leaf.vy * dt;
      leaf.pos.x += Math.sin(elapsed * 1.2 + leaf.phase) * 0.55 * dt - 0.18 * dt;
      leaf.pos.z += Math.cos(elapsed * 0.9 + leaf.phase) * 0.3 * dt;
      if (leaf.pos.y < 0.02) {
        leaf.pos.y = BOUNDS.yTop;
        leaf.pos.x = (Math.random() * 2 - 1) * BOUNDS.x;
        leaf.pos.z = (Math.random() * 2 - 1) * BOUNDS.z;
      }
      e.set(
        elapsed * leaf.spin + leaf.phase,
        leaf.phase,
        Math.sin(elapsed * 1.5 + leaf.phase) * 0.8,
      );
      q.setFromEuler(e);
      m.compose(leaf.pos, q, s);
      layer.mesh.setMatrixAt(i, m);
    });
    layer.mesh.instanceMatrix.needsUpdate = true;
  }
}
