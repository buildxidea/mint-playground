/// <reference types="vite/client" />

interface Window {
  __FIELDLINE__?: Record<string, unknown>;
  __FIELDLINE_FPS__?: number;
  __THREE_APP_DIAGNOSTICS__?: Record<string, unknown>;
  __THREE_APP_TEST_HOOKS__?: {
    seed(value: number): void;
    setState(name: string): Promise<void>;
    setPausedForScreenshot(paused: boolean): void;
    setReducedMotion(enabled: boolean): void;
    hideDebugUi(hidden: boolean): void;
    waitForAssets(): Promise<void>;
    listViews(): Array<{
      id: string;
      kind: string;
      sectionId: string;
      rowLabel: string;
      seatNumber: number | null;
      positionIndex?: number | null;
      placementStatus: string;
    }>;
    listExplorerSections(): Array<{
      sectionId: string;
      displayName: string;
      tier: "lower" | "club" | "upper-300" | "upper-400";
      rowCount: number;
      chairCount: number;
    }>;
    listExplorerAnchors(): Array<{
      id: string;
      kind: "ada-row-center" | "row-center" | "modeled-seat-position" | "exact-seat";
      sectionId: string;
      rowLabel: string;
      positionIndex: number | null;
      seatNumber: number | null;
    }>;
    auditExplorerCoverage(): {
      coverage: {
        officialSections: number;
        totalRows: number;
        exactSeatIdentifiers: number;
        modeledSeatPositions: number;
        selectableChairPositions: number;
        rowCenterViews: number;
        totalSelectableAnchors: number;
        perspectivesPerAnchor: number;
        derivedPerspectives: number;
      };
      uniqueIds: number;
      expectedUniqueIds: number;
      duplicateIds: number;
      invalidPositions: number;
      emptyNonAdaRows: number;
      allSectionsHaveRows: boolean;
      pass: boolean;
    };
    auditExplorerViewMatrix(): {
      anchorCount: number;
      perspectiveCount: number;
      testedViewStates: number;
      invalidAnchorCount: number;
      invalidViewStateCount: number;
      invalidAnchorIds: string[];
      invalidViewStateIds: string[];
      chairObjectsAudited: number;
      seatCorridorIntersections: number;
      boardClearanceSeatIntrusions: number;
      perspectiveIdsUnique: boolean;
      expectedViewStates: number;
      pass: boolean;
    };
    listPerspectives(): Array<{
      id: string;
      label: string;
      shortLabel: string;
      description: string;
    }>;
    setView(
      viewId: string,
      eventConfig?: "football" | "soccer" | "concert-end" | "concert-round",
      perspective?:
        | "authentic-forward"
        | "midfield"
        | "near-goal"
        | "far-goal"
        | "north-board"
        | "south-board"
        | "left-context"
        | "right-context",
    ): Promise<void>;
    setExplorerView(
      anchorId: string,
      eventConfig?: "football" | "soccer" | "concert-end" | "concert-round",
      perspective?:
        | "authentic-forward"
        | "midfield"
        | "near-goal"
        | "far-goal"
        | "north-board"
        | "south-board"
        | "left-context"
        | "right-context",
    ): Promise<void>;
    setPerspective(
      perspective:
        | "authentic-forward"
        | "midfield"
        | "near-goal"
        | "far-goal"
        | "north-board"
        | "south-board"
        | "left-context"
        | "right-context",
    ): void;
    setSeatedPose(pose: {
      lookMode?: "natural" | "free";
      yawDeg?: number;
      pitchDeg?: number;
      leanNormalized?: [number, number, number];
      fovDeg?: number;
    }): void;
    auditCurrentView(): {
      selection: {
        sectionId: string | null;
        rowLabel: string | null;
        seatNumber: number | null;
        positionIndex?: number | null;
      };
      cameraMode: string;
      cameraPosition: number[];
      cameraDirection: number[];
      finiteCamera: boolean;
      near: number;
      far: number;
      canvasWidth: number;
      canvasHeight: number;
      eventConfigId: string;
      metricsReady: boolean;
      occupant: Record<string, unknown>;
      seatedContext: Record<string, unknown>;
    };
    captureCanvasThumbnail(width?: number, height?: number): {
      width: number;
      height: number;
      pixels: number[];
    };
    setExhaustiveQaQuality(enabled: boolean): void;
  };
}
