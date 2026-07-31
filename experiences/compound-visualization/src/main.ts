import "./styles.css";
import * as THREE from "three";
import type { AtomFinish, BgColor, LabelColor, Molecule, RenderMode } from "./types";
import { getElement } from "./data/elements";
import { DEFAULT_MOLECULE } from "./data/molecules";
import { fetchMolecule, PubChemError } from "./data/pubchem";
import { SceneManager } from "./scene/SceneManager";
import { MoleculeBuilder, type BuiltMolecule } from "./scene/MoleculeBuilder";
import { Picker, type Pick } from "./scene/Picker";
import { Measure } from "./scene/Measure";
import { Shell } from "./ui/Shell";
import { HeroPanel } from "./ui/HeroPanel";
import { Toolbar } from "./ui/Toolbar";
import { Legend } from "./ui/Legend";
import { InfoPanel } from "./ui/InfoPanel";
import { MoleculePanel } from "./ui/MoleculePanel";
import { PeriodicTable } from "./ui/PeriodicTable";
import { Settings } from "./ui/Settings";

const app = document.getElementById("app") as HTMLElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;

// Flat backdrop drawn behind the transparent canvas.
const sceneBg = document.createElement("div");
sceneBg.className = "scene-bg";
app.prepend(sceneBg);

// Host for CSS2D atom/measure labels, layered over the canvas.
const labelHost = document.createElement("div");
labelHost.className = "label-host";
app.appendChild(labelHost);

const sm = new SceneManager(canvas, labelHost);
const builder = new MoleculeBuilder(sm);
const picker = new Picker(sm);
const measure = new Measure(sm);

// --- Central app state -----------------------------------------------------
let current: Molecule = DEFAULT_MOLECULE;
let built: BuiltMolecule | null = null;
let mode: RenderMode = "ball-and-stick";
let showLabels = true;
let finish: AtomFinish = "satin";
let background: BgColor = "black";

// --- UI --------------------------------------------------------------------
const shell = new Shell();
const heroPanel = new HeroPanel();
const infoPanel = new InfoPanel();
const periodicTable = new PeriodicTable();
const legend = new Legend(() => shell.setCollapsed("right", true));

const settings = new Settings({
  onFinish: (f) => setFinish(f),
  onBackground: (b) => setBackground(b),
  onShadow: (on) => setShadow(on),
  onLabelColor: (c) => setLabelColor(c),
  onBrightness: (m) => sm.setBrightness(m),
  onTemperature: (k) => periodicTable.setTemperature(k),
  onTempUnit: (u) => periodicTable.setTempUnit(u),
});

const molPanel = new MoleculePanel({
  onSelect: (mol) => loadMolecule(mol),
  onSearch: (name) => searchPubChem(name),
  onCollapse: () => shell.setCollapsed("left", true),
});

const toolbar = new Toolbar({
  onRenderMode: (m) => setMode(m),
  onToggleLabels: (on) => setLabels(on),
  onToggleMeasure: (on) => setMeasure(on),
  onToggleAutoRotate: (on) => sm.setAutoRotate(on),
  onToggleFullscreen: () => sm.toggleFullscreen(),
  onSavePng: () =>
    sm.savePng(
      `${current.name.replace(/\s+/g, "-").toLowerCase()}.png`,
      background === "black" ? 0x1e1f22 : 0xffffff,
    ),
  onResetView: () => frameCurrent(),
  onOpenSettings: () => settings.toggle(),
  onOpenPeriodicTable: () => periodicTable.toggle(),
});

const measureReadout = document.createElement("div");
measureReadout.className = "measure-readout hidden";

shell.leftCol.append(heroPanel.root, molPanel.root);
shell.rightCol.append(legend.root, infoPanel.root, measureReadout);

app.append(shell.root, toolbar.root, settings.root, periodicTable.root);

// --- Wiring ----------------------------------------------------------------
picker.onHover = (pick) => {
  document.body.style.cursor = pick ? "pointer" : "default";
};
picker.onClick = (pick) => handlePick(pick);

measure.onReadout = (text) => {
  measureReadout.textContent = text ?? "";
  measureReadout.classList.toggle("hidden", !text);
};

function handlePick(pick: Pick): void {
  if (!pick) return;
  if (pick.kind === "atom") {
    if (measure.active) {
      measure.handlePick(pick.index);
      return;
    }
    infoPanel.showAtom(getElement(current.atoms[pick.index].element));
  } else {
    const a = current.atoms[pick.atomA];
    const b = current.atoms[pick.atomB];
    const order = current.bonds.find(
      (bd) =>
        (bd.a === pick.atomA && bd.b === pick.atomB) ||
        (bd.a === pick.atomB && bd.b === pick.atomA),
    )?.order;
    const length = new THREE.Vector3(a.x, a.y, a.z).distanceTo(
      new THREE.Vector3(b.x, b.y, b.z),
    );
    infoPanel.showBond(a.element, b.element, order ?? 1, length);
  }
}

function rebuild(): void {
  built = builder.build(current, mode, showLabels, finish);
  measure.setMolecule(built.atoms);
  sm.updateGround(built.radius);
}

function loadMolecule(mol: Molecule): void {
  current = mol;
  rebuild();
  frameCurrent();
  heroPanel.update(mol);
  legend.update(mol);
  molPanel.update(mol);
  infoPanel.showDefault(mol);
  periodicTable.setPresent(new Set(mol.atoms.map((a) => a.element)));
  molPanel.setStatus(null);
}

function frameCurrent(): void {
  if (built) sm.frameSphere(built.center, built.radius);
}

function setMode(m: RenderMode): void {
  mode = m;
  toolbar.setRenderMode(m);
  rebuild();
}

function setLabels(on: boolean): void {
  showLabels = on;
  toolbar.setLabels(on);
  rebuild();
}

function setFinish(f: AtomFinish): void {
  finish = f;
  settings.setFinish(f);
  rebuild();
}

function setBackground(b: BgColor): void {
  background = b;
  document.body.classList.toggle("bg-white", b === "white");
  settings.setBackground(b);
}

function setShadow(on: boolean): void {
  sm.setShadow(on);
  settings.setShadow(on);
}

function setLabelColor(c: LabelColor): void {
  document.body.classList.toggle("labels-dark", c === "black");
  settings.setLabelColor(c);
}

function setMeasure(on: boolean): void {
  measure.setActive(on);
  toolbar.setMeasure(on);
  if (on) infoPanel.showDefault(current);
}

async function searchPubChem(name: string): Promise<void> {
  molPanel.setStatus(`Searching PubChem for “${name}”…`);
  try {
    const mol = await fetchMolecule(name);
    loadMolecule(mol);
  } catch (err) {
    const msg =
      err instanceof PubChemError
        ? err.message
        : "Something went wrong fetching that molecule.";
    molPanel.setStatus(msg, "error");
  }
}

// --- Boot ------------------------------------------------------------------
toolbar.setRenderMode(mode);
settings.setFinish(finish);
setBackground(background);
settings.setShadow(true);
settings.setLabelColor("white");
settings.setBrightness(1);
loadMolecule(current);
