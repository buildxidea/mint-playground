import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BRIEFS, QUESTIONS, matchBrief, pickInterruption, quirkTell } from './briefs.js';
import mintRegistry from '../mint-assets.json';

function mintUrl(assetKey, artifactId) {
  const url = mintRegistry.assets[assetKey]?.artifacts?.[artifactId]?.runtimeUrl;
  if (!url) throw new Error(`Missing Mint CDN artifact ${assetKey}:${artifactId}`);
  return url;
}

const statusEl = document.getElementById('status');
const hudEl = document.getElementById('hud');

// --- Renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1612);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(4.2, 3.2, 5.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 2;
controls.maxDistance = 12;
controls.enabled = false;

// --- Room shell ---
const ROOM = 6;
const PRIMER_WALL = 0xcfc8bc;
const room = new THREE.Group();
scene.add(room);

const wallMat = new THREE.MeshStandardMaterial({ color: PRIMER_WALL, roughness: 0.95 });

const texLoader = new THREE.TextureLoader();
function loadTiledMap(path, isColor) {
  const t = texLoader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  if (isColor) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const oakFloorMat = new THREE.MeshStandardMaterial({
  map: loadTiledMap(mintUrl('warm-oak-floor', 'basecolor'), true),
  normalMap: loadTiledMap(mintUrl('warm-oak-floor', 'normal')),
  roughnessMap: loadTiledMap(mintUrl('warm-oak-floor', 'roughness')),
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), oakFloorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
room.add(floor);

const wallH = 3;
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, wallH), wallMat);
backWall.position.set(0, wallH / 2, -ROOM / 2);
backWall.receiveShadow = true;
room.add(backWall);

const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, wallH), wallMat);
leftWall.rotation.y = Math.PI / 2;
leftWall.position.set(-ROOM / 2, wallH / 2, 0);
leftWall.receiveShadow = true;
room.add(leftWall);

const baseMat = new THREE.MeshStandardMaterial({ color: 0xf7f2e9, roughness: 0.6 });
const base1 = new THREE.Mesh(new THREE.BoxGeometry(ROOM, 0.12, 0.04), baseMat);
base1.position.set(0, 0.06, -ROOM / 2 + 0.02);
room.add(base1);
const base2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, ROOM), baseMat);
base2.position.set(-ROOM / 2 + 0.02, 0.06, 0);
room.add(base2);

