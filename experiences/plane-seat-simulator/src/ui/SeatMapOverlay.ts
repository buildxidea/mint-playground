import {
  AFT_GALLEY,
  DIMS,
  EXITS,
  GALLEY,
  HALF_W,
  LAVATORY,
  SEATS,
  toMap,
} from "../data/cabin-layout";
import type { LocationId } from "../data/layout-types";
import type { AppState } from "../state/AppState";

const S = 40; // px per meter
const PAD_X = 128; // room for the wings
const PAD_Y = 74; // room for the nose cone

function pt(x: number, z: number) {
  const { mx, my } = toMap(x, z, S, 0);
  return { mx: mx + PAD_X, my: my + PAD_Y };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: SVGElement | null,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/**
 * SVG seat map generated from the cabin layout data: a docked, dismissable
 * panel over whatever view is running, and the way into the first-person
 * seated view.
 */
export class SeatMapOverlay {
  private container: HTMLDivElement;
  private marker: SVGCircleElement;
  private title: HTMLDivElement;
  private selection: HTMLDivElement;
  private legend: HTMLDivElement;
  private detail: HTMLDivElement;
  private svg: SVGSVGElement;
  private closeBtn: HTMLButtonElement;
  /** Full-extent viewBox; the zoom/pan view is always a window onto this. */
  private base = { w: 0, h: 0 };
  private view = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    root: HTMLElement,
    private state: AppState,
    private onPick: (id: LocationId) => void,
  ) {
    this.container = document.createElement("div");
    this.container.id = "map-overlay";
    root.appendChild(this.container);

    // Header reads out what is selected rather than restating what the panel
    // is, so it always answers "where am I" at a glance.
    const header = document.createElement("div");
    header.className = "map-header";
    this.container.appendChild(header);

    this.title = document.createElement("div");
    this.title.className = "map-title";
    header.appendChild(this.title);

    this.selection = document.createElement("div");
    this.selection.className = "map-selection";
    header.appendChild(this.selection);

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "map-close";
    this.closeBtn.innerHTML =
      `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/></svg>`;
    this.closeBtn.title = "Close map";
    this.closeBtn.setAttribute("aria-label", "Close map");
    this.closeBtn.addEventListener("click", () => {
      this.state.patch({ mapOpen: false });
    });
    header.appendChild(this.closeBtn);

    const width = PAD_X * 2 + DIMS.width * S;
    const height = PAD_Y + DIMS.length * S + 66;
    this.base = { w: width, h: height };
    this.view = { x: 0, y: 0, w: width, h: height };
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "map-svg" }, null);
    this.svg = svg;
    this.container.appendChild(svg as unknown as HTMLElement);

    // Wings (drawn first so the fuselage sits on top).
    for (const dir of [-1, 1]) {
      const wing = [
        pt(dir * HALF_W, 7.4),
        pt(dir * 4.4, 10.4),
        pt(dir * 4.4, 11.7),
        pt(dir * HALF_W, 10.7),
      ];
      el(
        "polygon",
        {
          points: wing.map((p) => `${p.mx},${p.my}`).join(" "),
          class: "map-wing",
        },
        svg,
      );
    }

    // Fuselage outline: nose cone, straight body, tail taper.
    const left = pt(-HALF_W, 0);
    const right = pt(HALF_W, 0);
    const leftAft = pt(-HALF_W, DIMS.length);
    const rightAft = pt(HALF_W, DIMS.length);
    const noseTip = { mx: (left.mx + right.mx) / 2, my: PAD_Y - 58 };
    const tailTip = { mx: noseTip.mx, my: leftAft.my + 50 };
    el(
      "path",
      {
        d:
          `M ${left.mx} ${left.my} ` +
          `C ${left.mx} ${noseTip.my + 14}, ${noseTip.mx - 20} ${noseTip.my}, ${noseTip.mx} ${noseTip.my} ` +
          `C ${noseTip.mx + 20} ${noseTip.my}, ${right.mx} ${noseTip.my + 14}, ${right.mx} ${right.my} ` +
          `L ${rightAft.mx} ${rightAft.my} ` +
          `C ${rightAft.mx} ${tailTip.my - 10}, ${tailTip.mx + 12} ${tailTip.my}, ${tailTip.mx} ${tailTip.my} ` +
          `C ${tailTip.mx - 12} ${tailTip.my}, ${leftAft.mx} ${tailTip.my - 10}, ${leftAft.mx} ${leftAft.my} Z`,
        class: "map-fuselage",
      },
      svg,
    );

    // Cockpit divider.
    el("line", { x1: left.mx, y1: left.my, x2: right.mx, y2: right.my, class: "map-line" }, svg);

    // Galley block.
    {
      const a = pt(GALLEY.aabb.minX, GALLEY.aabb.minZ);
      const b = pt(GALLEY.aabb.maxX, GALLEY.aabb.maxZ);
      el("rect", {
        x: a.mx, y: a.my,
        width: b.mx - a.mx, height: b.my - a.my,
        rx: 4, class: "map-block",
      }, svg);
      const t = el("text", {
        x: (a.mx + b.mx) / 2, y: (a.my + b.my) / 2 + 3,
        class: "map-block-label", "text-anchor": "middle",
      }, svg);
      t.textContent = "GALLEY";
    }

    // Aft galley block and the enclosed lavatory module.
    {
      const ga = pt(AFT_GALLEY.aabb.minX, AFT_GALLEY.aabb.minZ);
      const gb = pt(AFT_GALLEY.aabb.maxX, AFT_GALLEY.aabb.maxZ);
      el("rect", {
        x: ga.mx, y: ga.my,
        width: gb.mx - ga.mx, height: gb.my - ga.my,
        rx: 4, class: "map-block",
      }, svg);
      const gt = el("text", {
        x: (ga.mx + gb.mx) / 2, y: (ga.my + gb.my) / 2 + 3,
        class: "map-block-label", "text-anchor": "middle",
      }, svg);
      gt.textContent = "GALLEY";

      const lavG = el("g", { class: "map-loc map-lav", "data-loc": LAVATORY.id }, svg);
      const la = pt(LAVATORY.minX, LAVATORY.frontZ);
      const lb = pt(LAVATORY.maxX, LAVATORY.backZ);
      el("rect", {
        x: la.mx, y: la.my,
        width: lb.mx - la.mx, height: lb.my - la.my,
        rx: 5, class: "map-lav-rect",
      }, lavG);
      const lt = el("text", {
        x: (la.mx + lb.mx) / 2, y: (la.my + lb.my) / 2 + 3,
        class: "map-lav-label", "text-anchor": "middle",
      }, lavG);
      lt.textContent = "WC";
    }

    // Exits.
    for (const exit of EXITS) {
      const edge = pt((exit.side === "port" ? -1 : 1) * HALF_W, exit.z);
      const off = exit.side === "port" ? -16 : 16;
      const g = el("g", { class: "map-exit" }, svg);
      el("rect", {
        x: edge.mx + (exit.side === "port" ? -6 : 2), y: edge.my - 10,
        width: 4, height: 20, rx: 2, class: "map-exit-bar",
      }, g);
      const t = el("text", {
        x: edge.mx + off, y: edge.my + 3,
        class: "map-exit-label",
        "text-anchor": exit.side === "port" ? "end" : "start",
      }, g);
      t.textContent = exit.type === "door" ? "DOOR" : "EXIT";
    }

    // Seats.
    for (const seat of SEATS) {
      const c = pt(seat.pos[0], seat.pos[2]);
      const g = el("g", { class: "map-loc map-seat map-seat-passenger", "data-loc": seat.id }, svg);
      el("rect", { x: c.mx - 8.5, y: c.my - 8.5, width: 17, height: 17, rx: 4 }, g);
      const t = el("text", { x: c.mx, y: c.my + 3, "text-anchor": "middle", class: "map-seat-label" }, g);
      t.textContent = seat.id;
    }

    // Current position marker.
    this.marker = el("circle", { r: 6, class: "map-marker", visibility: "hidden" }, svg);

    // Readout under the map: what the pointer is over, or the legend when it
    // is over nothing. One row doing two jobs keeps the panel compact.
    const footer = document.createElement("div");
    footer.className = "map-footer";
    this.container.appendChild(footer);

    this.legend = document.createElement("div");
    this.legend.className = "map-legend";
    for (const [cls, label] of [
      ["is-seat", "Seat"],
      ["is-exit", "Exit"],
      ["is-room", "Lav / galley"],
      ["is-here", "You"],
    ] as const) {
      const item = document.createElement("span");
      item.className = "map-legend-item";
      item.innerHTML = `<i class="map-swatch ${cls}"></i>${label}`;
      this.legend.appendChild(item);
    }
    footer.appendChild(this.legend);

    this.detail = document.createElement("div");
    this.detail.className = "map-detail";
    this.detail.hidden = true;
    footer.appendChild(this.detail);

    const zoom = document.createElement("div");
    zoom.className = "map-zoom";
    const zoomBtn = (label: string, tip: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.className = "map-zoom-btn";
      b.innerHTML = label;
      b.title = tip;
      b.setAttribute("aria-label", tip);
      b.addEventListener("click", onClick);
      zoom.appendChild(b);
    };
    zoomBtn(
      `<svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg>`,
      "Zoom out",
      () => this.zoomBy(1 / 1.45),
    );
    zoomBtn(
      `<svg viewBox="0 0 16 16"><path d="M4 8h8M8 4v8"/></svg>`,
      "Zoom in",
      () => this.zoomBy(1.45),
    );
    zoomBtn(
      `<svg viewBox="0 0 16 16"><path d="M12.6 6.8A5 5 0 1 0 12 10.4M12.8 3.4v3.4h-3.4"/></svg>`,
      "Fit whole cabin",
      () => this.resetView(),
    );
    this.container.appendChild(zoom);

    this.wireZoomPan(svg);
    this.wireHover(svg);
    this.update();
  }

  /** Zooms about the map's center, for the buttons rather than the wheel. */
  private zoomBy(factor: number) {
    const v = this.view;
    const scale = this.base.w / v.w;
    const next = Math.min(8, Math.max(1, scale * factor));
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    v.w = this.base.w / next;
    v.h = this.base.h / next;
    v.x = cx - v.w / 2;
    v.y = cy - v.h / 2;
    this.clampView();
    this.applyView(this.svg);
  }

  private resetView() {
    this.view = { x: 0, y: 0, w: this.base.w, h: this.base.h };
    this.applyView(this.svg);
  }

  /**
   * Describes whatever the pointer is over. Seats get the facts you actually
   * choose a seat on: where in the row it sits, and whether it is up against
   * an exit row or the bulkhead.
   */
  private wireHover(svg: SVGSVGElement) {
    const describe = (id: string) => {
      if (id === LAVATORY.id) return "Lavatory · aft starboard";
      const seat = SEATS.find((s) => s.id === id);
      if (!seat) return id;
      const letter = id.slice(-1);
      const place =
        letter === "A" || letter === "E"
          ? "Window"
          : letter === "B" || letter === "D"
            ? "Aisle"
            : "Middle";
      const parts = [`Row ${seat.row}`, place];
      if (EXITS.some((e) => e.type === "overwing" && e.z === seat.pos[2])) {
        parts.push("Exit row");
      }
      if (seat.row === 1) parts.push("Bulkhead");
      return parts.join(" · ");
    };

    svg.addEventListener("pointermove", (e) => {
      const hit = (e.target as Element).closest("[data-loc]");
      const id = hit?.getAttribute("data-loc");
      if (!id) {
        this.detail.hidden = true;
        this.legend.hidden = false;
        return;
      }
      this.detail.innerHTML =
        `<b>${id}</b><span>${describe(id)}</span>`;
      this.detail.hidden = false;
      this.legend.hidden = true;
    });
    svg.addEventListener("pointerleave", () => {
      this.detail.hidden = true;
      this.legend.hidden = false;
    });
  }

  private applyView(svg: SVGSVGElement) {
    const v = this.view;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  /** Keeps the view window inside the map extent at the current zoom. */
  private clampView() {
    const v = this.view;
    v.x = Math.min(Math.max(v.x, 0), this.base.w - v.w);
    v.y = Math.min(Math.max(v.y, 0), this.base.h - v.h);
  }

  /**
   * Wheel zooms toward the cursor, pointer-drag pans, and a double-click
   * restores the full map. A drag past a few pixels suppresses the seat click
   * so panning never picks a seat by accident.
   */
  private wireZoomPan(svg: SVGSVGElement) {
    const MIN_SCALE = 1;
    const MAX_SCALE = 8;
    const DRAG_SLOP = 5;
    let dragging = false;
    let captured = false;
    let moved = 0;
    let startClient = { x: 0, y: 0 };
    let startView = { x: 0, y: 0 };
    let rect = new DOMRect();

    const svgPointAt = (clientX: number, clientY: number) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const p = svg.createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      return p.matrixTransform(ctm.inverse());
    };

    svg.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const anchor = svgPointAt(e.clientX, e.clientY);
        if (!anchor) return;
        const v = this.view;
        const step = Math.exp(e.deltaY * 0.0015);
        const scale = this.base.w / v.w;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale / step));
        const k = scale / next; // width multiplier
        // Keep the point under the cursor fixed while the window resizes.
        v.x = anchor.x - (anchor.x - v.x) * k;
        v.y = anchor.y - (anchor.y - v.y) * k;
        v.w *= k;
        v.h *= k;
        this.clampView();
        this.applyView(svg);
      },
      { passive: false },
    );

    svg.addEventListener("pointerdown", (e: PointerEvent) => {
      dragging = true;
      captured = false;
      moved = 0;
      startClient = { x: e.clientX, y: e.clientY };
      startView = { x: this.view.x, y: this.view.y };
      rect = svg.getBoundingClientRect();
    });

    svg.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startClient.x;
      const dy = e.clientY - startClient.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved <= DRAG_SLOP) return;
      if (!captured) {
        // Capture only once this is a real pan. Capturing on pointerdown
        // would retarget the following click to the svg and break seat picks.
        svg.setPointerCapture(e.pointerId);
        svg.classList.add("panning");
        captured = true;
      }
      this.view.x = startView.x - (dx * this.view.w) / rect.width;
      this.view.y = startView.y - (dy * this.view.h) / rect.height;
      this.clampView();
      this.applyView(svg);
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (captured) {
        svg.releasePointerCapture(e.pointerId);
        svg.classList.remove("panning");
        captured = false;
      }
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);

    svg.addEventListener("dblclick", () => this.resetView());

    svg.addEventListener("click", (e) => {
      if (moved > DRAG_SLOP) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const target =
        (e.target as Element).closest("[data-loc]") ??
        hit?.closest("[data-loc]");
      if (!target) return;
      this.onPick(target.getAttribute("data-loc")!);
    });
  }

  update() {
    const s = this.state;
    // The overview is the landing view now, so the map is always a dismissable
    // panel over it rather than a fullscreen gate.
    this.container.classList.toggle("hidden", !s.mapOpen);
    this.container.classList.add("docked");
    this.title.textContent = s.menuOpen ? "Pick your seat" : "Cabin plan";
    this.selection.textContent = s.location || "No seat selected";
    this.selection.classList.toggle("is-empty", !s.location);

    if (s.locationId) {
      const seatOrLav =
        s.locationId === LAVATORY.id
          ? { x: LAVATORY.standPoint[0], z: LAVATORY.standPoint[2] }
          : (() => {
              const seat = SEATS.find((x) => x.id === s.locationId);
              return seat ? { x: seat.pos[0], z: seat.pos[2] } : null;
            })();
      if (seatOrLav) {
        const c = pt(seatOrLav.x, seatOrLav.z);
        this.marker.setAttribute("cx", String(c.mx));
        this.marker.setAttribute("cy", String(c.my));
        this.marker.setAttribute("visibility", "visible");
      }
    } else {
      this.marker.setAttribute("visibility", "hidden");
    }
  }
}
