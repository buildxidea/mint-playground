// ── ESCAPE-ROOM ENGINE ───────────────────────────────────────────────────────
// Generic machinery. Give it a room data module (see src/rooms/room1.js) and it
// builds the 3D scene, wires look/click interaction, renders every widget type,
// applies every effect, and runs the intro → play → ending flow. Rooms carry all
// content; the engine carries none.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LAB_MODEL_URLS = {
  door: 'https://cdn.mint.gg/glb/sealed-exit-door-normalized-8201d15e7c4a843c.glb',
  desk: 'https://cdn.mint.gg/glb/steel-research-desk-normalized-2150c58c598c7e81.glb',
  shelf: 'https://cdn.mint.gg/glb/lab-shelving-unit-normalized-6ffde5c2c4c0086c.glb',
  table: 'https://cdn.mint.gg/glb/stainless-lab-table-normalized-80ff62b0bb4b5a7d.glb',
  machine: 'https://cdn.mint.gg/glb/experiment-machine-normalized-0c5ebec504b7dafe.glb',
  computer: 'https://cdn.mint.gg/glb/retro-computer-terminal-normalized-a45dcc1e0fd62489.glb',
  lamp: 'https://cdn.mint.gg/glb/articulated-task-lamp-normalized-2708c8b7076cf197.glb',
  lockbox: 'https://cdn.mint.gg/glb/steel-lockbox-normalized-e9c680ecf716d472.glb',
  cryopod: 'https://cdn.mint.gg/glb/cryo-containment-pod-normalized-cc6b133f7c76cc0b.glb',
  optics: 'https://cdn.mint.gg/glb/optics-beam-array-normalized-c734b074377074df.glb',
  console: 'https://cdn.mint.gg/glb/containment-control-console-normalized-8d95fe63ea4c67b5.glb',
};