// --- Lighting (neutral daytime default; light cards change the mood) ---
const ambient = new THREE.AmbientLight(0xfff2e0, 0.4);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffeccc, 1.8);
sun.position.set(4, 5, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -5;
sun.shadow.camera.right = 5;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -5;
sun.shadow.bias = -0.0003;
scene.add(sun);

const fill = new THREE.HemisphereLight(0xfff6ea, 0x8a6f52, 0.45);
scene.add(fill);

const eveningGlow = new THREE.PointLight(0xffb46b, 0, 7, 1.6);
eveningGlow.position.set(0, 1.6, 0);
scene.add(eveningGlow);

const LIGHT_MOODS = {
  neutral: { sun: [0xffeccc, 1.8], ambient: 0.4, glow: 0 },
  morning: { sun: [0xfff3d6, 2.6], ambient: 0.55, glow: 0 },
  evening: { sun: [0x8fa3c4, 0.45], ambient: 0.18, glow: 2.4 },
};

function applyLightMood(id) {
  const mood = LIGHT_MOODS[id] || LIGHT_MOODS.neutral;
  const sunFrom = sun.color.clone();
  const sunTo = new THREE.Color(mood.sun[0]);
  const fromI = sun.intensity, fromA = ambient.intensity, fromG = eveningGlow.intensity;
  tween(1200, (t) => {
    sun.color.lerpColors(sunFrom, sunTo, t);
    sun.intensity = fromI + (mood.sun[1] - fromI) * t;
    ambient.intensity = fromA + (mood.ambient - fromA) * t;
    eveningGlow.intensity = fromG + (mood.glow - fromG) * t;
  });
}

// --- Tween helper ---
const tweens = [];
function tween(duration, onUpdate, { delay = 0, ease = (t) => 1 - Math.pow(1 - t, 3) } = {}) {
  return new Promise((resolve) => {
    tweens.push({ start: performance.now() + delay, duration, onUpdate, ease, resolve });
  });
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

// --- Cards: the full deck (loadout picks 4) ---
const CARDS = [
  { id: 'bed', kind: 'furniture', word: 'bed', label: 'Platform Bed', img: mintUrl('furniture-bed', 'preview_image'), glb: mintUrl('furniture-bed', 'model_glb'), targetSize: 2.0, uses: 3 },
  { id: 'armchair', kind: 'furniture', word: 'chair', label: 'Armchair', img: mintUrl('furniture-armchair', 'preview_image'), glb: mintUrl('furniture-armchair', 'model_glb'), targetSize: 1.4, uses: 3 },
  { id: 'nightstand', kind: 'furniture', word: 'stand', label: 'Nightstand', img: mintUrl('furniture-nightstand', 'preview_image'), glb: mintUrl('furniture-nightstand', 'model_glb'), targetSize: 0.5, uses: 3 },
  { id: 'lamp', kind: 'furniture', word: 'lamp', label: 'Lantern Lamp', img: mintUrl('furniture-lamp', 'preview_image'), glb: mintUrl('furniture-lamp', 'model_glb'), targetSize: 1.3, uses: 3 },
  { id: 'plant', kind: 'furniture', word: 'plant', label: 'Tall Plant', img: mintUrl('furniture-plant', 'preview_image'), glb: mintUrl('furniture-plant', 'model_glb'), targetSize: 1.5, uses: 4 },
  { id: 'ironbed', kind: 'furniture', word: 'iron bed', label: 'Iron Bed', img: mintUrl('furniture-ironbed', 'preview_image'), glb: mintUrl('furniture-ironbed', 'model_glb'), targetSize: 2.0, uses: 3 },
  { id: 'rocking', kind: 'furniture', word: 'rocker', label: 'Rocking Chair', img: mintUrl('furniture-rocking', 'preview_image'), glb: mintUrl('furniture-rocking', 'model_glb'), targetSize: 1.0, uses: 3 },
  { id: 'rug', kind: 'furniture', word: 'rug', label: 'Woven Rug', img: mintUrl('furniture-rug', 'preview_image'), glb: mintUrl('furniture-rug', 'model_glb'), targetSize: 1.6, uses: 3 },
  { id: 'fern', kind: 'furniture', word: 'fern', label: 'Potted Fern', img: mintUrl('furniture-fern', 'preview_image'), glb: mintUrl('furniture-fern', 'model_glb'), targetSize: 0.7, uses: 4 },
  { id: 'inflatable', kind: 'furniture', word: 'inflatable', label: 'Inflatable Chair', img: mintUrl('furniture-inflatable', 'preview_image'), glb: mintUrl('furniture-inflatable', 'model_glb'), targetSize: 0.85, uses: 3 },
  { id: 'lava', kind: 'furniture', word: 'lava', label: 'Lava Lamp', img: mintUrl('furniture-lava', 'preview_image'), glb: mintUrl('furniture-lava', 'model_glb'), targetSize: 0.5, uses: 3 },
  { id: 'crt', kind: 'furniture', word: 'crt', label: 'CRT TV', img: mintUrl('furniture-crt', 'preview_image'), glb: mintUrl('furniture-crt', 'model_glb'), targetSize: 0.55, uses: 3 },
  { id: 'beanbag', kind: 'furniture', word: 'beanbag', label: 'Beanbag', img: mintUrl('furniture-beanbag', 'preview_image'), glb: mintUrl('furniture-beanbag', 'model_glb'), targetSize: 0.95, uses: 3 },
  { id: 'wall-sage', kind: 'wall', word: 'sage', label: 'Sage Paint', color: '#b7c2a5', wall: '#ccd3bd', uses: 1 },
  { id: 'wall-cream', kind: 'wall', word: 'cream', label: 'Cream Paint', color: '#f0e7d8', wall: '#efe6d8', uses: 1 },
  { id: 'wall-clay', kind: 'wall', word: 'clay', label: 'Clay Paint', color: '#d9b09a', wall: '#e2c4b0', uses: 1 },
  { id: 'poster', kind: 'poster', word: 'poster', label: 'Poster', img: mintUrl('image-arches', 'image_file'), uses: 4 },
];
const SLOTS = 8;

// Mint-generated poster artworks — C key cycles the art on a selected poster
const POSTER_ARTS = [
  { id: 'arches', label: 'Quiet Arches', url: mintUrl('image-arches', 'image_file') },
  { id: 'oneline', label: 'One Line', url: mintUrl('image-oneline', 'image_file') },
  { id: 'flowers', label: 'Pressed Flowers', url: mintUrl('image-flowers', 'image_file') },
  { id: 'garden', label: 'Cottage Garden', url: mintUrl('image-garden', 'image_file') },
  { id: 'chrome', label: 'Chrome Dream', url: mintUrl('image-chrome', 'image_file') },
  { id: 'grid', label: 'Neon Grid', url: mintUrl('image-grid', 'image_file') },
];

// --- Level state ---
let appliedWall = null;   // wall color string, for scoring
let armedCard = null;
const placed = [];

// --- Guest texts + complications during the build ---
const textfeedEl = document.getElementById('textfeed');
const twistbannerEl = document.getElementById('twistbanner');

function sendGuestText(line, isTwist = false) {
  const msg = document.createElement('div');
  msg.className = isTwist ? 'textmsg twist' : 'textmsg';
  msg.innerHTML = `<span class="from">${currentBrief.emoji} ${currentBrief.name.toUpperCase()}</span>${line}`;
  textfeedEl.appendChild(msg);
  const life = isTwist ? 7000 : 3800;
  setTimeout(() => msg.classList.add('fade'), life);
  setTimeout(() => msg.remove(), life + 700);
}

// Called after every placement. Quirk violations ALWAYS get called out —
// that's the guest teaching you their hardcoded rule so a restart is informed.
// Everything else goes through the normal chattiness roll.
function onPlacement(key) {
  const tell = quirkTell(currentBrief, key);
  if (tell) {
    sendGuestText(tell, true);
    return;
  }
  const line = pickInterruption(currentBrief, key, placed.length);
  if (line) sendGuestText(line);
}

// --- Free ambience toggle (never scores, never uses a slot) ---
const lightbarEl = document.getElementById('lightbar');
const lightButtons = {
  neutral: document.getElementById('light-neutral'),
  morning: document.getElementById('light-morning'),
  evening: document.getElementById('light-evening'),
};
for (const [id, btn] of Object.entries(lightButtons)) {
  btn.addEventListener('click', () => {
    applyLightMood(id);
    for (const b of Object.values(lightButtons)) b.classList.remove('on');
    btn.classList.add('on');
  });
}

// --- Loadout picker ---
const pickerEl = document.getElementById('picker');
const pickerTitle = document.getElementById('picker-title');
const pickerHint = document.getElementById('picker-hint');
const tilesEl = document.getElementById('tiles');
const buildbarEl = document.getElementById('buildbar');
const buildBtn = document.getElementById('buildbtn');
const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => document.getElementById(`slot${i}`));
const paintSlotEl = document.getElementById('paintslot');
const cardbarEl = document.getElementById('cardbar');
const loadout = [];       // furniture + poster cards only — paint has its own slot
let paintChoice = null;   // the one wall paint you bring, free of charge

for (const card of CARDS) {
  const el = document.createElement('div');
  el.className = 'tile';
  if (card.img) el.style.backgroundImage = `url(${card.img})`;
  else if (card.gradient) el.style.background = card.gradient;
  else el.style.background = card.color;
  el.innerHTML = `<span class="kind">${card.kind}</span><span class="word">${card.word}</span><span class="dot"></span>`;
  el.addEventListener('click', () => toggleLoadout(card, el));
  card.el = el;
  tilesEl.appendChild(el);
}

function toggleLoadout(card, el) {
  if (card.kind === 'wall') {
    // paint rides along in its own slot — never competes with furniture
    const prev = paintChoice;
    paintChoice = paintChoice === card ? null : card;
    if (prev) prev.el.classList.remove('on');
    el.classList.toggle('on', paintChoice === card);
    if (paintChoice) paintChoice.el.querySelector('.dot').textContent = '✓';
    paintSlotEl.classList.toggle('filled', !!paintChoice);
    paintSlotEl.style.backgroundColor = paintChoice?.color || 'transparent';
  } else {
    const idx = loadout.indexOf(card);
    if (idx >= 0) loadout.splice(idx, 1);
    else if (loadout.length < SLOTS) loadout.push(card);
    else return;
    el.classList.toggle('on', loadout.includes(card));
    loadout.forEach((c, i) => { c.el.querySelector('.dot').textContent = i + 1; });
    slots.forEach((s, i) => {
      const c = loadout[i];
      s.classList.toggle('filled', !!c);
      s.style.backgroundImage = c?.img ? `url(${c.img})` : c?.gradient || 'none';
      s.style.backgroundColor = c?.color || 'transparent';
    });
  }
  buildBtn.classList.toggle('ready', loadout.length >= 1 || !!paintChoice);
}

// --- Card bar (in-level) ---
function buildCardBar() {
  cardbarEl.innerHTML = '';
  const kit = paintChoice ? [...loadout, paintChoice] : [...loadout];
  for (const card of kit) {
    card.remaining = card.uses;
    const el = document.createElement('button');
    el.className = 'card';
    const face = card.img ? `background-image:url(${card.img})` : `background:${card.gradient || card.color}`;
    el.innerHTML = `<div class="img" style="${face}"></div><span>${card.label}</span><span class="uses">${card.remaining}</span>`;
    el.addEventListener('click', () => armCard(card));
    card.barEl = el;
    cardbarEl.appendChild(el);
  }
  cardbarEl.style.display = 'flex';
}

function armCard(card) {
  if (card.remaining <= 0) return;
  if (card.kind === 'wall') { consumeCard(card); paintWalls(card); return; }
  armedCard = armedCard === card ? null : card;
  for (const c of [...loadout, ...(paintChoice ? [paintChoice] : [])]) {
    if (c.barEl) c.barEl.classList.toggle('armed', c === armedCard);
  }
  if (!armedCard) { statusEl.textContent = ''; return; }
  statusEl.textContent = armedCard.kind === 'poster'
    ? 'click a wall to hang the poster'
    : `click the floor to place ${armedCard.label}`;
}

function consumeCard(card) {
  card.remaining -= 1;
  card.barEl.querySelector('.uses').textContent = card.remaining;
  if (card.remaining <= 0) card.barEl.classList.add('spent');
}

function refundCard(card) {
  card.remaining += 1;
  card.barEl.querySelector('.uses').textContent = card.remaining;
  card.barEl.classList.remove('spent');
}

function paintWalls(card) {
  appliedWall = card.wall;
  const from = wallMat.color.clone();
  const to = new THREE.Color(card.wall);
  tween(1100, (t) => { wallMat.color.lerpColors(from, to, t); });
  statusEl.textContent = `${card.label} on the walls`;
}

// --- Furniture placement ---
const loader = new GLTFLoader();

function normalize(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetSize / Math.max(size.x, size.y, size.z);
  object.scale.setScalar(scale);
  box.setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
}

function placeFromCard(card, x, z) {
  consumeCard(card);
  loader.load(card.glb, (gltf) => {
    const model = gltf.scene;
    model.traverse((n) => {
      if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
    });
    const wrapper = new THREE.Group();
    normalize(model, card.targetSize);
    wrapper.add(model);
    wrapper.position.set(x, 2.2, z);
    wrapper.userData.furniture = true;
    wrapper.userData.name = card.label;
    wrapper.userData.key = card.id;
    wrapper.userData.card = card;
    scene.add(wrapper);
    placed.push(wrapper);
    tween(650, (t) => { wrapper.position.y = 2.2 * (1 - t); });
    statusEl.textContent = `+ ${card.label}`;
    onPlacement(card.id);
  });
}

// --- Posters: code-built frame, Mint-generated artwork, C cycles art ---
const posterTexCache = {};
function posterTexture(url) {
  if (!posterTexCache[url]) {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    posterTexCache[url] = t;
  }
  return posterTexCache[url];
}

function placePoster(card, wallMesh, point) {
  consumeCard(card);
  const group = new THREE.Group();
  // frame proportions match the generated art's ~0.56 aspect ratio
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.92, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x8a6f52, roughness: 0.6 })
  );
  // art sits clearly proud of the frame face + polygon offset, so it can never z-fight
  const artMat = new THREE.MeshStandardMaterial({
    map: posterTexture(POSTER_ARTS[0].url),
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.82), artMat);
  art.position.z = 0.032;
  frame.castShadow = true;
  group.add(frame, art);

  const y = THREE.MathUtils.clamp(point.y, 1.15, 2.1);
  const onLeftWall = wallMesh === leftWall;
  if (onLeftWall) {
    group.position.set(-ROOM / 2 + 0.03, y, THREE.MathUtils.clamp(point.z, -ROOM / 2 + 0.5, ROOM / 2 - 0.5));
    group.rotation.y = Math.PI / 2;
  } else {
    group.position.set(THREE.MathUtils.clamp(point.x, -ROOM / 2 + 0.5, ROOM / 2 - 0.5), y, -ROOM / 2 + 0.03);
  }
  group.userData.furniture = true;
  group.userData.kind = 'poster';
  group.userData.name = 'Poster';
  group.userData.key = 'poster';
  group.userData.card = card;
  group.userData.artIdx = 0;
  group.userData.artMat = artMat;
  scene.add(group);
  placed.push(group);
  statusEl.textContent = 'poster hung · C to change the art';
  onPlacement('poster');
}

