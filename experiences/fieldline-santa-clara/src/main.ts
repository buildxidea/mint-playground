import "./ui/styles.css";
import * as THREE from "three";
import { EVENT_CONFIGS, type EventConfigId } from "./app/eventConfigs";
import { SoundBed } from "./audio/SoundBed";
import { CameraRig } from "./camera/CameraRig";
import {
  SEAT_PERSPECTIVES,
  perspectiveCountForAnchors,
  type SeatPerspectiveId,
  type SeatedLookMode,
} from "./camera/seatOccupantRig";
import { createSeatedEyePosition } from "./camera/seatedEye";
import {
  REFERENCE_CAMERAS,
  REFERENCE_CAMERA_IDS,
  type ReferenceCameraId,
} from "./calibration/referenceCameras";
import { LiveVenueStore } from "./live/LiveVenueStore";
import {
  effectiveFreshness,
  type Freshness,
  type LiveEvent,
  type LiveVenueState,
} from "./live/contracts";
import { StadiumScene } from "./scene/StadiumScene";
import { configureBvhRaycasting } from "./scene/configureBvh";
import { buildCalibrationReport } from "./stadium/calibrateView";
import { generateModeledGeometry } from "./stadium/generateSectionGeometry";
import {
  assertP234SeatInvariants,
  buildSeatInstances,
  type RowPreviewInstance,
  type SeatInstance,
} from "./stadium/generateSeatInstances";
import { loadVenueData, type DataQualityReport } from "./stadium/loadVenueData";
import { computeShadeReport, zonedLocalToUtc, type ShadeReport } from "./stadium/shadeEngine";
import { SightlineClient } from "./stadium/SightlineClient";
import {
  computeSightlineMetrics,
  HEIGHT_PRESET_OFFSET_M,
  type FocusTarget,
  type HeightPreset,
  type SightlineMetrics,
} from "./stadium/sightlineEngine";
import type { ModeledGeometryManifest, VerifiedMvpData } from "./stadium/schema";
import {
  buildSeatExplorerCatalog,
  findExplorerAnchorById,
  findExplorerRow,
  findExplorerSeat,
  findExplorerSection,
  type SeatExplorerCatalog,
} from "./stadium/seatExplorerCatalog";
import { auditSeatExplorerViewMatrix } from "./stadium/seatExplorerQa";
import { buildViewInventory, findView } from "./stadium/viewInventory";
import { buildPurchaseAction } from "./tickets/purchaseAction";
import { Hud, type SelectionState } from "./ui/Hud";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("Fieldline application root is missing");
const app: HTMLDivElement = appElement;

configureBvhRaycasting();

const loading = document.createElement("div");
loading.className = "loading";
loading.textContent = "Assembling the object stadium…";
app.appendChild(loading);

type SelectionPose = { surface: THREE.Vector3; yaw: number };
type ComparisonItem = {
  selection: SelectionState;
  label: string;
  metrics: SightlineMetrics;
  shade: ShadeReport | null;
};