export function startRoom(room) {
  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    inv: new Set(),
    equipped: null,        // inventory item currently held for use
    flags: {},
    digits: new Array(room.code.length).fill(null),
    journal: [],
    hintTier: {}, // hintId -> how many tiers revealed
    started: false,
    t0: 0,
  };
  const S = {
    has: (item) => state.inv.has(item),
    flag: (name) => !!state.flags[name],
    solved: (id) => !!state.flags[id + 'Solved'],
  };

  // ── Renderer / scene / camera ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // Cap pixel ratio at 1.5 — on a 2× retina display this is ~44% fewer fragments
  // to shade every frame, the single biggest smoothness win with no visible cost.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The scene is static (props don't move), so shadows are baked once instead of
  // recomputed every frame — see renderShadowsOnce() called after the GLBs load.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);
  function renderShadowsOnce() { renderer.shadowMap.needsUpdate = true; }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d0e);
  const _fog = room.shell?.fog || room.floorplan?.fog || {};
  scene.fog = new THREE.Fog(0x0c0d0e, _fog.near ?? 6, _fog.far ?? 13);

  // Movement model. Default rooms are a fixed first-person swivel (pivot); a room
  // can opt into free-walk with `movement:'walk'` + a `spawn` and (usually) a
  // larger `shell`. Everything below is gated on WALK so pivot rooms are untouched.
  const WALK = room.movement === 'walk';
  const spawn = room.spawn || {};
  const EYE = new THREE.Vector3(spawn.x ?? 0, 1.6, spawn.z ?? 1.15); // spawn / pivot anchor
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 80);
  camera.position.copy(EYE);
  let yaw = spawn.yaw ?? Math.PI, pitch = spawn.pitch ?? -0.05; // start heading

  // ── Tween helper ─────────────────────────────────────────────────────────────
  const tweens = [];
  function tween(duration, onUpdate, { delay = 0, ease = (t) => 1 - Math.pow(1 - t, 3) } = {}) {
    return new Promise((resolve) => tweens.push({ start: performance.now() + delay, duration, onUpdate, ease, resolve }));
  }
  function stepTweens(now) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (now < tw.start) continue;
      const t = Math.min((now - tw.start) / tw.duration, 1);
      tw.onUpdate(tw.ease(t));
      if (t >= 1) { tweens.splice(i, 1); tw.resolve(); }
    }
  }

  // ── Room shell ───────────────────────────────────────────────────────────────
  // Two shapes are supported:
  //   • single box — room.shell { width, depth, height }              (Room 1 default)
  //   • floorplan  — room.floorplan { cells:[{x0,x1,z0,z1}], walls:[[x0,z0,x1,z1]],
  //                                    height?, emergency?:[x,y,z] }
  //     a union of rectangular cells joined by OPEN doorways. Walls are explicit
  //     segments, so a gap between segments is a corridor mouth. The collider reads
  //     `cells`/`wallSegs` below, so both shapes share one movement path.
  const FP = room.floorplan || null;
  const WALL_H = room.shell?.height ?? FP?.height ?? 3.2;
  // worn institutional palette, to sit with the grimy cream/steel props
  // DoubleSide so a wall is visible from inside regardless of its segment orientation
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc4bfb2, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x86817a, roughness: 0.75, metalness: 0.12 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xb4b0a6, roughness: 1 });

  const ambient = new THREE.AmbientLight(0xcfd2d0, 0.5);
  scene.add(ambient);
  // Cheap sky/floor fill so a big floorplan needs far fewer (costly) point lights.
  if (FP) scene.add(new THREE.HemisphereLight(0xdfe2e6, 0x2a2f36, 0.6));
  const key = new THREE.DirectionalLight(0xf0eede, 0.95);
  key.castShadow = true;
  key.shadow.mapSize.set(FP ? 1024 : 2048, FP ? 1024 : 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; scene.add(key);
  const emergency = new THREE.PointLight(0xff3b52, 3.2, 8, 2); scene.add(emergency);

  let HW, HD, cells, wallSegs;   // half-extents of the bounding box; cells + wall segments

  // evenly spaced coordinates across [a,b], roughly `step` metres apart
  function gridSpotsRange(a, b, step) {
    const n = Math.max(1, Math.round((b - a) / step)), out = [];
    for (let i = 0; i < n; i++) out.push(a + (b - a) * (i + 0.5) / n);
    return out;
  }
  // one rectangular cell → floor + ceiling + tiling grid
  function buildCell(c) {
    const w = c.x1 - c.x0, d = c.z1 - c.z0, mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    fl.rotation.x = -Math.PI / 2; fl.position.set(mx, 0, mz); fl.receiveShadow = true; scene.add(fl);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    cl.rotation.x = Math.PI / 2; cl.position.set(mx, WALL_H, mz); scene.add(cl);
    const g = new THREE.GridHelper(Math.max(w, d), Math.round(Math.max(w, d)), 0x4a5560, 0x3a444e);
    g.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    g.position.set(mx, 0.002, mz); scene.add(g);
  }
  // one wall segment [x0,z0,x1,z1] → a vertical plane spanning it
  function buildWall(s) {
    const [x0, z0, x1, z1] = s, dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_H), wallMat);
    m.position.set((x0 + x1) / 2, WALL_H / 2, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(dz, dx); m.receiveShadow = true; scene.add(m);
  }
  // a ceiling light + panel at (x,z). `bright` compensates for wider spacing in
  // floorplans, where we deliberately place far fewer lights for performance.
  function ceilLight(x, z, bright) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshBasicMaterial({ color: 0xeef1e8 }));
    panel.rotation.x = Math.PI / 2; panel.position.set(x, WALL_H - 0.01, z); scene.add(panel);
    const pl = new THREE.PointLight(0xf3f4ea, bright ? 11 : 7.5, bright ? 11 : 7, 2);
    pl.position.set(x, WALL_H - 0.2, z); scene.add(pl);
  }

  if (FP) {
    cells = FP.cells; wallSegs = FP.walls;
    const xs = cells.flatMap((c) => [c.x0, c.x1]), zs = cells.flatMap((c) => [c.z0, c.z1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), zmin = Math.min(...zs), zmax = Math.max(...zs);
    HW = (xmax - xmin) / 2; HD = (zmax - zmin) / 2;
    const cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2;
    cells.forEach(buildCell);
    wallSegs.forEach(buildWall);
    // per-cell ceiling lights — wide spacing (few, brighter) keeps the GPU cost
    // low; the hemisphere light above fills the gaps.
    for (const c of cells) {
      const xs2 = gridSpotsRange(c.x0, c.x1, 4.6), zs2 = gridSpotsRange(c.z0, c.z1, 5.2);
      for (const px of xs2) for (const pz of zs2) ceilLight(px, pz, true);
    }
    key.position.set(cx + 3, 7, cz + 4);
    const kt = new THREE.Object3D(); kt.position.set(cx, 0, cz); scene.add(kt); key.target = kt;
    const shR = Math.hypot(HW, HD) + 2;
    key.shadow.camera.left = -shR; key.shadow.camera.right = shR;
    key.shadow.camera.top = shR; key.shadow.camera.bottom = -shR;
    key.shadow.camera.updateProjectionMatrix();
    const e = FP.emergency || [cx, 2.2, cz]; emergency.position.set(e[0], e[1], e[2]);
  } else {
    HW = (room.shell?.width ?? 6) / 2; HD = (room.shell?.depth ?? 6) / 2;
    cells = [{ x0: -HW, x1: HW, z0: -HD, z1: HD }];
    wallSegs = [[-HW, -HD, HW, -HD], [-HW, HD, HW, HD], [-HW, -HD, -HW, HD], [HW, -HD, HW, HD]];
    buildCell(cells[0]);
    wallSegs.forEach(buildWall);
    const panelXs = HW <= 3.2 ? [-1.4, 1.4] : gridSpotsRange(-HW, HW, 2.6);
    const panelZs = HD <= 3.2 ? [-0.3] : gridSpotsRange(-HD, HD, 3.0);
    for (const px of panelXs) for (const pz of panelZs) ceilLight(px, pz);
    key.position.set(2, 6, 3);
    const shR = Math.max(HW, HD) + 2;
    key.shadow.camera.left = -shR; key.shadow.camera.right = shR;
    key.shadow.camera.top = shR; key.shadow.camera.bottom = -shR;
    emergency.position.set(0, 2.2, -HD + 0.65);
  }

  // ── Objects ──────────────────────────────────────────────────────────────────
  const manager = new THREE.LoadingManager();
  const loader = new GLTFLoader(manager);
  const holders = [];       // clickable groups
  const holderById = {};
  const builtExtras = {};   // code-built decorations keyed by object id
  let bookState = null;     // set by the 'books' decoration; drives the arrange puzzle

  function normalize(object, targetSize) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const scale = targetSize / Math.max(size.x, size.y, size.z);
    object.scale.setScalar(scale);
    box.setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= box.min.y; // rest base on the holder origin
  }

  function makePlaceholder(obj) {
    const [w, h, d] = obj.size || [0.5, 0.5, 0.5];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: obj.color ?? 0xccd2da, roughness: 0.6, metalness: 0.15 })
    );
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.y = obj.mount === 'wall' ? 0 : h / 2;
    return mesh;
  }

  const glbUsers = {};      // glbKey -> [{holder, obj}] so each file loads once
  for (const obj of room.objects) {
    const holder = new THREE.Group();
    const [x, y, z] = obj.pos;
    // Floor props sit 6 mm above the floor/grid planes so their flat bases don't
    // z-fight (that flicker was the cryo-pod "glitching" on the ground).
    holder.position.set(x, obj.mount === 'floor' ? 0.006 : y, z);
    holder.rotation.y = obj.rotY || 0;
    holder.userData.objId = obj.id;
    holder.userData.obj = obj;

    // Collision footprint for walk mode. `obj.block` gives an explicit radius
    // (or `false` to disable); otherwise floor-standing props auto-block from
    // their footprint. Wall/surface decor never blocks.
    holder.userData.blockRadius =
      obj.block === false ? 0
      : typeof obj.block === 'number' ? obj.block
      : (obj.mount === 'floor' && obj.size) ? Math.max(obj.size[0], obj.size[2]) * 0.45
      : 0;

    // placeholder box (kept until a GLB loads over it)
    if (obj.glbKey || obj.size) {
      const ph = makePlaceholder(obj);
      ph.userData.placeholder = true;
      holder.add(ph);
    }
    // code-built decoration (clock / bulletin / bottles)
    if (obj.build) buildExtra(obj, holder);

    scene.add(holder);
    holders.push(holder);
    holderById[obj.id] = holder;

    // register for a deduped GLB load (see below)
    if (obj.glbKey) { (glbUsers[obj.glbKey] || (glbUsers[obj.glbKey] = [])).push({ holder, obj }); }
  }

  // Load each unique GLB once, then CLONE it onto every holder that uses it — the
  // four cryo-pods (etc.) share a single download + parse + geometry instead of
  // one apiece. Big load-time and memory win.
  for (const key in glbUsers) {
    const url = LAB_MODEL_URLS[key];
    if (!url) {
      console.warn('[GLB] No Mint CDN URL registered for', key);
      continue;
    }
    loader.load(url, (gltf) => {
      const src = gltf.scene;
      src.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
      for (const { holder, obj } of glbUsers[key]) {
        const model = src.clone(true);
        normalize(model, obj.targetSize || 1);
        for (const c of [...holder.children]) if (c.userData.placeholder) holder.remove(c);
        holder.add(model);
      }
      renderShadowsOnce(); // static shadow map: refresh now that these meshes exist
    }, undefined, (err) => { console.warn('[GLB] FAIL', key, err && (err.message || err.type)); });
  }

  // Draws a readable clock face (numerals 1–12, ticks, hands) frozen at 8:25 onto
  // a canvas. Shared by the 3D wall clock and the examine-panel visual so both
  // show the exact same clock the player has to read.
  function makeClockCanvas(size = 320) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); const R = size / 2;
    x.fillStyle = '#f2efe4'; x.beginPath(); x.arc(R, R, R - size * 0.02, 0, 7); x.fill();
    x.lineWidth = size * 0.02; x.strokeStyle = '#2f343b'; x.stroke();
    x.fillStyle = '#20242a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `bold ${size * 0.115}px Georgia, "Times New Roman", serif`;
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2 - Math.PI / 2;
      x.fillText(String(n), R + Math.cos(a) * R * 0.76, R + Math.sin(a) * R * 0.76);
      x.beginPath();
      x.moveTo(R + Math.cos(a) * R * 0.9, R + Math.sin(a) * R * 0.9);
      x.lineTo(R + Math.cos(a) * R * 0.96, R + Math.sin(a) * R * 0.96);
      x.lineWidth = size * 0.012; x.strokeStyle = '#2f343b'; x.stroke();
    }
    const hand = (frac, len, w, col) => {
      const a = frac * Math.PI * 2 - Math.PI / 2;
      x.beginPath(); x.moveTo(R, R); x.lineTo(R + Math.cos(a) * len, R + Math.sin(a) * len);
      x.lineWidth = w; x.strokeStyle = col; x.lineCap = 'round'; x.stroke();
    };
    hand(8 / 12, R * 0.5, size * 0.028, '#20242a');   // hour hand → 8
    hand(25 / 60, R * 0.72, size * 0.018, '#20242a');  // minute hand → 5 (25 past)
    x.fillStyle = '#b23b2e'; x.beginPath(); x.arc(R, R, size * 0.022, 0, 7); x.fill();
    return c;
  }

  // canvas word-wrap for printed notes
  function wrapText(x, text, cx, cy, maxW, lh) {
    const words = text.split(' '); let line = ''; let y = cy;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (x.measureText(test).width > maxW && line) { x.fillText(line, cx, y); line = word; y += lh; }
      else line = test;
    }
    x.fillText(line, cx, y);
  }

  // The order poster (concept sequence the books must match). Shared by the 3D
  // wall poster and the examine-panel visual.
  function makePosterCanvas(w = 480, h = 660) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#e7dcc3'); g.addColorStop(1, '#d8cbac');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#b9a880'; x.lineWidth = 10; x.strokeRect(18, 18, w - 36, h - 36);
    const lines = ['I.  The mind, first.', 'II.  Then the body.', 'III.  Then matter.', 'IV.  Finally, the stars.'];
    x.fillStyle = '#3a2f22'; x.textAlign = 'left'; x.font = `500 ${w * 0.07}px Georgia, serif`;
    lines.forEach((ln, i) => x.fillText(ln, w * 0.17, h * 0.3 + i * h * 0.13));
    x.textAlign = 'right'; x.font = `italic ${w * 0.05}px Georgia, serif`; x.fillStyle = '#5a4a36';
    x.fillText('— E. Vale', w * 0.83, h * 0.88);
    return c;
  }

  // A single book's spine label — coloured with the subject read bottom-to-top.
  function bookSpineCanvas(subject, color) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 320;
    const x = c.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, 128, 320);
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, 26, 128, 12); x.fillRect(0, 282, 128, 12);
    x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(0, 40, 128, 3);
    x.save(); x.translate(64, 160); x.rotate(-Math.PI / 2);
    x.fillStyle = '#f6f1e6'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 30px Georgia, serif';
    x.fillText(subject, 0, 0); x.restore();
    return c;
  }

  // ── Code-built decorations ────────────────────────────────────────────────────
  function buildExtra(obj, holder) {
    if (obj.build === 'clock') {
      const g = new THREE.Group();
      const tex = new THREE.CanvasTexture(makeClockCanvas(320));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.24, 48),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.022, 12, 44),
        new THREE.MeshStandardMaterial({ color: 0x8a93a0, metalness: 0.6, roughness: 0.4 }));
      face.position.z = 0.005;
      g.add(face, rim);
      g.position.z = 0.03;
      holder.add(g);
      builtExtras[obj.id] = g;
    }
    if (obj.build === 'lasers') {
      // A lattice of red tripwire beams across a corridor (spans local Z), plus
      // little emitter nubs on each side. Hidden/unblocked by fx.openObj on solve.
      const g = new THREE.Group();
      const span = obj.span || 1.4, heights = obj.heights || [0.5, 0.95, 1.4, 1.85];
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3b52 });
      const nubMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.4, emissive: 0x551018 });
      for (const hy of heights) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, span * 2, 8), beamMat);
        beam.rotation.x = Math.PI / 2; beam.position.y = hy; g.add(beam);            // along local Z
        for (const s of [-1, 1]) {
          const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), nubMat);
          nub.rotation.x = Math.PI / 2; nub.position.set(0, hy, s * span); g.add(nub);
        }
      }
      holder.add(g);
      builtExtras[obj.id] = g;
    }
    if (obj.build === 'bulletin') {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.95 }));
      // a pinned note with the actual clue text printed on it
      const noteC = document.createElement('canvas'); noteC.width = 320; noteC.height = 240;
      const nx = noteC.getContext('2d');
      nx.fillStyle = '#f4efe2'; nx.fillRect(0, 0, 320, 240);
      nx.fillStyle = '#2c2519'; nx.font = 'italic 26px Georgia, serif'; nx.textAlign = 'center';
      wrapText(nx, 'The experiment always begins when time stops.', 160, 70, 260, 38);
      const tex = new THREE.CanvasTexture(noteC); tex.colorSpace = THREE.SRGBColorSpace;
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.255),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
      paper.position.set(-0.02, 0.02, 0.03); paper.rotation.z = -0.03;
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xd23b2e }));
      pin.position.set(-0.02, 0.13, 0.05);
      board.position.z = 0.02;
      holder.add(board, paper, pin);
    }
    if (obj.build === 'poster') {
      const tex = new THREE.CanvasTexture(makePosterCanvas());
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const w = 0.6, h = 0.82;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x5c4a34, roughness: 0.7 }));
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
      frame.position.z = 0.015; paper.position.z = 0.032;
      const g = new THREE.Group(); g.add(frame, paper); g.position.z = 0.03;
      holder.add(g);
    }
    if (obj.build === 'books') {
      // Four books standing on a shelf of the bookshelf. Dusty until swept; then
      // draggable left/right to reorder (see the book-mode handlers below).
      const cfg = obj.books;
      const SLOT_X = [-0.24, -0.08, 0.08, 0.24]; // local x positions along the shelf
      const BOOK_H = 0.32;
      const PLANK_Y = 1.18;                       // local height of the GLB shelf plank
      const restY = PLANK_Y + BOOK_H / 2;         // rest each book's base on the plank
      const group = new THREE.Group();
      const books = [];
      cfg.order.forEach((id, i) => {
        const def = cfg.defs[id];
        const book = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, BOOK_H, 0.22),
          new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 }));
        body.castShadow = true;
        const spineTex = new THREE.CanvasTexture(bookSpineCanvas(def.subject, def.color));
        spineTex.colorSpace = THREE.SRGBColorSpace;
        const spine = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.31),
          new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.75 }));
        spine.position.z = 0.111;
        // dust cover — a pale grey shell hiding the spine until swept
        const dust = new THREE.Mesh(new THREE.BoxGeometry(0.125, BOOK_H + 0.02, 0.24),
          new THREE.MeshStandardMaterial({ color: 0x9a978d, roughness: 1, transparent: true, opacity: 0.92 }));
        dust.name = 'dust';
        book.add(body, spine, dust);
        book.position.set(SLOT_X[i], restY, 0);
        book.userData.bookId = id;
        group.add(book); books.push(book);
      });
      holder.add(group);
      bookState = { holder, group, books, cfg, SLOT_X, restY };
    }
    if (obj.build === 'bottles') {
      // four coloured bottles standing on the lab table top
      const cols = [0x3a86ff, 0xff4d5e, 0x38b000, 0x2b2d33];
      const top = (obj.size?.[1] || 0.9);
      cols.forEach((c, i) => {
        const b = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 16),
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 }));
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.06, 12),
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.3 }));
        neck.position.y = 0.11; body.position.y = 0;
        b.add(body, neck);
        b.position.set(-0.3 + i * 0.2, top + 0.11, 0.12);
        holder.add(b);
      });
    }
  }

  // ── Visual clues (rendered documents shown in examine panels + the journal) ───
  const PHOTO_SVG = `<svg viewBox="0 0 240 190" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="sg" cx="50%" cy="36%" r="82%">
        <stop offset="0%" stop-color="#8a765a"/><stop offset="65%" stop-color="#4c3f2f"/><stop offset="100%" stop-color="#281f16"/>
      </radialGradient>
      <radialGradient id="vg" cx="50%" cy="50%" r="72%">
        <stop offset="58%" stop-color="#00000000"/><stop offset="100%" stop-color="#000000aa"/>
      </radialGradient>
    </defs>
    <rect width="240" height="190" fill="url(#sg)"/>
    <g fill="#dccfb8"><circle cx="90" cy="64" r="21"/><path d="M62 92 q28 -15 56 0 l7 98 h-70 z"/></g>
    <path d="M62 108 l28 10 l28 -10" fill="none" stroke="#b7a888" stroke-width="2"/>
    <g fill="#d0c3ab"><circle cx="160" cy="80" r="18"/><path d="M138 102 q22 -12 44 0 l5 88 h-54 z"/></g>
    <path d="M138 116 l22 8 l22 -8" fill="none" stroke="#ab9d7e" stroke-width="2"/>
    <ellipse cx="90" cy="66" rx="12" ry="15" fill="#2c231a" opacity=".22"/>
    <ellipse cx="160" cy="82" rx="10" ry="12" fill="#2c231a" opacity=".22"/>
    <line x1="18" y1="34" x2="70" y2="12" stroke="#ffffff22" stroke-width="1"/>
    <rect width="240" height="190" fill="url(#vg)"/>
  </svg>`;

  function buildVisual(v) {
    const wrap = el('div', 'visual');
    if (v.kind === 'clock') {
      const img = document.createElement('img');
      img.className = 'clockimg'; img.alt = 'clock';
      img.src = makeClockCanvas(320).toDataURL();
      wrap.appendChild(img);
    } else if (v.kind === 'poster') {
      const img = document.createElement('img');
      img.className = 'posterimg'; img.alt = 'poster';
      img.src = makePosterCanvas().toDataURL();
      wrap.appendChild(img);
    } else if (v.kind === 'photo') {
      wrap.classList.add('col');
      const pol = el('div', 'polaroid');
      const photo = el('div', 'photo'); photo.innerHTML = PHOTO_SVG;
      pol.appendChild(photo);
      if (v.date) pol.appendChild(el('div', 'cap', v.date));
      wrap.appendChild(pol);
      if (v.back && v.back.length) {
        const back = el('div', 'photoback');
        back.appendChild(el('div', 'backlabel', 'written on the back'));
        for (const line of v.back) back.appendChild(el('div', 'backline', '“' + line + '”'));
        wrap.appendChild(back);
      }
    } else if (v.kind === 'page') {
      const page = el('div', 'tornpage');
      for (const line of v.lines) page.appendChild(el('div', 'pl', line));
      if (v.circled) page.appendChild(el('div', 'circlednum', v.circled));
      wrap.appendChild(page);
    } else if (v.kind === 'note') {
      wrap.appendChild(el('div', 'notepaper', v.text));
    } else {
      wrap.appendChild(el('div', 'clue', v.text || ''));
    }
    return wrap;
  }

  // ── Camera look (drag to rotate; anchor is the camera itself) ────────────────
  // In pivot rooms the camera never leaves EYE, so anchoring on camera.position
  // is identical to before; in walk rooms it follows the player as they move.
  function lookDir() {
    return new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );
  }
  function applyLook() {
    camera.lookAt(camera.position.clone().add(lookDir()));
  }
  applyLook();

  // ── Free-walk locomotion (walk rooms only) ──────────────────────────────────
  const keys = {};
  const joy = { x: 0, y: 0 };   // on-screen joystick vector, set below
  if (WALK) {
    const track = (down) => (e) => {
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
        keys[e.code] = down; e.preventDefault();
      }
    };
    window.addEventListener('keydown', track(true));
    window.addEventListener('keyup', track(false));
    document.body.classList.add('walk');
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    setupJoystick();
    // Dev helper: call __where() in the console to read your current position and
    // heading — handy for choosing pos/spawn coordinates while scripting puzzles.
    window.__where = () => ({ pos: camera.position.toArray().map((n) => +n.toFixed(2)), yaw: +yaw.toFixed(2) });
    window.__flags = () => ({ ...state.flags }); // dev: inspect puzzle flags
    window.__bbox = (id) => { // dev: world AABB of an object, for clip/overlap checks
      const h = holderById[id]; if (!h) return null;
      const b = new THREE.Box3().setFromObject(h);
      return { min: b.min.toArray().map((n) => +n.toFixed(2)), max: b.max.toArray().map((n) => +n.toFixed(2)) };
    };
  }

  // Bottom-left thumbstick for touch devices → writes into `joy` (range −1..1).
  let joyId = null;
  function setupJoystick() {
    const pad = document.getElementById('joystick');
    const nub = document.getElementById('joynub');
    if (!pad) return;
    const RAD = 46; // travel in px before saturating
    const set = (dx, dy) => {
      const m = Math.hypot(dx, dy) || 1, k = Math.min(m, RAD) / m;
      dx *= k; dy *= k;
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / RAD; joy.y = -dy / RAD; // screen-down is −forward
    };
    const rect = () => pad.getBoundingClientRect();
    pad.addEventListener('pointerdown', (e) => {
      joyId = e.pointerId; pad.setPointerCapture(e.pointerId);
      const r = rect(); set(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      e.stopPropagation();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      const r = rect(); set(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      e.stopPropagation();
    });
    const end = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null; joy.x = joy.y = 0; nub.style.transform = 'translate(0,0)';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  // Fade the "WASD to move" prompt once the player actually moves.
  let walkHintFaded = false;
  function maybeFadeHint() {
    if (walkHintFaded) return;
    walkHintFaded = true;
    const h = document.getElementById('walkhint');
    if (h) { h.classList.add('fade'); setTimeout(() => { h.style.display = 'none'; }, 800); }
  }

  // Push the player circle out of any prop footprint it overlaps.
  function collideProps(nx, nz) {
    for (const h of holders) {
      const br = h.userData.blockRadius;
      if (!br) continue;
      let dx = nx - h.position.x, dz = nz - h.position.z;
      const d = Math.hypot(dx, dz), min = br + PLAYER_R;
      if (d < min) {
        if (d < 1e-4) { dx = 1; dz = 0; }              // degenerate: shove +X
        const s = min / (d || 1);
        nx = h.position.x + dx * s; nz = h.position.z + dz * s;
      }
    }
    return [nx, nz];
  }
  // Push the player circle off the inside of any wall segment it crosses.
  function collideWalls(nx, nz) {
    for (const [x0, z0, x1, z1] of wallSegs) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
      let t = L2 ? ((nx - x0) * dx + (nz - z0) * dz) / L2 : 0;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const px = x0 + t * dx, pz = z0 + t * dz;    // closest point on the segment
      let ox = nx - px, oz = nz - pz, d = Math.hypot(ox, oz);
      if (d < PLAYER_R) {
        if (d < 1e-4) { ox = -dz; oz = dx; d = Math.hypot(ox, oz) || 1; } // sit exactly on wall → push along normal
        nx = px + ox / d * PLAYER_R; nz = pz + oz / d * PLAYER_R;
      }
    }
    return [nx, nz];
  }
  // Resolve a proposed position against the room shape + props.
  function collide(nx, nz) {
    if (FP) {
      [nx, nz] = collideWalls(nx, nz);
      [nx, nz] = collideProps(nx, nz);
      [nx, nz] = collideWalls(nx, nz);   // 2nd pass: a prop can't shove you through a wall
    } else {
      nx = THREE.MathUtils.clamp(nx, -HW + PLAYER_R, HW - PLAYER_R);
      nz = THREE.MathUtils.clamp(nz, -HD + PLAYER_R, HD - PLAYER_R);
      [nx, nz] = collideProps(nx, nz);
      nx = THREE.MathUtils.clamp(nx, -HW + PLAYER_R, HW - PLAYER_R);
      nz = THREE.MathUtils.clamp(nz, -HD + PLAYER_R, HD - PLAYER_R);
    }
    return [nx, nz];
  }

  const PLAYER_R = 0.34;
  const WALK_SPEED = 2.5; // metres / second
  function stepWalk(dt) {
    if (!WALK || !state.started || modalOpen() || bookMode) return;
    let fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    fwd += joy.y; str += joy.x;
    if (!fwd && !str) return;
    maybeFadeHint();
    const len = Math.hypot(fwd, str); fwd /= len; str /= len;   // no diagonal speed-up
    const s = Math.sin(yaw), c = Math.cos(yaw), step = WALK_SPEED * dt;
    const nx = camera.position.x + (s * fwd - c * str) * step;  // forward=(s,c), right=(−c,s)
    const nz = camera.position.z + (c * fwd + s * str) * step;
    const [cx, cz] = collide(nx, nz);
    camera.position.x = cx; camera.position.z = cz;
    applyLook();
    if (hoverLabel) hoverLabel.style.opacity = 0; // labels get stale while moving
  }

  let dragging = false, lastX = 0, lastY = 0, moved = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.started) return;
    if (bookMode) { startBookDrag(e); return; }
    if (modalOpen()) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY; moved = 0;
  });
  window.addEventListener('pointermove', (e) => {
    if (bookMode) { moveBookDrag(e); return; }
    updateHover(e);
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * 0.005;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.005, -0.9, 0.7);
    applyLook();
  });
  window.addEventListener('pointerup', (e) => {
    if (bookMode) { endBookDrag(e); return; }
    if (dragging && moved < 6) handleClick(e); // a click, not a drag
    dragging = false;
  });

  // distance from the player to an object's centre (walk-mode reach checks)
  function distanceTo(holder) {
    const c = new THREE.Vector3();
    new THREE.Box3().setFromObject(holder).getCenter(c);
    return Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
  }
  const REACH = 2.6; // how close you must stand to interact in a walk room

  // turn the camera to face an object, smoothly
  function lookAtObject(holder) {
    const target = new THREE.Vector3();
    new THREE.Box3().setFromObject(holder).getCenter(target);
    const dir = target.clone().sub(camera.position);
    const toYaw = Math.atan2(dir.x, dir.z);
    const flat = Math.hypot(dir.x, dir.z);
    const toPitch = THREE.MathUtils.clamp(Math.atan2(dir.y, flat), -0.9, 0.7);
    const fromYaw = yaw, fromPitch = pitch;
    let dyaw = toYaw - fromYaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    return tween(500, (t) => {
      yaw = fromYaw + dyaw * t;
      pitch = fromPitch + (toPitch - fromPitch) * t;
      applyLook();
    });
  }

  // ── Hover ────────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hoverLabel = document.getElementById('hoverlabel');

  function pick(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(holders, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && o.userData.objId === undefined) o = o.parent;
    return o || null;
  }

  function updateHover(e) {
    if (!state.started || modalOpen() || bookMode) { hoverLabel.style.opacity = 0; canvas.style.cursor = 'default'; return; }
    const h = pick(e);
    if (h) {
      const obj = h.userData.obj;
      const far = WALK && distanceTo(h) > REACH;
      hoverLabel.textContent = far ? obj.label + ' — walk closer' : obj.label;
      hoverLabel.style.left = e.clientX + 'px';
      hoverLabel.style.top = e.clientY + 'px';
      hoverLabel.style.opacity = far ? 0.55 : 1;
      canvas.style.cursor = far ? (dragging ? 'grabbing' : 'grab') : 'pointer';
    } else {
      hoverLabel.style.opacity = 0;
      canvas.style.cursor = dragging ? 'grabbing' : 'grab';
    }
  }

  async function handleClick(e) {
    const h = pick(e);
    if (!h) return;
    const obj = h.userData.obj;
    // walk rooms: you have to physically go to an object to use it
    if (WALK && distanceTo(h) > REACH) { toast('Too far away — walk closer.'); return; }
    // 1) using an equipped item on a compatible object
    if (state.equipped && obj.use && obj.use.item === state.equipped) {
      await lookAtObject(h);
      applyEffects(obj.use.effect);
      setEquipped(null);
      return;
    }
    // 2) a swept bookshelf → enter the 3D arrange puzzle instead of a panel
    if (obj.books && state.flags.booksSwept && !state.flags.booksSolved) {
      await lookAtObject(h);
      enterBookMode();
      return;
    }
    // 3) equipped the wrong item for this object → gentle nudge, no panel
    if (state.equipped && obj.use && obj.use.item !== state.equipped) {
      toast('That doesn’t seem to do anything here.');
      return;
    }
    // 4) normal examine
    await lookAtObject(h);
    openExamine(obj);
  }

  // ── Effects ──────────────────────────────────────────────────────────────────
  function applyEffects(fx) {
    if (!fx) return;
    if (fx.setFlag) state.flags[fx.setFlag] = true;
    if (fx.setFlag === 'booksSwept') revealBooks();
    if (fx.give) for (const it of fx.give) { state.inv.add(it); renderInventory(it); }
    if (fx.reveal) { state.digits[fx.reveal.pos] = fx.reveal.value; renderCode(); }
    if (fx.addClue) { state.journal.push(fx.addClue); flashBtn('journalbtn'); setTimeout(() => openJournal(true), 300); }
    if (fx.message) toast(fx.message);
    // open a barrier object (e.g. the corridor bulkhead): drop its collision + hide it
    if (fx.openObj) { const h = holderById[fx.openObj]; if (h) { h.userData.blockRadius = 0; h.visible = false; renderShadowsOnce(); } }
    if (fx.ending) setTimeout(() => runEnding(), 1400);
  }

  // ── Book arrange mode (zoom in, drag books left/right to reorder) ─────────────
  let bookMode = false, draggingBook = null;
  const bookPlane = new THREE.Plane();

  function revealBooks() {
    if (!bookState) return;
    for (const b of bookState.books) { const d = b.getObjectByName('dust'); if (d) d.visible = false; }
  }
  function booksCenterWorld() {
    const c = new THREE.Vector3();
    for (const b of bookState.books) c.add(b.getWorldPosition(new THREE.Vector3()));
    return c.multiplyScalar(1 / bookState.books.length);
  }
  function bookFront() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(bookState.holder.quaternion).normalize();
  }
  function enterBookMode() {
    if (!bookState) return;
    bookMode = true; draggingBook = null;
    document.getElementById('bookbar').classList.add('show');
    hoverLabel.style.opacity = 0; canvas.style.cursor = 'default';
    const center = booksCenterWorld();
    const camTo = center.clone().add(bookFront().multiplyScalar(0.95)); camTo.y = center.y + 0.06;
    const camFrom = camera.position.clone();
    tween(600, (t) => { camera.position.lerpVectors(camFrom, camTo, t); camera.lookAt(center); });
  }
  function exitBookMode() {
    if (!bookMode) return;
    bookMode = false; draggingBook = null;
    document.getElementById('bookbar').classList.remove('show');
    const camFrom = camera.position.clone();
    const center = booksCenterWorld();
    tween(560, (t) => { camera.position.lerpVectors(camFrom, EYE, t); camera.lookAt(center); })
      .then(() => { camera.position.copy(EYE); applyLook(); });
  }
  function pickPointer(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }
  function startBookDrag(e) {
    pickPointer(e);
    const hits = raycaster.intersectObjects(bookState.books, true);
    if (!hits.length) return;
    let o = hits[0].object; while (o && o.userData.bookId === undefined) o = o.parent;
    if (!o) return;
    draggingBook = o;
    o.position.y = bookState.restY + 0.06;
    bookPlane.setFromNormalAndCoplanarPoint(bookFront(), booksCenterWorld());
    canvas.style.cursor = 'grabbing';
  }
  function moveBookDrag(e) {
    if (!draggingBook) return;
    pickPointer(e);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(bookPlane, hit)) {
      const local = bookState.holder.worldToLocal(hit.clone());
      const min = bookState.SLOT_X[0] - 0.06, max = bookState.SLOT_X[bookState.SLOT_X.length - 1] + 0.06;
      draggingBook.position.x = THREE.MathUtils.clamp(local.x, min, max);
    }
  }
  function endBookDrag() {
    canvas.style.cursor = 'default';
    if (!draggingBook) return;
    draggingBook = null;
    // settle every book into slots ordered by its current x
    const sorted = [...bookState.books].sort((a, b) => a.position.x - b.position.x);
    sorted.forEach((bk, i) => {
      const fromX = bk.position.x, fromY = bk.position.y, toX = bookState.SLOT_X[i], toY = bookState.restY;
      tween(240, (t) => { bk.position.x = fromX + (toX - fromX) * t; bk.position.y = fromY + (toY - fromY) * t; });
    });
    const order = sorted.map((b) => b.userData.bookId);
    const ans = bookState.cfg.answer;
    if (order.length === ans.length && order.every((id, i) => id === ans[i])) {
      setTimeout(() => { applyEffects(bookState.cfg.onSolve); setTimeout(exitBookMode, 800); }, 320);
    }
  }
  document.getElementById('bookback').onclick = exitBookMode;

  // ── Examine modal + widgets ──────────────────────────────────────────────────
  const examineEl = document.getElementById('examine');
  const cardEl = document.getElementById('examine-card');

  function modalOpen() {
    return document.querySelector('.overlay.open') != null;
  }

  function openExamine(obj) {
    const spec = obj.examine(S);
    renderExamine(obj, spec);
    examineEl.classList.add('open');
  }

  function renderExamine(obj, spec) {
    // inventory gate
    if (spec.requires && !state.inv.has(spec.requires.item)) {
      spec = { title: spec.title, body: spec.requires.message, widget: { type: 'note' } };
    }
    cardEl.innerHTML = '';
    const close = el('button', 'closebtn', '✕');
    close.onclick = () => examineEl.classList.remove('open');
    cardEl.appendChild(close);
    cardEl.appendChild(el('div', 'kicker', obj.label.toUpperCase()));
    cardEl.appendChild(el('h2', '', spec.title || obj.label));
    const isTerm = /keypad|LOCKED|LOCKDOWN|EXIT DIGIT|PASSWORD/.test(spec.body || '');
    if (spec.body) cardEl.appendChild(el('div', 'body' + (isTerm ? ' term' : ''), spec.body));
    if (spec.visual) cardEl.appendChild(buildVisual(spec.visual));

    const w = spec.widget;
    if (w && w.type !== 'note') {
      const box = el('div', 'widget');
      cardEl.appendChild(box);
      // On solve: apply effects, close the panel. If the solve produced a new
      // journal note, applyEffects pops the journal open; otherwise re-open the
      // examine panel to show the object's next state.
      const solve = (fx) => {
        applyEffects(fx);
        examineEl.classList.remove('open');
        if (!fx.addClue) setTimeout(() => openExamine(obj), 220);
      };
      if (w.type === 'lock2') widgetLock(box, w, solve);
      else if (w.type === 'keypad') widgetKeypad(box, w, solve);
      else if (w.type === 'order') widgetOrder(box, w, solve);
      else if (w.type === 'choice') widgetChoice(box, w, solve);
      else if (w.type === 'action') widgetAction(box, w, solve);
      else if (w.type === 'toggle') widgetToggle(box, w, solve);
      else if (w.type === 'mastermind') widgetMastermind(box, w, solve);
      else if (w.type === 'beam') widgetBeam(box, w, solve);
    }
  }

  function widgetLock(box, w, solve) {
    let val = '';
    const screen = el('div', 'screen', '––');
    const pad = el('div', 'keypad');
    box.appendChild(screen); box.appendChild(pad);
    const refresh = () => { screen.textContent = (val + '––').slice(0, 2); };
    for (const d of ['1','2','3','4','5','6','7','8','9','⌫','0','✓']) {
      const k = el('div', 'k', d);
      k.onclick = () => {
        if (d === '⌫') val = val.slice(0, -1);
        else if (d === '✓') {
          if (val === w.answer) solve(w.onSolve);
          else { screen.classList.add('err'); setTimeout(() => screen.classList.remove('err'), 400); val = ''; }
        } else if (val.length < 2) val += d;
        refresh();
      };
      pad.appendChild(k);
    }
    refresh();
  }

  function widgetKeypad(box, w, solve) {
    let val = '';
    const screen = el('div', 'screen', w.screen || '');
    const pad = el('div', 'keypad');
    box.appendChild(screen); box.appendChild(pad);
    const refresh = () => { screen.classList.remove('err'); screen.textContent = val.padEnd(4, '·'); };
    for (const d of ['1','2','3','4','5','6','7','8','9','⌫','0','✓']) {
      const k = el('div', 'k', d);
      k.onclick = () => {
        if (d === '⌫') val = val.slice(0, -1);
        else if (d === '✓') {
          if (val === w.answer) solve(w.onSolve);
          else { screen.textContent = 'DENIED'; screen.classList.add('err'); setTimeout(() => { val = ''; refresh(); }, 700); }
        } else if (val.length < 4) val += d;
        if (d !== '✓') refresh();
      };
      pad.appendChild(k);
    }
    refresh();
  }

  function widgetOrder(box, w, solve) {
    const picked = [];
    const seq = el('div', 'seqrow');
    const opts = el('div', 'orderopts');
    box.appendChild(seq); box.appendChild(opts);
    const optEls = {};
    const redrawSeq = () => {
      seq.innerHTML = '';
      picked.forEach((id) => {
        const o = w.options.find((x) => x.id === id);
        const chip = el('div', 'seqchip', '');
        const sw = el('span', 'swatch'); sw.style.background = o.color; chip.appendChild(sw);
        chip.appendChild(document.createTextNode(o.label));
        seq.appendChild(chip);
      });
    };
    const check = () => {
      if (picked.length !== w.answer.length) return;
      const ok = picked.every((id, i) => id === w.answer[i]);
      if (ok) solve(w.onSolve);
      else {
        seq.classList.add('screen'); seq.classList.add('err');
        setTimeout(() => {
          picked.length = 0; redrawSeq(); seq.classList.remove('err');
          for (const id in optEls) optEls[id].classList.remove('picked');
        }, 650);
      }
    };
    for (const o of w.options) {
      const opt = el('div', 'opt');
      const sw = el('span', 'swatch'); sw.style.background = o.color; opt.appendChild(sw);
      opt.appendChild(document.createTextNode(o.label));
      if (o.tag) { const n = el('span', 'num', o.tag); opt.appendChild(n); }
      opt.onclick = () => {
        if (opt.classList.contains('picked')) return;
        opt.classList.add('picked'); picked.push(o.id); redrawSeq(); check();
      };
      optEls[o.id] = opt; opts.appendChild(opt);
    }
  }

  function widgetChoice(box, w, solve) {
    const wrap = el('div', 'choices');
    box.appendChild(wrap);
    for (const o of w.options) {
      const c = el('div', 'choice', o.label);
      c.onclick = () => {
        if (o.id === w.answer) solve(w.onSolve);
        else { c.style.borderColor = '#ff5069'; toast('The machine rejects the answer.'); }
      };
      wrap.appendChild(c);
    }
  }

  function widgetAction(box, w, solve) {
    const b = el('button', 'btn primary wide', w.label);
    b.onclick = () => solve(w.onSolve);
    box.appendChild(b);
  }

  // Toggle a set of labelled relays; correct = the answer set (order-independent).
  function widgetToggle(box, w, solve) {
    const sel = new Set(), cells = {};
    const grid = el('div', 'togglegrid'); box.appendChild(grid);
    for (const o of w.options) {
      const c = el('div', 'tgl', o.label);
      c.onclick = () => {
        if (sel.has(o.id)) { sel.delete(o.id); c.classList.remove('on'); }
        else { sel.add(o.id); c.classList.add('on'); }
      };
      cells[o.id] = c; grid.appendChild(c);
    }
    const btn = el('button', 'btn primary wide', w.label || 'ENGAGE'); box.appendChild(btn);
    btn.onclick = () => {
      const ok = sel.size === w.answer.length && w.answer.every((id) => sel.has(id));
      if (ok) solve(w.onSolve);
      else {
        grid.classList.add('err'); toast(w.failMessage || 'The bus trips and resets.');
        setTimeout(() => { grid.classList.remove('err'); sel.clear(); for (const id in cells) cells[id].classList.remove('on'); }, 600);
      }
    };
  }

  // Mastermind: deduce a `slots`-long colour code from black/white feedback pegs.
  function widgetMastermind(box, w, solve) {
    const slots = w.slots || 4, maxG = w.maxGuesses || 8, answer = w.answer;
    const colorOf = (id) => w.colors.find((c) => c.id === id).color;
    const history = el('div', 'mmhistory'); box.appendChild(history);
    const cur = el('div', 'mmrow current'); box.appendChild(cur);
    const palette = el('div', 'mmpalette'); box.appendChild(palette);
    const submit = el('button', 'btn primary wide', 'SUBMIT'); box.appendChild(submit);
    let guess = [], rows = 0, done = false;
    const drawCur = () => {
      cur.innerHTML = '';
      for (let i = 0; i < slots; i++) {
        const p = el('div', 'mmpeg' + (guess[i] ? ' filled' : ''));
        if (guess[i]) p.style.background = colorOf(guess[i]);
        p.onclick = () => { if (guess[i] != null) { guess.splice(i, 1); drawCur(); } };
        cur.appendChild(p);
      }
    };
    for (const c of w.colors) {
      const sw = el('div', 'mmswatch'); sw.style.background = c.color; sw.title = c.label || '';
      sw.onclick = () => { if (!done && guess.length < slots) { guess.push(c.id); drawCur(); } };
      palette.appendChild(sw);
    }
    const feedback = (g) => {
      let exact = 0, present = 0; const a = answer.slice(), gg = g.slice();
      for (let i = 0; i < slots; i++) if (gg[i] === a[i]) { exact++; a[i] = gg[i] = null; }
      for (let i = 0; i < slots; i++) if (gg[i] != null) { const j = a.indexOf(gg[i]); if (j >= 0) { present++; a[j] = null; } }
      return { exact, present };
    };
    submit.onclick = () => {
      if (done || guess.length < slots) { if (!done) toast('Fill all ' + slots + ' slots.'); return; }
      const { exact, present } = feedback(guess);
      const row = el('div', 'mmrow');
      for (const id of guess) { const p = el('div', 'mmpeg filled'); p.style.background = colorOf(id); row.appendChild(p); }
      const fb = el('div', 'mmfb');
      for (let i = 0; i < exact; i++) fb.appendChild(el('span', 'fbdot exact'));
      for (let i = 0; i < present; i++) fb.appendChild(el('span', 'fbdot present'));
      row.appendChild(fb); history.appendChild(row); rows++;
      if (exact === slots) { done = true; solve(w.onSolve); return; }
      guess = []; drawCur();
      if (rows >= maxG) { toast('Lockout — panel resets.'); history.innerHTML = ''; rows = 0; }
    };
    drawCur();
  }

  // Grid mirror puzzle: rotate mirrors to route the beam from emitter to sensor.
  function widgetBeam(box, w, solve) {
    const { cols, rows } = w;
    const DIR = { E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 }, S: { x: 0, y: 1 } };
    const REFL = { '/': { E: 'N', N: 'E', W: 'S', S: 'W' }, '\\': { E: 'S', S: 'E', W: 'N', N: 'W' } };
    const cells = w.cells.map((c) => ({ ...c }));
    const at = (x, y) => cells.find((c) => c.x === x && c.y === y);
    // legend so it's obvious what each tile is
    const legend = el('div', 'beamlegend');
    const leg = (cls, txt) => { const s = el('span', 'blg'); s.appendChild(el('span', 'blgi ' + cls)); s.appendChild(document.createTextNode(txt)); legend.appendChild(s); };
    leg('lg-emit', 'emitter'); leg('lg-tgt', 'sensor'); leg('lg-rot', 'mirror — click to rotate');
    box.appendChild(legend);
    const grid = el('div', 'beamgrid');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    box.appendChild(grid);
    box.appendChild(el('div', 'beamhint', 'The red beam leaves the emitter. Rotate the glowing mirrors to bend it into the sensor.'));
    let done = false;
    function trace() {
      let x = w.emitter.x, y = w.emitter.y, dir = w.emitter.dir;
      const path = new Set();
      for (let s = 0; s < 400; s++) {
        const d = DIR[dir]; x += d.x; y += d.y;
        if (x < 0 || y < 0 || x >= cols || y >= rows) return { hit: false, path };
        path.add(x + ',' + y);
        if (w.target.x === x && w.target.y === y) return { hit: true, path };
        const c = at(x, y);
        if (c && c.type === 'wall') return { hit: false, path };
        if (c && c.type === 'mirror') dir = REFL[c.mirror][dir];
      }
      return { hit: false, path };
    }
    function render() {
      const { hit, path } = trace();
      grid.innerHTML = '';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cell = el('div', 'bcell');
        if (path.has(x + ',' + y)) cell.classList.add('beam');
        const c = at(x, y);
        if (w.emitter.x === x && w.emitter.y === y) { cell.classList.add('emitter'); cell.appendChild(el('span', 'bicon', '◉')); }
        else if (w.target.x === x && w.target.y === y) { cell.classList.add('target'); if (hit) cell.classList.add('lit'); cell.appendChild(el('span', 'bicon', '◎')); }
        else if (c && c.type === 'wall') cell.classList.add('wall');
        else if (c && c.type === 'mirror') {
          cell.classList.add('mirror'); if (!c.fixed) cell.classList.add('rot');
          cell.dataset.m = c.mirror; // '/' or '\\' — for state/testing
          const bar = el('div', 'mbar' + (c.fixed ? '' : ' rotbar'));
          bar.style.transform = `translate(-50%, -50%) rotate(${c.mirror === '/' ? -45 : 45}deg)`;
          cell.appendChild(bar);
          if (!c.fixed) cell.onclick = () => { c.mirror = c.mirror === '/' ? '\\' : '/'; render(); };
        }
        grid.appendChild(cell);
      }
      if (hit && !done) { done = true; setTimeout(() => solve(w.onSolve), 550); }
    }
    render();
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────
  const invEl = document.getElementById('inventory');
  const invSlots = {};
  function renderInventory(justAdded) {
    for (const [id, meta] of Object.entries(room.items)) {
      let slot = invSlots[id];
      if (!slot) {
        slot = el('div', 'invslot');
        const glyph = el('span', 'glyph', '');
        const tip = el('div', 'tip', meta.label);
        slot.appendChild(glyph); slot.appendChild(tip);
        slot._glyph = glyph;
        slot.addEventListener('click', () => toggleEquip(id));
        invEl.appendChild(slot); invSlots[id] = slot;
      }
      const owned = state.inv.has(id);
      slot.classList.toggle('filled', owned);
      slot.classList.toggle('equipped', state.equipped === id);
      slot._glyph.textContent = owned ? meta.glyph : '';
      if (owned && id === justAdded) { slot.classList.remove('pop'); void slot.offsetWidth; slot.classList.add('pop'); }
    }
  }

  const codeEl = document.getElementById('codeprog');
  function renderCode() {
    codeEl.innerHTML = '';
    state.digits.forEach((d) => {
      const box = el('div', 'd' + (d ? '' : ' empty'), d || '?');
      codeEl.appendChild(box);
    });
  }

  const timerEl = document.getElementById('timer');
  function tickTimer() {
    if (!state.started || state.flags.escaped) return;
    const s = Math.floor((performance.now() - state.t0) / 1000);
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3400);
  }
  function flashBtn(id) {
    const b = document.getElementById(id);
    b.animate([{ borderColor: '#4fd1e0' }, { borderColor: '#24303e' }], { duration: 900 });
  }

  // ── Journal / hints overlays ─────────────────────────────────────────────────
  const journalEl = document.getElementById('journal');
  const journalList = document.getElementById('journal-list');
  function renderJournal(highlightNew = false) {
    journalList.innerHTML = '';
    if (!state.journal.length) { journalList.appendChild(el('div', 'emptynote', 'No evidence recovered yet. Examine the room.')); return; }
    let newestItem = null;
    state.journal.forEach((c, i) => {
      const item = el('div', 'listitem');
      const isNew = highlightNew && i === state.journal.length - 1;
      if (isNew) { item.classList.add('newclue'); newestItem = item; }
      const head = el('h3', '', c.title);
      if (isNew) head.appendChild(el('span', 'newbadge', 'NEW'));
      item.appendChild(head);
      if (c.visual) item.appendChild(buildVisual(c.visual));
      else item.appendChild(el('div', 'clue', c.text));
      journalList.appendChild(item);
    });
    if (newestItem) setTimeout(() => newestItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
  }
  function openJournal(highlightNew = false) {
    renderJournal(highlightNew);
    journalEl.classList.add('open');
  }

  const hintsEl = document.getElementById('hints');
  const hintsList = document.getElementById('hints-list');
  function renderHints() {
    hintsList.innerHTML = '';
    for (const h of room.hints) {
      const item = el('div', 'listitem');
      item.appendChild(el('h3', '', h.name));
      const shown = state.hintTier[h.id] || 0;
      for (let i = 0; i < shown; i++) item.appendChild(el('div', 'tier', h.tiers[i]));
      if (shown < h.tiers.length) {
        const b = el('button', 'btn revealbtn', shown === 0 ? 'Reveal a hint' : 'Reveal more');
        b.onclick = () => { state.hintTier[h.id] = shown + 1; renderHints(); };
        item.appendChild(b);
      }
      hintsList.appendChild(item);
    }
  }

  // ── Equip / use inventory items ──────────────────────────────────────────────
  function toggleEquip(id) {
    if (!state.inv.has(id)) return;
    setEquipped(state.equipped === id ? null : id);
  }
  function setEquipped(id) {
    state.equipped = id;
    for (const [k, slot] of Object.entries(invSlots)) slot.classList.toggle('equipped', id === k);
    statusEl.textContent = id ? `${room.items[id].glyph} ${room.items[id].label} equipped — click where to use it` : '';
  }

  // wire overlay buttons
  document.getElementById('journalbtn').onclick = () => openJournal(false);
  document.getElementById('hintbtn').onclick = () => { renderHints(); hintsEl.classList.add('open'); };
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => document.getElementById(b.dataset.close).classList.remove('open');
  });
  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => { if (e.target === ov && ov.id !== 'intro' && ov.id !== 'ending') ov.classList.remove('open'); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach((o) => { if (o.id !== 'intro' && o.id !== 'ending') o.classList.remove('open'); });
  });

  // ── Intro / ending cinematics ────────────────────────────────────────────────
  const introEl = document.getElementById('intro');
  function runIntro() {
    introEl.classList.add('open');
    document.getElementById('intro-tag').textContent = room.intro.tag;
    document.getElementById('intro-speaker').textContent = room.intro.speaker;
    const lineEl = document.getElementById('intro-line');
    const btn = document.getElementById('intro-btn');
    btn.textContent = room.intro.button;
    let i = 0;
    lineEl.textContent = room.intro.lines[0];
    const adv = setInterval(() => {
      i++;
      if (i < room.intro.lines.length) { lineEl.style.opacity = 0; setTimeout(() => { lineEl.textContent = room.intro.lines[i]; lineEl.style.opacity = 1; }, 300); }
      else { clearInterval(adv); lineEl.textContent = ''; lineEl.classList.remove('quote'); btn.style.display = 'inline-block'; }
    }, 3200);
    lineEl.style.transition = 'opacity .3s';
    btn.onclick = () => { introEl.classList.remove('open'); beginPlay(); };
  }

  function beginPlay() {
    state.started = true; state.t0 = performance.now();
    document.getElementById('hud').classList.add('show');
    renderInventory(); renderCode();
  }

  const endingEl = document.getElementById('ending');
  async function runEnding() {
    document.getElementById('hud').classList.remove('show');
    examineEl.classList.remove('open');
    endingEl.classList.add('open');
    document.getElementById('ending-speaker').textContent = room.ending.speaker;
    const lineEl = document.getElementById('ending-line');
    const finalEl = document.getElementById('ending-final');
    lineEl.style.transition = 'opacity .4s';
    let i = 0; lineEl.textContent = room.ending.lines[0];
    // creeping red as the machine wakes
    tween(6000, (t) => { emergency.intensity = 3.2 + t * 5; ambient.intensity = 0.55 - t * 0.4; });
    await new Promise((res) => {
      const adv = setInterval(() => {
        i++;
        if (i < room.ending.lines.length) { lineEl.style.opacity = 0; setTimeout(() => { lineEl.textContent = room.ending.lines[i]; lineEl.style.opacity = 1; }, 350); }
        else { clearInterval(adv); res(); }
      }, 2600);
    });
    lineEl.style.opacity = 0;
    setTimeout(() => {
      lineEl.style.display = 'none';
      document.getElementById('ending-speaker').style.display = 'none';
      finalEl.style.display = 'block';
      document.getElementById('ending-escaped').textContent = room.ending.escaped;
      document.getElementById('ending-time').textContent = 'TIME · ' + timerEl.textContent;
      const sting = document.getElementById('ending-sting');
      sting.textContent = room.ending.sting;
      setTimeout(() => sting.classList.add('show'), 1800);
    }, 500);
    document.getElementById('ending-again').onclick = () => location.reload();
  }

  // ── Small DOM helper ─────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── Resize + loop ────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let flick = 0, prevT = performance.now();
  function frame() {
    const now = performance.now();
    const dt = Math.min((now - prevT) / 1000, 0.05); prevT = now;
    stepWalk(dt);
    stepTweens(now);
    // faint fluorescent flicker on the emergency light
    if (!state.flags.escaped) {
      flick += 0.05;
      emergency.intensity = 3.0 + Math.sin(flick) * 0.25 + (Math.random() < 0.02 ? -1.5 : 0);
    }
    tickTimer();
    renderer.render(scene, camera);
  }
  // Start the render loop only once the GLBs are in — the intro cinematic covers
  // this, so props are already placed by the time you "wake up" (no pop-in). A
  // fallback timer guarantees the loop starts even if a load stalls or is absent.
  let looping = false;
  function startLoop() { if (looping) return; looping = true; renderShadowsOnce(); renderer.setAnimationLoop(frame); }
  manager.onLoad = startLoop;
  setTimeout(startLoop, 6000);

  // dev shortcuts (harmless in prod): #play skips the intro;
  // #solve pre-arms later puzzles; #open=<objId> auto-opens an examine panel.
  const hash = location.hash;
  if (['play', 'open', 'solve', 'swept', 'books', 'room2', 'walk'].some((k) => hash.includes(k))) {
    introEl.classList.remove('open');
    beginPlay();
    if (hash.includes('solve')) { state.inv.add('sweeper'); state.inv.add('key'); state.inv.add('fuse'); state.flags.booksSwept = true; state.flags.booksSolved = true; state.flags.boxOpen = true; state.flags.computerUnlocked = true; state.flags.fuseInserted = true; state.flags.cellsSolved = true; }
    if (hash.includes('swept')) { state.inv.add('sweeper'); state.flags.booksSwept = true; revealBooks(); }
    const fm = hash.match(/flags=([\w,]+)/);   // dev: pre-set arbitrary flags for testing
    if (fm) fm[1].split(',').forEach((f) => { if (f) state.flags[f] = true; });
    const im = hash.match(/give=([\w,]+)/);    // dev: pre-add inventory items
    if (im) im[1].split(',').forEach((it) => { if (it) { state.inv.add(it); renderInventory(it); } });
    const m = hash.match(/open=(\w+)/);
    if (m) { const o = room.objects.find((x) => x.id === m[1]); if (o) openExamine(o); }
    if (hash.includes('books')) { state.flags.booksSwept = true; revealBooks(); setTimeout(enterBookMode, 200); }
  } else runIntro();
}