function cyclePosterArt(group) {
  group.userData.artIdx = (group.userData.artIdx + 1) % POSTER_ARTS.length;
  const artEntry = POSTER_ARTS[group.userData.artIdx];
  group.userData.artMat.map = posterTexture(artEntry.url);
  group.userData.artMat.needsUpdate = true;
  statusEl.textContent = `poster art: ${artEntry.label}`;
}

// --- Level progress (persists across sessions) ---
const PROGRESS_KEY = 'mtr-progress';
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { bestStars: {} }; }
  catch { return { bestStars: {} }; }
}
function saveProgress(name, stars) {
  const p = loadProgress();
  p.bestStars[name] = Math.max(p.bestStars[name] || 0, stars);
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

// --- Answer key overlay: rendered straight from brief data ---
const answerKeyEl = document.getElementById('answerkey');
const CARD_LABELS = Object.fromEntries(CARDS.map((c) => [c.id, c.label]));
const WALL_NAMES = { '#ccd3bd': 'sage', '#efe6d8': 'cream', '#e2c4b0': 'clay' };
const labelOf = (k) => CARD_LABELS[k] || k;

function renderAnswerKey() {
  const best = loadProgress().bestStars;
  document.getElementById('keyrows').innerHTML = BRIEFS.map((b) => {
    const stars = best[b.name] || 0;
    const loves = [
      ...b.wants.pieces.map(labelOf),
      ...b.wants.wall.map((w) => `${WALL_NAMES[w] || w} walls`),
    ];
    return `<div class="key-row">
      <h2><span>${b.emoji} ${b.name}</span>
        <span><span class="lit">${'★'.repeat(stars)}</span><span class="dim">${'★'.repeat(3 - stars)}</span></span></h2>
      <dl>
        <dt>needs</dt><dd>${b.requires.length ? b.requires.map(labelOf).join(', ') : '—'}</dd>
        <dt>loves</dt><dd>${loves.length ? loves.join(', ') : '—'}</dd>
        <dt>hates</dt><dd>${b.dislikes.length ? b.dislikes.map(labelOf).join(', ') : '—'}</dd>
        <dt>quirk</dt><dd class="quirk-line">no ${b.quirk.forbid.map(labelOf).join(', no ')} — “${b.quirk.tell}”</dd>
        <dt>limit</dt><dd>${b.maxPieces} pieces max</dd>
      </dl>
    </div>`;
  }).join('');
}

document.getElementById('keybtn').addEventListener('click', () => {
  renderAnswerKey();
  answerKeyEl.classList.add('open');
});
document.getElementById('keyclose').addEventListener('click', () => {
  answerKeyEl.classList.remove('open');
});
answerKeyEl.addEventListener('click', (e) => {
  if (e.target === answerKeyEl) answerKeyEl.classList.remove('open');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') answerKeyEl.classList.remove('open');
});

// --- Guest flow ---
const briefEl = document.getElementById('brief');
const briefFace = document.getElementById('brief-face');
const briefName = document.getElementById('brief-name');
const briefLine = document.getElementById('brief-line');
const briefAccept = document.getElementById('brief-accept');
const inviteBtn = document.getElementById('invitebtn');
const nextBtn = document.getElementById('nextbtn');
const restartBtn = document.getElementById('restartbtn');
const commentEl = document.getElementById('comment');
const guestbookEl = document.getElementById('guestbook');

let guestIdx = 0;
let currentBrief = BRIEFS[0];
let askedQuestion = null; // one interview question per guest

const questionsEl = document.getElementById('brief-questions');
const answerEl = document.getElementById('brief-answer');

function showBrief() {
  currentBrief = BRIEFS[guestIdx % BRIEFS.length];
  askedQuestion = null;
  briefFace.textContent = currentBrief.emoji;
  briefName.textContent = currentBrief.name;
  briefLine.textContent = `“${currentBrief.line}”`;
  const level = (guestIdx % BRIEFS.length) + 1;
  const best = loadProgress().bestStars[currentBrief.name] || 0;
  document.getElementById('brief-level').innerHTML =
    `LEVEL ${level} / ${BRIEFS.length}` +
    (best ? ` · best <span class="lit">${'★'.repeat(best)}</span><span class="dim">${'★'.repeat(3 - best)}</span>` : '');
  answerEl.style.display = 'none';
  answerEl.textContent = '';
  questionsEl.innerHTML = '';
  for (const q of QUESTIONS) {
    const btn = document.createElement('button');
    btn.textContent = q.label;
    btn.addEventListener('click', () => {
      if (askedQuestion) return;
      askedQuestion = q;
      btn.classList.add('asked');
      for (const other of questionsEl.children) {
        if (other !== btn) other.disabled = true;
      }
      answerEl.textContent = `“${currentBrief.answers[q.id]}”`;
      answerEl.style.display = 'block';
    });
    questionsEl.appendChild(btn);
  }
  briefEl.classList.remove('fade');
  pickerTitle.textContent = `Pack your kit for ${currentBrief.name}`;
}

briefAccept.addEventListener('click', () => {
  briefEl.classList.add('fade');
  pickerHint.textContent = askedQuestion
    ? `${currentBrief.emoji} “${currentBrief.answers[askedQuestion.id]}”`
    : `you didn’t ask ${currentBrief.name} anything — packing blind`;
});

buildBtn.addEventListener('click', () => {
  pickerEl.classList.add('fade');
  buildbarEl.classList.add('fade');
  buildCardBar();
  lightbarEl.style.display = 'flex';
  controls.enabled = true;
  hudEl.classList.add('show');
  inviteBtn.textContent = `Invite ${currentBrief.name} in`;
  inviteBtn.style.display = 'block';
  restartBtn.style.display = 'block';
  statusEl.textContent = `place your pieces, then invite ${currentBrief.name} in`;
});

function screenPosOf(object) {
  const v = object.position.clone().add(new THREE.Vector3(0, 0.9, 0)).project(camera);
  return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
}

function spawnHearts(x, y, count, glyph = '❤️') {
  for (let i = 0; i < count; i++) {
    const h = document.createElement('div');
    h.className = 'heart';
    h.textContent = glyph;
    h.style.left = `${x + (Math.random() - 0.5) * 120}px`;
    h.style.top = `${y + (Math.random() - 0.5) * 40}px`;
    h.style.animationDelay = `${Math.random() * 0.8}s`;
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 2600);
  }
}