async function bootstrap(): Promise<void> {
  const { data, report } = await loadVenueData();
  const geometry = generateModeledGeometry(data);
  const explorerCatalog = buildSeatExplorerCatalog(data, geometry);
  const generated = buildSeatInstances(data, geometry, { includeDevDensitySamples: false });
  assertP234SeatInvariants(generated.seats);

  const canvas = document.createElement("canvas");
  canvas.className = "stadium-canvas";
  canvas.setAttribute("aria-label", "Interactive modeled stadium view");
  app.appendChild(canvas);

  const query = new URLSearchParams(location.search);
  const qaMode = query.has("qa");
  const mobile = window.matchMedia("(max-width: 780px)").matches;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    powerPreference: "high-performance",
    preserveDrawingBuffer: qaMode,
  });
  renderer.setPixelRatio(qaMode ? 1 : Math.min(window.devicePixelRatio, mobile ? 1.35 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const stadium = new StadiumScene(renderer);
  await stadium.build(geometry, generated.seats, generated.rowPreviews, {
    crowdStride: mobile ? 4 : 2,
    mobileQuality: mobile,
    explorerCatalog,
  });
  const cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
  cameraRig.setGeometry(geometry);
  const sounds = new SoundBed();
  const sightlineClient = new SightlineClient();

  startApplication({
    data,
    report,
    geometry,
    explorerCatalog,
    seats: generated.seats,
    rowPreviews: generated.rowPreviews,
    stadium,
    cameraRig,
    renderer,
    canvas,
    sounds,
    sightlineClient,
    qaMode,
  });
  loading.remove();
}

function startApplication(context: {
  data: VerifiedMvpData;
  report: DataQualityReport;
  geometry: ModeledGeometryManifest;
  explorerCatalog: SeatExplorerCatalog;
  seats: SeatInstance[];
  rowPreviews: RowPreviewInstance[];
  stadium: StadiumScene;
  cameraRig: CameraRig;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  sounds: SoundBed;
  sightlineClient: SightlineClient;
  qaMode: boolean;
}): void {
  const {
    data,
    report,
    geometry,
    explorerCatalog,
    seats,
    rowPreviews,
    stadium,
    cameraRig,
    renderer,
    canvas,
    sounds,
    sightlineClient,
    qaMode,
  } = context;

  let selection: SelectionState = {
    sectionId: "P234",
    rowLabel: "7",
    seatNumber: 8,
    positionIndex: 8,
  };
  let focus: FocusTarget = "midfield";
  let heightPreset: HeightPreset = "average";
  let eventConfigId: EventConfigId = "football";
  let crowdPercentile = 50;
  let showHeatmap = false;
  let suiteTowerVisible = true;
  let minutesFromKickoff = 0;
  let eventDate = "2026-09-13";
  let kickoffLocal = "13:25";
  let selectedLiveEventId: string | null = null;
  let eventTimeOfficial = false;
  let liveEvents = new Map<string, LiveEvent>();
  let latestLiveState: LiveVenueState = { phase: "idle", snapshot: null, error: null };
  let appliedInitialLiveEvent = false;
  let latestMetrics: SightlineMetrics | null = null;
  let latestShade: ShadeReport | null = null;
  let analysisVersion = 0;
  let screenshotPaused = false;
  const freezeForInspector = new URLSearchParams(location.search).has("freeze");
  const comparison: ComparisonItem[] = [];
  const viewInventory = buildViewInventory(data, geometry);
  let activePerspective: SeatPerspectiveId = "midfield";
  let activeLookMode: SeatedLookMode = "natural";
  let activeViewId = "seat:P234:7:8";
  const weights: Record<string, number> = {
    closeness: 50,
    centered: 50,
    field: 65,
    boards: 35,
    shade: 55,
    aisle: 20,
    premium: 30,
  };

  const hud = new Hud(app!, {
    onSelectSection: (sectionId) => {
      const section = data.sections.find((item) => item.sectionId === sectionId);
      chooseSelection({
        sectionId,
        rowLabel: section?.rows[0]?.rowLabel ?? null,
        seatNumber: null,
        positionIndex: null,
      });
    },
    onSelectRow: (rowLabel) => chooseSelection({
      ...selection,
      rowLabel,
      seatNumber: null,
      positionIndex: null,
    }),
    onSelectSeat: (seatNumber) => chooseSelection({
      ...selection,
      seatNumber,
      positionIndex: seatNumber,
    }),
    onExploreOverview: () => exploreOverview(),
    onExploreSection: (sectionId) => exploreSection(sectionId),
    onExploreRow: (sectionId, rowLabel) => exploreRow(sectionId, rowLabel),
    onExploreSeat: (sectionId, rowLabel, positionIndex, seatNumber) =>
      exploreSeat(sectionId, rowLabel, positionIndex, seatNumber),
    onEnterSeated: () => flyToSelection(),
    onOverview: () => {
      cameraRig.returnToOverview();
      stadium.clearSeatedContext();
      hud.showExplorerStadium();
    },
    onFocus: (value) => {
      focus = value;
      void recompute();
      void refreshComparison();
    },
    onHeight: (value) => {
      heightPreset = value;
      cameraRig.setHeightPreset(value);
      void recompute();
      void refreshComparison();
    },
    onEventConfig: (value) => {
      eventConfigId = value;
      stadium.setEventConfig(value);
      hud.syncEventSource(selectedLiveEventId, eventConfigId, eventTimeOfficial);
      void recompute();
      void refreshComparison();
    },
    onLiveEvent: (id) => {
      if (id) applyLiveEvent(id);
      else clearLiveEventSelection();
    },
    onEventDate: (value) => {
      eventDate = value;
      selectedLiveEventId = null;
      eventTimeOfficial = false;
      hud.syncEventSource(null, eventConfigId, false);
      syncPurchaseAction();
      void recompute();
      void refreshComparison();
    },
    onKickoffTime: (value) => {
      kickoffLocal = value;
      eventTimeOfficial = false;
      hud.syncEventSource(selectedLiveEventId, eventConfigId, false);
      void recompute();
      void refreshComparison();
    },
    onTimeScrub: (value) => {
      minutesFromKickoff = value;
      updateSun();
    },
    onCrowd: (value) => {
      crowdPercentile = value;
      stadium.setCrowdPercentile(value);
      void recompute();
      void refreshComparison();
    },
    onToggleTier: (tier, visible) => stadium.setTierVisible(tier, visible),
    onToggleTower: (visible) => {
      suiteTowerVisible = visible;
      stadium.setSuiteTowerVisible(visible);
      void recompute();
      void refreshComparison();
    },
    onToggleValidation: (visible) => {
      stadium.setValidationVisible(visible, geometry);
      stadium.setSeatRigDebugVisible(visible);
    },
    onToggleHeatmap: (visible) => {
      showHeatmap = visible;
      stadium.setHeatmap(latestMetrics?.fieldHits ?? [], visible);
    },
    onAddCompare: () => {
      if (!latestMetrics) return;
      const key = formatSelection(selection);
      const existing = comparison.findIndex((item) => item.label === key);
      const item: ComparisonItem = {
        selection: { ...selection },
        label: key,
        metrics: latestMetrics,
        shade: latestShade,
      };
      if (existing >= 0) comparison.splice(existing, 1, item);
      else {
        if (comparison.length === 3) comparison.shift();
        comparison.push(item);
      }
      renderComparison();
    },
    onRemoveCompare: (index) => {
      comparison.splice(index, 1);
      renderComparison();
    },
    onResetLook: () => {
      cameraRig.resetSeatedForward();
      activePerspective = "authentic-forward";
      hud.syncSeatViewControls(activePerspective, activeLookMode);
      syncShareableViewUrl();
    },
    onResetPose: () => {
      cameraRig.resetSeatedPose();
      activePerspective = "authentic-forward";
      activeLookMode = "natural";
      hud.syncSeatViewControls(activePerspective, activeLookMode);
    },
    onInspectSeat: () => {
      activePerspective = "authentic-forward";
      activeLookMode = "free";
      cameraRig.setSeatedPerspective(activePerspective);
      cameraRig.setLookMode(activeLookMode);
      cameraRig.setLookOffsetsDegrees(90, -20);
      hud.syncSeatViewControls(activePerspective, activeLookMode);
      syncShareableViewUrl();
    },
    onLookMode: (mode) => {
      activeLookMode = mode;
      cameraRig.setLookMode(mode);
      syncShareableViewUrl();
    },
    onViewPerspective: (id) => {
      activePerspective = id;
      cameraRig.setSeatedPerspective(id);
      syncShareableViewUrl();
    },
    onLean: (lateralM, forwardM, verticalM) => {
      cameraRig.moveLean(lateralM, forwardM, verticalM);
    },
    onOpenView: (viewId, perspective) => {
      void openInventoryView(viewId, perspective, eventConfigId);
    },
    onNavigateView: (delta, perspective) => {
      const currentIndex = Math.max(0, viewInventory.views.findIndex((view) => view.id === activeViewId));
      const nextIndex = (currentIndex + delta + viewInventory.views.length) % viewInventory.views.length;
      const next = viewInventory.views[nextIndex];
      if (next) void openInventoryView(next.id, perspective, eventConfigId);
    },
    onTourView: (id) => {
      stadium.clearSeatedContext();
      cameraRig.setReferenceView(id);
      syncShareableViewUrl(id);
    },
    onPointerLock: () => {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      else void canvas.requestPointerLock();
    },
    onToggleAudio: (enabled) => {
      sounds.unlock();
      sounds.setEnabled(enabled);
    },
    onWeightChange: (key, value) => {
      weights[key] = value;
      renderComparison();
    },
  });

  hud.setData(data, report, geometry);
  hud.setViewInventory(viewInventory);
  hud.setExplorerCatalog(explorerCatalog);
  hud.syncSeatViewControls(activePerspective, activeLookMode);
  hud.syncSelection(selection);
  hud.syncEventSource(null, eventConfigId, false);
  syncPurchaseAction();
  stadium.setSelection("P234", "7", 8);

  const liveEndpoint = import.meta.env.VITE_FIELDLINE_LIVE_ENDPOINT?.trim();
  const liveStore = new LiveVenueStore({
    endpoint: liveEndpoint || null,
    qaMode,
  });
  const unsubscribeLive = liveStore.subscribe((state) => {
    const previousSelectedId = selectedLiveEventId;
    latestLiveState = state;
    hud.renderLiveState(state);
    const events = (state.snapshot?.events.value ?? []) as LiveEvent[];
    liveEvents = new Map(events.map((event) => [event.id, event]));
    if (!appliedInitialLiveEvent && events.length > 0) {
      const next = events.find((event) => event.status === "scheduled" || event.status === "rescheduled") ?? events[0];
      if (next) {
        appliedInitialLiveEvent = true;
        applyLiveEvent(next.id);
      }
    } else if (previousSelectedId && !liveEvents.has(previousSelectedId)) {
      const next = events.find((event) => event.status === "scheduled" || event.status === "rescheduled") ?? events[0];
      if (next) applyLiveEvent(next.id);
      else clearLiveEventSelection();
    } else {
      hud.syncEventSource(selectedLiveEventId, eventConfigId, eventTimeOfficial);
      syncPurchaseAction();
    }
  });
  liveStore.start();

  function applyLiveEvent(id: string): void {
    const event = liveEvents.get(id);
    if (!event) return;
    selectedLiveEventId = event.id;
    eventDate = event.localDate;
    if (event.localTime) {
      kickoffLocal = event.localTime;
      eventTimeOfficial = true;
    } else {
      eventTimeOfficial = false;
    }
    if (event.eventConfigHint) {
      eventConfigId = event.eventConfigHint;
      stadium.setEventConfig(eventConfigId);
    }
    minutesFromKickoff = 0;
    hud.syncEventTime(eventDate, kickoffLocal, minutesFromKickoff);
    hud.syncEventSource(selectedLiveEventId, eventConfigId, eventTimeOfficial);
    syncPurchaseAction();
    void recompute();
    void refreshComparison();
  }

  function clearLiveEventSelection(): void {
    selectedLiveEventId = null;
    eventTimeOfficial = false;
    hud.syncEventSource(null, eventConfigId, false);
    syncPurchaseAction();
  }

  function currentEventFreshness(): Freshness {
    if (latestLiveState.phase === "static") return "static";
    const events = latestLiveState.snapshot?.events;
    return events
      ? effectiveFreshness(events.freshness, events.expiresAt)
      : "unknown";
  }

  function syncPurchaseAction(): void {
    const liveEvent = selectedLiveEventId ? liveEvents.get(selectedLiveEventId) ?? null : null;
    hud.syncPurchaseAction(buildPurchaseAction(
      liveEvent,
      {
        label: formatSelection(selection),
        exactSeatIdentifier: selection.seatNumber != null,
      },
      currentEventFreshness(),
    ));
  }

  function poseFor(targetSelection: SelectionState): SelectionPose | null {
    if (!targetSelection.sectionId || !targetSelection.rowLabel) return null;
    const positionIndex = targetSelection.positionIndex ?? targetSelection.seatNumber;
    if (positionIndex != null) {
      const explorerSeat = findExplorerSeat(
        explorerCatalog,
        targetSelection.sectionId,
        targetSelection.rowLabel,
        positionIndex,
      );
      if (explorerSeat) {
        return {
          surface: new THREE.Vector3(...explorerSeat.position),
          yaw: explorerSeat.yawRad,
        };
      }
    }
    if (targetSelection.seatNumber != null) {
      const seat = seats.find(
        (item) =>
          item.selectable &&
          item.sectionId === targetSelection.sectionId &&
          item.rowLabel === targetSelection.rowLabel &&
          item.seatNumber === targetSelection.seatNumber,
      );
      if (seat) return { surface: seat.position.clone(), yaw: seat.yawRad };
    }
    const row = rowPreviews.find(
      (item) =>
        item.sectionId === targetSelection.sectionId &&
        item.rowLabel === targetSelection.rowLabel,
    );
    if (row) return { surface: row.position.clone(), yaw: row.yawRad };
    const explorerRow = findExplorerRow(
      explorerCatalog,
      targetSelection.sectionId,
      targetSelection.rowLabel,
    );
    return explorerRow
      ? { surface: new THREE.Vector3(...explorerRow.position), yaw: explorerRow.yawRad }
      : null;
  }

  function viewIdForSelection(targetSelection: SelectionState): string | null {
    if (!targetSelection.sectionId || !targetSelection.rowLabel) return null;
    if (targetSelection.seatNumber != null) {
      return `seat:${targetSelection.sectionId}:${targetSelection.rowLabel}:${targetSelection.seatNumber}`;
    }
    if (targetSelection.positionIndex != null) {
      return `position:${targetSelection.sectionId}:${targetSelection.rowLabel}:${targetSelection.positionIndex}`;
    }
    return `row:${targetSelection.sectionId}:${targetSelection.rowLabel}`;
  }

  function viewTruthLabelFor(targetSelection: SelectionState): string {
    if (targetSelection.seatNumber != null) {
      return "Exact supplied identifier · modeled XYZ. The selected chair object is tied to this identifier; physical XYZ position, spacing, aisle offsets, and camera remain modeled.";
    }
    if (targetSelection.positionIndex != null) {
      return "Visible, selectable chair object · modeled anonymous position. Its section is official-public, but this row/position is not presented as an exact ticket identifier; XYZ and camera placement remain modeled.";
    }
    const row = targetSelection.sectionId && targetSelection.rowLabel
      ? findExplorerRow(explorerCatalog, targetSelection.sectionId, targetSelection.rowLabel)
      : null;
    return row?.isAda
      ? "ADA row center · individual wheelchair and companion position unavailable. No regular chair is inferred at the camera."
      : row?.identifierStatus === "provided-source"
        ? "Individual seat count is unknown. The row identifier comes from the supplied source pack; the row-center camera is modeled. A representative chair is shown without inventing a seat identifier."
        : "Official-public section · modeled anonymous row center. Row numbering, chair count, physical XYZ, and camera remain modeled and are not presented as ticket inventory.";
  }

  function seatedContextKindFor(targetSelection: SelectionState):
    "exact-seat" | "representative-row-seat" | "ada-row-center" {
    if (targetSelection.seatNumber != null) return "exact-seat";
    const row = targetSelection.sectionId && targetSelection.rowLabel
      ? findExplorerRow(explorerCatalog, targetSelection.sectionId, targetSelection.rowLabel)
      : null;
    return row?.isAda ? "ada-row-center" : "representative-row-seat";
  }

  function applySelection(
    next: SelectionState,
    fly = false,
    explorerLevel?: "stadium" | "section" | "row",
  ): void {
    selection = next;
    activeViewId = viewIdForSelection(selection) ?? activeViewId;
    hud.syncSelection(selection, explorerLevel);
    syncPurchaseAction();
    if (selection.sectionId) {
      stadium.setSelection(
        selection.sectionId,
        selection.rowLabel,
        selection.seatNumber,
        selection.positionIndex ?? selection.seatNumber,
      );
    }
    if (fly) flyToSelection();
    void recompute();
  }

  function chooseSelection(next: SelectionState): void {
    if (cameraRig.mode === "seated") {
      cameraRig.returnToOverview();
      stadium.clearSeatedContext();
    }
    applySelection(next);
  }

  function leaveSeatedForExplorer(): void {
    if (cameraRig.mode === "seated") {
      cameraRig.returnToOverview();
      stadium.clearSeatedContext();
    }
  }

  function exploreOverview(): void {
    cameraRig.returnToOverview();
    stadium.clearSeatedContext();
    hud.showExplorerStadium();
  }

  function exploreSection(sectionId: string): void {
    const section = findExplorerSection(explorerCatalog, sectionId);
    const row = section?.rows[Math.floor((section.rows.length - 1) / 2)];
    if (!section || !row) return;
    leaveSeatedForExplorer();
    applySelection({
      sectionId,
      rowLabel: row.rowLabel,
      seatNumber: null,
      positionIndex: null,
    }, false, "section");
    cameraRig.frameExplorerAnchor(new THREE.Vector3(...row.position), "section");
  }

  function exploreRow(sectionId: string, rowLabel: string): void {
    const row = findExplorerRow(explorerCatalog, sectionId, rowLabel);
    if (!row) return;
    leaveSeatedForExplorer();
    applySelection(
      { sectionId, rowLabel, seatNumber: null, positionIndex: null },
      false,
      "row",
    );
    cameraRig.frameExplorerAnchor(new THREE.Vector3(...row.position), "row");
  }

  function exploreSeat(
    sectionId: string,
    rowLabel: string,
    positionIndex: number,
    seatNumber: number | null,
  ): void {
    const seat = findExplorerSeat(explorerCatalog, sectionId, rowLabel, positionIndex);
    if (!seat) return;
    leaveSeatedForExplorer();
    applySelection({ sectionId, rowLabel, seatNumber, positionIndex }, false, "row");
    cameraRig.frameExplorerAnchor(new THREE.Vector3(...seat.position), "seat");
  }

  function flyToSelection(): void {
    const pose = poseFor(selection);
    if (!pose || pose.surface.y < 0.2 || !selection.sectionId || !selection.rowLabel) return;
    sounds.unlock();
    sounds.playCameraMove();
    stadium.setSeatedContext({
      kind: seatedContextKindFor(selection),
      sectionId: selection.sectionId,
      rowLabel: selection.rowLabel,
      seatNumber: selection.seatNumber,
      anchor: pose.surface,
      yawRad: pose.yaw,
    });
    cameraRig.flyToSeat(pose.surface, pose.yaw);
    cameraRig.setLookMode(activeLookMode);
    cameraRig.setSeatedPerspective(activePerspective);
    hud.syncSeatViewControls(activePerspective, activeLookMode);
    syncShareableViewUrl();
  }

  async function openInventoryView(
    viewId: string,
    perspective: SeatPerspectiveId,
    nextEventConfig: EventConfigId,
  ): Promise<void> {
    const view = findView(viewInventory, viewId);
    if (!view) throw new Error(`Unknown supported view: ${viewId}`);
    activeViewId = view.id;
    activePerspective = perspective;
    eventConfigId = nextEventConfig;
    stadium.setEventConfig(nextEventConfig);
    applySelection({
      sectionId: view.sectionId,
      rowLabel: view.rowLabel,
      seatNumber: view.seatNumber,
      positionIndex: view.seatNumber,
    });
    flyToSelection();
    cameraRig.update(2);
    cameraRig.setSeatedPerspective(perspective);
    await recompute();
    syncShareableViewUrl();
  }

  async function openExplorerView(
    anchorId: string,
    perspective: SeatPerspectiveId,
    nextEventConfig: EventConfigId,
  ): Promise<void> {
    const anchor = findExplorerAnchorById(explorerCatalog, anchorId);
    if (!anchor) throw new Error(`Unknown explorer anchor: ${anchorId}`);
    activeViewId = anchor.id;
    activePerspective = perspective;
    eventConfigId = nextEventConfig;
    stadium.setEventConfig(nextEventConfig);
    if ("positionIndex" in anchor) {
      applySelection({
        sectionId: anchor.sectionId,
        rowLabel: anchor.rowLabel,
        seatNumber: anchor.seatNumber,
        positionIndex: anchor.positionIndex,
      }, false, "row");
    } else {
      applySelection({
        sectionId: anchor.sectionId,
        rowLabel: anchor.rowLabel,
        seatNumber: null,
        positionIndex: null,
      }, false, "row");
    }
    flyToSelection();
    cameraRig.update(2);
    cameraRig.setSeatedPerspective(perspective);
    await recompute();
    syncShareableViewUrl();
  }

  function syncShareableViewUrl(tourId?: ReferenceCameraId): void {
    if (qaMode) return;
    const url = new URL(location.href);
    if (tourId) {
      url.searchParams.delete("view");
      url.searchParams.delete("perspective");
      url.searchParams.set("tour", tourId);
    } else {
      url.searchParams.delete("tour");
      url.searchParams.set("view", activeViewId);
      url.searchParams.set("perspective", activePerspective);
      url.searchParams.set("look", activeLookMode);
    }
    history.replaceState(null, "", url);
  }

  function shadeFor(targetSelection: SelectionState): ShadeReport | null {
    const pose = poseFor(targetSelection);
    if (!pose) return null;
    const activeOccluders = geometry.occluders.filter(
      (occluder) => suiteTowerVisible || occluder.category !== "suite-tower",
    );
    return computeShadeReport({
      latitude: data.stadium.latitude.value ?? 37.403,
      longitude: data.stadium.longitude.value ?? -121.9702,
      dateStr: eventDate,
      kickoffLocal,
      durationHours: EVENT_CONFIGS[eventConfigId].defaultDurationHours,
      seatX: pose.surface.x,
      seatY:
        pose.surface.y +
        geometry.eyeHeightM.value +
        HEIGHT_PRESET_OFFSET_M[heightPreset],
      seatZ: pose.surface.z,
      timeZone: data.stadium.timezone.value ?? "America/Los_Angeles",
      occluders: activeOccluders,
      suiteTowerVisible,
    });
  }

  function workerArgsFor(targetSelection: SelectionState) {
    const pose = poseFor(targetSelection);
    if (!pose) return null;
    return {
      geometry,
      eye: createSeatedEyePosition(
        pose.surface,
        pose.yaw,
        geometry.eyeHeightM.value,
      ),
      focus,
      heightPreset,
      crowdPercentile,
      sampleDensity: window.innerWidth < 780 ? 9 : 14,
      eventConfigId,
      selectionKey: formatSelection(targetSelection),
      sectionId: targetSelection.sectionId ?? undefined,
      activeOccluderCategories: EVENT_CONFIGS[eventConfigId].activeOccluderCategories,
    };
  }

  async function computeMetrics(targetSelection: SelectionState): Promise<SightlineMetrics | null> {
    const args = workerArgsFor(targetSelection);
    if (!args) return null;
    try {
      return await sightlineClient.compute(args);
    } catch (error) {
      console.warn("[fieldline] worker analysis fell back to the deterministic local engine", error);
      return computeSightlineMetrics(args);
    }
  }

  async function recompute(): Promise<void> {
    const version = ++analysisVersion;
    hud.setAnalysisBusy(true);
    const shade = shadeFor(selection);
    const metrics = await computeMetrics(selection);
    if (version !== analysisVersion) return;
    latestMetrics = metrics;
    latestShade = shade;
    const section = data.sections.find((item) => item.sectionId === selection.sectionId);
    hud.renderMetrics(
      selection,
      metrics,
      shade,
      Boolean(section?.seatCountVerified),
      viewTruthLabelFor(selection),
    );
    stadium.setHeatmap(metrics?.fieldHits ?? [], showHeatmap);
    const pose = poseFor(selection);
    if (metrics && pose) {
      stadium.setSightlineRays(
        createSeatedEyePosition(
          pose.surface,
          pose.yaw,
          geometry.eyeHeightM.value,
          HEIGHT_PRESET_OFFSET_M[heightPreset],
        ),
        metrics.fieldHits,
      );
    }
    hud.setAnalysisBusy(false);
    updateSun();
  }

  async function refreshComparison(): Promise<void> {
    if (!comparison.length) return;
    const updates = await Promise.all(
      comparison.map(async (item) => ({
        ...item,
        metrics: (await computeMetrics(item.selection)) ?? item.metrics,
        shade: shadeFor(item.selection),
      })),
    );
    comparison.splice(0, comparison.length, ...updates);
    renderComparison();
  }

  function renderComparison(): void {
    hud.renderCompare(
      comparison.map((item) => ({
        label: item.label,
        metrics: item.metrics,
        shade: item.shade,
        explanation: explainComparison(item.metrics, item.shade, weights),
        calibrationConfidence:
          geometry.sections.find((section) => section.sectionId === item.selection.sectionId)
            ?.calibration.confidence ?? 0,
      })),
      weights,
    );
  }

  function updateSun(): void {
    const shade = shadeFor(selection);
    if (!shade) return;
    const kickoff = zonedLocalToUtc(
      eventDate,
      kickoffLocal,
      data.stadium.timezone.value ?? "America/Los_Angeles",
    );
    const targetTime = kickoff.getTime() + minutesFromKickoff * 60_000;
    const sample = shade.timeline.reduce((nearest, candidate) =>
      Math.abs(new Date(candidate.timeIso).getTime() - targetTime) <
      Math.abs(new Date(nearest.timeIso).getTime() - targetTime)
        ? candidate
        : nearest,
    shade.kickoff);
    stadium.setSun(sample.altitudeDeg, sample.azimuthDeg, sample.sunAboveHorizon);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map<number, { x: number; y: number }>();
  let pointerMoved = false;
  let pointerGesture = false;
  const gestureCenter = new THREE.Vector2();
  let gestureDistance = 0;

  function gestureState(): { center: THREE.Vector2; distance: number } | null {
    const points = [...activePointers.values()];
    if (points.length < 2 || !points[0] || !points[1]) return null;
    const center = new THREE.Vector2(
      (points[0].x + points[1].x) / 2,
      (points[0].y + points[1].y) / 2,
    );
    return {
      center,
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 1) pointerMoved = false;
    canvas.setPointerCapture(event.pointerId);
    sounds.unlock();
    const gesture = gestureState();
    if (gesture) {
      pointerGesture = true;
      gestureCenter.copy(gesture.center);
      gestureDistance = gesture.distance;
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (document.pointerLockElement === canvas && cameraRig.mode === "seated") {
      cameraRig.look(event.movementX, event.movementY);
      return;
    }
    const previous = activePointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (Math.abs(dx) + Math.abs(dy) > 2) pointerMoved = true;
    const gesture = gestureState();
    if (gesture && cameraRig.mode === "seated") {
      const centerDx = gesture.center.x - gestureCenter.x;
      const centerDy = gesture.center.y - gestureCenter.y;
      cameraRig.moveLean(centerDx * 0.0025, -centerDy * 0.0018, 0);
      cameraRig.zoom((gestureDistance - gesture.distance) * 0.9);
      gestureCenter.copy(gesture.center);
      gestureDistance = gesture.distance;
      pointerGesture = true;
      return;
    }
    if (activePointers.size === 1) {
      if (cameraRig.mode === "overview") cameraRig.orbit(dx, dy);
      else cameraRig.look(dx, dy);
    }
  });
  const endPointer = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) return;
    const shouldPick = activePointers.size === 1 && !pointerMoved && !pointerGesture;
    activePointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (activePointers.size === 0) pointerGesture = false;
    if (!shouldPick) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, cameraRig.camera);
    const picked = stadium.pick(raycaster);
    if (picked?.rowLabel) {
      const positionIndex = picked.positionIndex ?? picked.seatNumber ?? null;
      if (positionIndex != null) {
        exploreSeat(
          picked.sectionId,
          picked.rowLabel,
          positionIndex,
          picked.seatNumber ?? null,
        );
      } else {
        exploreRow(picked.sectionId, picked.rowLabel);
      }
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) pointerGesture = false;
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    cameraRig.zoom(event.deltaY);
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, select, button, summary")) return;
    if (cameraRig.mode === "seated") {
      const lookSteps: Partial<Record<string, [number, number]>> = {
        ArrowLeft: [-14, 0],
        ArrowRight: [14, 0],
        ArrowUp: [0, -14],
        ArrowDown: [0, 14],
      };
      const leanSteps: Partial<Record<string, [number, number, number]>> = {
        a: [-0.035, 0, 0],
        d: [0.035, 0, 0],
        w: [0, 0.03, 0],
        s: [0, -0.03, 0],
        q: [0, 0, -0.025],
        e: [0, 0, 0.025],
      };
      const look = lookSteps[event.key];
      const lean = leanSteps[event.key.toLowerCase()];
      if (look) cameraRig.look(...look);
      else if (lean) cameraRig.moveLean(...lean);
      else if (event.key.toLowerCase() === "r") {
        cameraRig.resetSeatedPose();
        activePerspective = "authentic-forward";
        activeLookMode = "natural";
        hud.syncSeatViewControls(activePerspective, activeLookMode);
      } else if (event.key.toLowerCase() === "f") {
        activeLookMode = activeLookMode === "natural" ? "free" : "natural";
        cameraRig.setLookMode(activeLookMode);
        hud.syncSeatViewControls(activePerspective, activeLookMode);
      } else return;
      event.preventDefault();
      syncShareableViewUrl();
      return;
    }
    if (!selection.sectionId || !selection.rowLabel) return;
    const section = findExplorerSection(explorerCatalog, selection.sectionId);
    if (!section) return;
    const index = section.rows.findIndex((row) => row.rowLabel === selection.rowLabel);
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    const next = section.rows[index + delta];
    if (!next) return;
    event.preventDefault();
    applySelection({
      ...selection,
      rowLabel: next.rowLabel,
      seatNumber: null,
      positionIndex: null,
    }, true, "row");
  });

  window.addEventListener("resize", () => {
    const narrow = window.innerWidth < 780;
    cameraRig.camera.aspect = window.innerWidth / window.innerHeight;
    cameraRig.camera.updateProjectionMatrix();
    renderer.setPixelRatio(qaMode ? 1 : Math.min(window.devicePixelRatio, narrow ? 1.35 : 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const testHooks = {
    seed(_value: number) {
      // Scene generation is deterministic and does not consume random state.
    },
    async setState(name: string) {
      if (freezeForInspector) {
        screenshotPaused = false;
        window.setTimeout(() => {
          screenshotPaused = true;
        }, 1_500);
      }
      const states: Record<string, SelectionState> = {
        "p234-r7-s8": { sectionId: "P234", rowLabel: "7", seatNumber: 8 },
        "section-104-row-35": { sectionId: "104", rowLabel: "35", seatNumber: null },
        "section-101-row-1w": { sectionId: "101", rowLabel: "1W", seatNumber: null },
        "section-138vip-row-6": { sectionId: "138VIP", rowLabel: "6", seatNumber: null },
        "section-322-row-8": { sectionId: "322", rowLabel: "8", seatNumber: null },
        "section-421-row-28": { sectionId: "421", rowLabel: "28", seatNumber: null },
      };
      if (name.startsWith("view:")) {
        await this.setView(name.slice("view:".length));
        return;
      }
      if (name === "p234-seat-down-context") {
        await this.setView("seat:P234:7:8", "football", "authentic-forward");
        cameraRig.setLookOffsetsDegrees(0, -65);
        return;
      }
      if (name === "p234-seat-left-context") {
        await this.setView("seat:P234:7:8", "football", "left-context");
        return;
      }
      if (name === "p234-seat-back-context") {
        await this.setView("seat:P234:7:8", "football", "authentic-forward");
        activeLookMode = "free";
        cameraRig.setLookMode("free");
        cameraRig.setLookOffsetsDegrees(179, -55);
        hud.syncSeatViewControls(activePerspective, activeLookMode);
        return;
      }
      if (name === "row-104-representative-seat") {
        await this.setView("row:104:35", "football", "authentic-forward");
        cameraRig.setLookOffsetsDegrees(0, -65);
        return;
      }
      if (name === "ada-row-context") {
        await this.setView("row:101:1W", "football", "left-context");
        return;
      }
      if (name.startsWith("seat-matrix:")) {
        const [, sectionId, band] = name.split(":");
        const section = data.sections.find((item) => item.sectionId === sectionId);
        if (!section || !["front", "middle", "rear"].includes(band ?? "")) {
          throw new Error(`Unknown seat-matrix state: ${name}`);
        }
        const rowIndex = band === "front"
          ? 0
          : band === "rear"
            ? section.rows.length - 1
            : Math.floor((section.rows.length - 1) / 2);
        const row = section.rows[rowIndex]!;
        const seatNumber = section.seatIdentifierCoverage === "source-pack-complete" ? 10 : null;
        applySelection({ sectionId, rowLabel: row.rowLabel, seatNumber });
        flyToSelection();
        cameraRig.update(2);
        await recompute();
        return;
      }
      if (REFERENCE_CAMERA_IDS.includes(name as ReferenceCameraId)) {
        // Geometry comparisons use one deterministic neutral daylight state;
        // reference-camera changes must not inherit whichever event time ran first.
        kickoffLocal = "13:25";
        minutesFromKickoff = 0;
        hud.syncEventTime(eventDate, kickoffLocal, minutesFromKickoff);
        stadium.clearSeatedContext();
        cameraRig.setReferenceView(name as ReferenceCameraId);
        await recompute();
        return;
      }
      if (name === "overview") {
        stadium.clearSeatedContext();
        cameraRig.returnToOverview();
        return;
      }
      if (name === "selected-section") {
        comparison.splice(0, comparison.length);
        renderComparison();
        applySelection({ sectionId: "P234", rowLabel: "7", seatNumber: 8 });
        cameraRig.returnToOverview();
        await recompute();
        return;
      }
      if (name === "day") {
        comparison.splice(0, comparison.length);
        renderComparison();
        kickoffLocal = "13:25";
        minutesFromKickoff = 0;
        hud.syncEventTime(eventDate, kickoffLocal, minutesFromKickoff);
        cameraRig.returnToOverview();
        await recompute();
        return;
      }
      if (name === "night") {
        comparison.splice(0, comparison.length);
        renderComparison();
        kickoffLocal = "20:00";
        minutesFromKickoff = 60;
        hud.syncEventTime(eventDate, kickoffLocal, minutesFromKickoff);
        cameraRig.returnToOverview();
        await recompute();
        return;
      }
      const state = states[name];
      if (state) {
        applySelection(state);
        flyToSelection();
        cameraRig.update(2);
        await recompute();
      }
      if (name === "comparison") {
        cameraRig.returnToOverview();
        comparison.splice(0, comparison.length);
        for (const stateName of ["p234-r7-s8", "section-104-row-35", "section-421-row-28"]) {
          const compareSelection = states[stateName]!;
          const metrics = await computeMetrics(compareSelection);
          if (!metrics) continue;
          comparison.push({
            selection: compareSelection,
            label: formatSelection(compareSelection),
            metrics,
            shade: shadeFor(compareSelection),
          });
        }
        renderComparison();
      }
    },
    setPausedForScreenshot(paused: boolean) {
      screenshotPaused = paused;
    },
    setReducedMotion(enabled: boolean) {
      document.documentElement.classList.toggle("reduced-motion", enabled);
    },
    hideDebugUi(hidden: boolean) {
      stadium.setValidationVisible(!hidden, geometry);
    },
    waitForAssets() {
      return stadium.awaitAssets();
    },
    listViews() {
      return viewInventory.views.map((view) => ({
        id: view.id,
        kind: view.kind,
        sectionId: view.sectionId,
        rowLabel: view.rowLabel,
        seatNumber: view.seatNumber,
        placementStatus: view.placementStatus,
      }));
    },
    listExplorerSections() {
      return explorerCatalog.sections.map((section) => ({
        sectionId: section.sectionId,
        displayName: section.displayName,
        tier: section.tier,
        rowCount: section.rows.length,
        chairCount: section.rows.reduce((count, row) => count + row.seats.length, 0),
      }));
    },
    listExplorerAnchors() {
      return explorerCatalog.sections.flatMap((section) => section.rows.flatMap((row) => [
        {
          id: row.id,
          kind: row.isAda ? "ada-row-center" : "row-center",
          sectionId: row.sectionId,
          rowLabel: row.rowLabel,
          positionIndex: null,
          seatNumber: null,
        },
        ...row.seats.map((seat) => ({
          id: seat.id,
          kind: seat.seatNumber == null ? "modeled-seat-position" : "exact-seat",
          sectionId: seat.sectionId,
          rowLabel: seat.rowLabel,
          positionIndex: seat.positionIndex,
          seatNumber: seat.seatNumber,
        })),
      ]));
    },
    auditExplorerCoverage() {
      const rows = explorerCatalog.sections.flatMap((section) => section.rows);
      const seats = rows.flatMap((row) => row.seats);
      const ids = [
        ...explorerCatalog.sections.map((section) => section.id),
        ...rows.map((row) => row.id),
        ...seats.map((seat) => seat.id),
      ];
      const invalidPositions = [
        ...rows.map((row) => row.position),
        ...seats.map((seat) => seat.position),
      ].filter((position) => position.some((value) => !Number.isFinite(value))).length;
      const emptyNonAdaRows = rows.filter((row) => !row.isAda && row.seats.length === 0).length;
      return {
        coverage: explorerCatalog.coverage,
        uniqueIds: new Set(ids).size,
        expectedUniqueIds: ids.length,
        duplicateIds: ids.length - new Set(ids).size,
        invalidPositions,
        emptyNonAdaRows,
        allSectionsHaveRows: explorerCatalog.sections.every((section) => section.rows.length > 0),
        pass:
          explorerCatalog.sections.length === 142 &&
          new Set(ids).size === ids.length &&
          invalidPositions === 0 &&
          emptyNonAdaRows === 0,
      };
    },
    auditExplorerViewMatrix() {
      return auditSeatExplorerViewMatrix(explorerCatalog, geometry);
    },
    listPerspectives() {
      return SEAT_PERSPECTIVES.map((perspective) => ({ ...perspective }));
    },
    async setView(
      viewId: string,
      nextEventConfig: EventConfigId = "football",
      perspective: SeatPerspectiveId = "midfield",
    ) {
      await openInventoryView(viewId, perspective, nextEventConfig);
    },
    async setExplorerView(
      anchorId: string,
      nextEventConfig: EventConfigId = "football",
      perspective: SeatPerspectiveId = "midfield",
    ) {
      await openExplorerView(anchorId, perspective, nextEventConfig);
    },
    setPerspective(perspective: SeatPerspectiveId) {
      if (!SEAT_PERSPECTIVES.some((item) => item.id === perspective)) {
        throw new Error(`Unknown seated perspective: ${perspective}`);
      }
      activePerspective = perspective;
      cameraRig.setSeatedPerspective(perspective);
      hud.syncSeatViewControls(activePerspective, activeLookMode);
    },
    setSeatedPose(next: {
      lookMode?: SeatedLookMode;
      yawDeg?: number;
      pitchDeg?: number;
      leanNormalized?: [number, number, number];
      fovDeg?: number;
    }) {
      if (cameraRig.mode !== "seated") throw new Error("A supported seated view must be active.");
      if (next.lookMode) {
        activeLookMode = next.lookMode;
        cameraRig.setLookMode(next.lookMode);
      }
      if (next.leanNormalized) cameraRig.setLeanNormalized(...next.leanNormalized);
      if (next.fovDeg != null) cameraRig.setSeatedFov(next.fovDeg);
      cameraRig.setLookOffsetsDegrees(next.yawDeg ?? 0, next.pitchDeg ?? 0);
      hud.syncSeatViewControls(activePerspective, activeLookMode);
    },
    auditCurrentView() {
      const direction = cameraRig.camera.getWorldDirection(new THREE.Vector3());
      const values = [...cameraRig.camera.position.toArray(), ...direction.toArray()];
      const diagnostics = stadium.getDiagnostics();
      return {
        selection: { ...selection },
        cameraMode: cameraRig.mode,
        cameraPosition: cameraRig.camera.position.toArray(),
        cameraDirection: direction.toArray(),
        finiteCamera: values.every(Number.isFinite),
        near: cameraRig.camera.near,
        far: cameraRig.camera.far,
        canvasWidth: renderer.domElement.width,
        canvasHeight: renderer.domElement.height,
        eventConfigId,
        metricsReady: latestMetrics != null,
        occupant: cameraRig.getSeatOccupantDiagnostics(),
        seatedContext: diagnostics.seatedContext,
      };
    },
    captureCanvasThumbnail(width = 96, height = 60) {
      renderer.render(stadium.scene, cameraRig.camera);
      const context = renderer.getContext();
      const sourceWidth = renderer.domElement.width;
      const sourceHeight = renderer.domElement.height;
      const source = new Uint8Array(sourceWidth * sourceHeight * 4);
      context.readPixels(
        0,
        0,
        sourceWidth,
        sourceHeight,
        context.RGBA,
        context.UNSIGNED_BYTE,
        source,
      );
      const output = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        const sourceY = sourceHeight - 1 - Math.min(
          sourceHeight - 1,
          Math.floor(y / height * sourceHeight),
        );
        for (let x = 0; x < width; x += 1) {
          const sourceX = Math.min(sourceWidth - 1, Math.floor(x / width * sourceWidth));
          const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
          const targetOffset = (y * width + x) * 4;
          output[targetOffset] = source[sourceOffset]!;
          output[targetOffset + 1] = source[sourceOffset + 1]!;
          output[targetOffset + 2] = source[sourceOffset + 2]!;
          output[targetOffset + 3] = 255;
        }
      }
      return { width, height, pixels: Array.from(output) };
    },
    setExhaustiveQaQuality(enabled: boolean) {
      if (!qaMode) throw new Error("Exhaustive QA quality can only be changed in QA mode.");
      stadium.setExhaustiveQaQuality(enabled);
    },
  };

  const debugApi = {
    objectOnly: true,
    worldRuntimeUsed: false,
    data,
    geometry,
    report,
    calibration: buildCalibrationReport(geometry),
    viewInventory,
    explorerCatalog,
    seatedPerspectiveCoverage: {
      perspectives: SEAT_PERSPECTIVES,
      anchorCount: viewInventory.views.length,
      derivedPerspectiveCount: perspectiveCountForAnchors(viewInventory.views.length),
    },
    explorerPerspectiveCoverage: {
      anchorCount: explorerCatalog.coverage.totalSelectableAnchors,
      perspectivesPerAnchor: explorerCatalog.coverage.perspectivesPerAnchor,
      derivedPerspectiveCount: explorerCatalog.coverage.derivedPerspectives,
    },
    referenceCameras: REFERENCE_CAMERAS,
    assetReport: stadium.assetReport,
    get selection() {
      return selection;
    },
    get diagnostics() {
      return stadium.getDiagnostics();
    },
    get occupantDiagnostics() {
      return cameraRig.getSeatOccupantDiagnostics();
    },
    get liveState() {
      return latestLiveState;
    },
  };
  Object.assign(window, {
    __FIELDLINE__: debugApi,
    __THREE_APP_TEST_HOOKS__: testHooks,
    __THREE_APP_DIAGNOSTICS__: stadium.getDiagnostics(),
  });

  const initialQuery = new URLSearchParams(location.search);
  const initialTour = initialQuery.get("tour");
  const initialView = initialQuery.get("view");
  const initialPerspective = initialQuery.get("perspective");
  const initialLookMode = initialQuery.get("look");
  if (initialTour && REFERENCE_CAMERA_IDS.includes(initialTour as ReferenceCameraId)) {
    stadium.clearSeatedContext();
    cameraRig.setReferenceView(initialTour as ReferenceCameraId);
    void recompute();
  } else if (initialView && findExplorerAnchorById(explorerCatalog, initialView)) {
    const perspective = SEAT_PERSPECTIVES.some((item) => item.id === initialPerspective)
      ? initialPerspective as SeatPerspectiveId
      : "midfield";
    activeLookMode = initialLookMode === "free" ? "free" : "natural";
    void openExplorerView(initialView, perspective, eventConfigId).then(() => {
      cameraRig.setLookMode(activeLookMode);
      hud.syncSeatViewControls(activePerspective, activeLookMode);
    });
  } else {
    void recompute();
  }

  let lastFrameTime = performance.now();
  let lastRenderTime = 0;
  let frameCount = 0;
  let frameWindow = 0;
  const frame = (now: number) => {
    const rawDelta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (!screenshotPaused) cameraRig.update(rawDelta);
    if (qaMode && now - lastRenderTime < 1_000) {
      requestAnimationFrame(frame);
      return;
    }
    if (!screenshotPaused) {
      renderer.render(stadium.scene, cameraRig.camera);
      lastRenderTime = qaMode ? performance.now() : now;
    }
    frameCount += 1;
    frameWindow += rawDelta;
    if (frameWindow >= 1.5) {
      Object.assign(window, {
        __FIELDLINE_FPS__: frameCount / frameWindow,
        __THREE_APP_DIAGNOSTICS__: stadium.getDiagnostics(),
      });
      frameCount = 0;
      frameWindow = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener("beforeunload", () => {
    unsubscribeLive();
    liveStore.dispose();
    sightlineClient.dispose();
    sounds.dispose();
    stadium.dispose();
    renderer.dispose();
  }, { once: true });
}

function formatSelection(selection: SelectionState): string {
  return [
    selection.sectionId ? `Section ${selection.sectionId}` : "Unknown section",
    selection.rowLabel ? `Row ${selection.rowLabel}` : null,
    selection.seatNumber != null
      ? `Seat ${selection.seatNumber}`
      : selection.positionIndex != null
        ? `Modeled position ${selection.positionIndex}`
        : "Row center",
  ].filter(Boolean).join(" · ");
}

function explainComparison(
  metrics: SightlineMetrics,
  shade: ShadeReport | null,
  weights: Record<string, number>,
): string {
  const reasons: string[] = [];
  if ((weights.field ?? 0) >= 50) {
    reasons.push(`${metrics.visibleFieldPercent.value?.toFixed(0)}% of deterministic field samples are modeled visible`);
  }
  if ((weights.closeness ?? 0) >= 50) {
    reasons.push(`${metrics.distanceToMidfieldM.value?.toFixed(0)} m modeled distance to midfield`);
  }
  if ((weights.shade ?? 0) >= 50 && shade) {
    reasons.push(`${shade.directSunMinutes.value} modeled direct-sun minutes; never guaranteed`);
  }
  if ((metrics.obstructions.value ?? []).length) {
    reasons.push(`target-ray flags: ${(metrics.obstructions.value ?? []).join(", ")}`);
  }
  return reasons.join("; ") || "Equal weighting: inspect each disclosed metric directly.";
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  loading.classList.add("error");
  loading.textContent = error instanceof Error ? error.message : "Fieldline could not start";
});
