import * as THREE from 'three';
import type { ElementData } from './types';

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;

const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

/** Draw the tile-face atlas: one cell per element (symbol, Z, name, mass). */
export function drawTileAtlas(elements: ElementData[], cellPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * cellPx;
  canvas.height = ATLAS_ROWS * cellPx;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  elements.forEach((el, i) => {
    const cx = (i % ATLAS_COLS) * cellPx;
    const cy = Math.floor(i / ATLAS_COLS) * cellPx;
    const s = cellPx / 256; // design space is 256px

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(16, 18, 22, 0.92)';
    ctx.textBaseline = 'middle';

    // atomic number, top-left
    ctx.textAlign = 'left';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(String(el.z), 22, 42);

    // symbol, center
    ctx.textAlign = 'center';
    ctx.font = `700 92px ${FONT}`;
    ctx.fillText(el.symbol, 128, 122);

    // name
    ctx.font = `500 27px ${FONT}`;
    let name = el.name;
    if (ctx.measureText(name).width > 216) {
      ctx.font = `500 22px ${FONT}`;
      if (ctx.measureText(name).width > 216) name = name.slice(0, 12) + '…';
    }
    ctx.fillText(name, 128, 191);

    // mass
    ctx.font = `400 24px ${FONT}`;
    ctx.fillStyle = 'rgba(16, 18, 22, 0.62)';
    ctx.fillText(el.mass !== null ? el.mass.toFixed(el.mass < 100 ? 3 : 2) : '—', 128, 226);

    ctx.restore();
  });

  return canvas;
}

export function atlasUvRect(index: number): { u0: number; v0: number; u1: number; v1: number } {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  // v flipped: three.js UV origin is bottom-left, canvas draws top-down.
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v1 = 1 - row / ATLAS_ROWS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  return { u0, v0, u1, v1 };
}

export interface PanelRow {
  label: string;
  value: string;
}

const PANEL_W = 640;
const PAD = 34;
const TITLE_H = 74;
const LINE_H = 44;

interface WrappedRow {
  label: string;
  lines: string[];
}

function wrapValue(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? current + ' ' + w : w;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Render a floating data panel to a texture. Returns texture + aspect (h/w). */
export function makePanelTexture(
  title: string,
  rows: PanelRow[],
  accent: string
): { texture: THREE.CanvasTexture; aspect: number } {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `500 26px ${FONT}`;
  const valueMax = PANEL_W - PAD * 2 - 190;
  const wrapped: WrappedRow[] = rows.map((r) => ({
    label: r.label,
    lines: wrapValue(measure, r.value, valueMax),
  }));
  const totalLines = wrapped.reduce((a, r) => a + r.lines.length, 0);
  const height = TITLE_H + PAD + totalLines * LINE_H + PAD - 10;

  const canvas = document.createElement('canvas');
  canvas.width = PANEL_W;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // panel body
  const r = 26;
  ctx.beginPath();
  ctx.roundRect(1, 1, PANEL_W - 2, height - 2, r);
  ctx.fillStyle = 'rgba(10, 13, 20, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // title
  ctx.fillStyle = accent;
  ctx.font = `600 24px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title.toUpperCase(), PAD, TITLE_H / 2 + 12);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, TITLE_H);
  ctx.lineTo(PANEL_W - PAD, TITLE_H);
  ctx.stroke();

  // rows
  let y = TITLE_H + PAD + LINE_H / 2 - 10;
  for (const row of wrapped) {
    ctx.font = `400 24px ${FONT}`;
    ctx.fillStyle = 'rgba(235, 240, 248, 0.55)';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, PAD, y);

    ctx.font = `500 26px ${FONT}`;
    ctx.fillStyle = 'rgba(245, 248, 252, 0.96)';
    ctx.textAlign = 'right';
    for (const line of row.lines) {
      ctx.fillText(line, PANEL_W - PAD, y);
      y += LINE_H;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: height / PANEL_W };
}

/** Large floating title: symbol, name, atomic number. */
export function makeTitleTexture(
  symbol: string,
  name: string,
  z: number,
  accent: string
): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'center';
  ctx.font = `700 190px ${FONT}`;
  // muted fill + tight glow: bloom in the atom scene amplifies this further
  ctx.fillStyle = 'rgba(214, 221, 232, 0.8)';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.fillText(symbol, 512, 130);
  ctx.shadowBlur = 0;

  ctx.font = `500 46px ${FONT}`;
  ctx.fillStyle = 'rgba(214, 221, 232, 0.7)';
  ctx.fillText(`${name}  ·  ${z}`, 512, 262);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: 320 / 1024 };
}

/** Wide summary strip with wrapped paragraph text. */
export function makeSummaryTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const W = 1100;
  const PADX = 40;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `400 27px ${FONT}`;
  const lines = wrapValue(measure, text, W - PADX * 2);
  const lineH = 40;
  const H = lines.length * lineH + 66;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.roundRect(1, 1, W - 2, H - 2, 24);
  ctx.fillStyle = 'rgba(10, 13, 20, 0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `400 27px ${FONT}`;
  ctx.fillStyle = 'rgba(235, 240, 248, 0.82)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    ctx.fillText(line, PADX, 40 + i * lineH);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: H / W };
}

/**
 * Title and row labels for the 3D legend board, drawn in board-local world
 * units so the text lines up with the 3D blocks placed beside it.
 */
export function drawLegendPanel(
  worldW: number,
  worldH: number,
  labels: string[],
  rowH: number,
  firstRowY: number,
  labelX: number,
  px = 200
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(worldW * px);
  canvas.height = Math.round(worldH * px);
  const ctx = canvas.getContext('2d')!;
  const toX = (x: number) => (x + worldW / 2) * px;
  const toY = (y: number) => (worldH / 2 - y) * px;

  ctx.textBaseline = 'middle';
  // legible over both the dark wood and the light plastic board
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 0.05 * px;

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.font = `600 ${0.25 * px}px ${FONT}`;
  ctx.letterSpacing = `${0.05 * px}px`;
  ctx.fillText('CATEGORIES', canvas.width / 2, toY(worldH / 2 - 0.6));
  ctx.letterSpacing = '0px';

  ctx.textAlign = 'left';
  ctx.font = `500 ${0.225 * px}px ${FONT}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.93)';
  labels.forEach((label, i) => {
    ctx.fillText(label, toX(labelX), toY(firstRowY - i * rowH));
  });

  return canvas;
}

/** Soft radial glow sprite texture (for the nucleus). */
export function makeGlowTexture(color: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color.replace('1)', '0.55)'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Small round particle texture. */
export function makeParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