async function inviteGuest() {
  inviteBtn.style.display = 'none';
  restartBtn.style.display = 'none';
  cardbarEl.style.display = 'none';
  lightbarEl.style.display = 'none';
  armedCard = null;
  select(null);

  const result = matchBrief(currentBrief, {
    placedKeys: placed.map((w) => w.userData.key),
    wall: appliedWall,
  });

  const fav = placed.find((w) => w.userData.key === result.favoriteKey);
  if (fav) {
    controls.enabled = false;
    const camFrom = camera.position.clone();
    const away = camFrom.clone().sub(fav.position).setY(0).normalize().multiplyScalar(3.6);
    const camTo = fav.position.clone().add(away).setY(2.3);
    const tgtFrom = controls.target.clone();
    const tgtTo = fav.position.clone().add(new THREE.Vector3(0, 0.5, 0));
    await tween(1400, (t) => {
      camera.position.lerpVectors(camFrom, camTo, t);
      controls.target.lerpVectors(tgtFrom, tgtTo, t);
    });
  }

  const positive = result.stars >= 2;
  const glyph = positive ? '⭐' : '💭';
  const count = result.stars === 3 ? 12 : result.stars === 2 ? 6 : 2;
  const [sx, sy] = fav && positive ? screenPosOf(fav) : [window.innerWidth / 2, window.innerHeight / 2.4];
  spawnHearts(sx, sy, count, glyph);
  // quirk violations get the guest's specific complaint instead of the stock line
  let reactionText = currentBrief.reactions[result.reactionKey];
  if (result.quirkViolated && result.outcome !== 'high') {
    reactionText = currentBrief.quirk.reaction;
  }
  commentEl.querySelector('.who').textContent = `${currentBrief.emoji} ${currentBrief.name.toUpperCase()}`;
  commentEl.querySelector('.text').textContent = reactionText;
  commentEl.querySelector('.stars').innerHTML =
    `<span class="lit">${'★'.repeat(result.stars)}</span><span class="dim">${'★'.repeat(3 - result.stars)}</span>`;
  commentEl.style.display = 'block';

  await new Promise((r) => setTimeout(r, 2400));

  saveProgress(currentBrief.name, result.stars);

  const shot = document.createElement('div');
  shot.className = 'polaroid';
  shot.innerHTML = `<img src="${renderer.domElement.toDataURL('image/jpeg', 0.7)}"><div class="cap">${currentBrief.emoji} ${currentBrief.name} ${'★'.repeat(result.stars)}</div>`;
  guestbookEl.appendChild(shot);

  controls.enabled = true;
  nextBtn.style.display = 'block';
}

inviteBtn.addEventListener('click', inviteGuest);

function resetRoom() {
  for (const w of placed) scene.remove(w);
  placed.length = 0;
  select(null);
  appliedWall = null;
  armedCard = null;
  twistbannerEl.style.display = 'none';
  textfeedEl.innerHTML = '';
  wallMat.color.set(PRIMER_WALL);
  applyLightMood('neutral');
  for (const b of Object.values(lightButtons)) b.classList.remove('on');
  lightButtons.neutral.classList.add('on');
  lightbarEl.style.display = 'none';
  controls.enabled = false;
  camera.position.set(4.2, 3.2, 5.4);
  controls.target.set(0, 0.8, 0);
  hudEl.classList.remove('show');
  commentEl.style.display = 'none';
  nextBtn.style.display = 'none';
  cardbarEl.style.display = 'none';
  statusEl.textContent = '';
  inviteBtn.style.display = 'none';
  restartBtn.style.display = 'none';
  for (const c of [...loadout]) toggleLoadout(c, c.el);
  if (paintChoice) toggleLoadout(paintChoice, paintChoice.el);
  pickerEl.classList.remove('fade');
  buildbarEl.classList.remove('fade');
}

restartBtn.addEventListener('click', () => {
  resetRoom(); // same guest, same interview answer — repack and try again
  statusEl.textContent = `fresh start — repack your kit for ${currentBrief.name}`;
});

nextBtn.addEventListener('click', () => {
  resetRoom();
  guestIdx += 1;
  showBrief();
});

// --- Selection / drag / rotate / take-back ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = null;
let selected = null;
const LIMIT = ROOM / 2 - 0.4;

const selectRing = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.62, 48),
  new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
);
selectRing.rotation.x = -Math.PI / 2;
selectRing.position.y = 0.01;
selectRing.visible = false;
scene.add(selectRing);

function select(group) {
  selected = group;
  const isPoster = group?.userData.kind === 'poster';
  selectRing.visible = !!group && !isPoster;
  if (isPoster) {
    statusEl.textContent = 'Poster · C change art · ⌫ take back';
  } else if (group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.6;
    selectRing.geometry.dispose();
    selectRing.geometry = new THREE.RingGeometry(r, r + 0.07, 48);
    statusEl.textContent = `${group.userData.name} · R rotate · ⌫ take back`;
  }
}

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function topGroup(obj) {
  while (obj && !obj.userData.furniture) obj = obj.parent;
  return obj;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!controls.enabled) return;
  setPointer(e);

  // armed card: place onto the floor, or hang on a wall for posters
  if (armedCard) {
    const card = armedCard;
    let didPlace = false;
    if (card.kind === 'poster') {
      const wallHits = raycaster.intersectObjects([backWall, leftWall]);
      if (wallHits.length) {
        placePoster(card, wallHits[0].object, wallHits[0].point);
        didPlace = true;
      }
    } else {
      const pt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(floorPlane, pt)) {
        placeFromCard(card,
          THREE.MathUtils.clamp(pt.x, -LIMIT, LIMIT),
          THREE.MathUtils.clamp(pt.z, -LIMIT, LIMIT));
        didPlace = true;
      }
    }
    // always disarm after placing — prevents accidental double-placement
    // when the next click was meant to select something
    if (didPlace) {
      armedCard = null;
      card.barEl.classList.remove('armed');
    }
    return;
  }

  const hits = raycaster.intersectObjects(placed, true);
  if (hits.length) {
    const group = topGroup(hits[0].object);
    select(group);
    if (group.userData.kind !== 'poster') {
      dragging = group;
      controls.enabled = false;
    }
  } else {
    select(null);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  setPointer(e);
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(floorPlane, pt)) {
    dragging.position.x = THREE.MathUtils.clamp(pt.x, -LIMIT, LIMIT);
    dragging.position.z = THREE.MathUtils.clamp(pt.z, -LIMIT, LIMIT);
  }
});

window.addEventListener('pointerup', () => {
  if (dragging) controls.enabled = true;
  dragging = null;
});

window.addEventListener('keydown', (e) => {
  if (!selected) return;
  if (e.key.toLowerCase() === 'c' && selected.userData.kind === 'poster') {
    cyclePosterArt(selected);
    return;
  }
  if (selected.userData.kind !== 'poster') {
    const step = { r: Math.PI / 4, q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
    if (step) { selected.rotation.y += step; return; }
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const name = selected.userData.name;
    const idx = placed.indexOf(selected);
    if (idx >= 0) placed.splice(idx, 1);
    scene.remove(selected);
    if (selected.userData.card) refundCard(selected.userData.card);
    select(null);
    // removal counts: clutter and dislikes are always scored from what's
    // actually in the room at invite time, so this piece is truly gone
    statusEl.textContent = `took back ${name} · ${placed.length} piece${placed.length === 1 ? '' : 's'} in the room`;
  }
});

// --- Loop ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  stepTweens(performance.now());
  controls.update();
  if (selected) {
    selectRing.position.x = selected.position.x;
    selectRing.position.z = selected.position.z;
  }
  renderer.render(scene, camera);
});

showBrief();
