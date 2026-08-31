/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  mode: string;
  zombiesPlayspaceReady?: boolean;
  editor: {
    active: boolean;
    roomCount: number;
    portalCount: number;
    placementCount: number;
    selectedId: string | null;
    dirty: boolean;
    errors: string[];
    warnings: string[];
    outsideIds: string[];
    connected: boolean;
    connectorCount: number;
    cutCount: number;
  } | null;
  objective: string;
  enemiesAlive: number;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
    health: number;
    armor: number;
  };
  spawnProtection: {
    active: boolean;
    remainingSeconds: number;
    awaitingControl: boolean;
  };
  weapon: {
    id: string;
    state: string;
    magazine: number;
    reserve: number;
  };
  armory: {
    weaponId: string;
    ready: boolean;
    attachmentModels: number;
    mountedSlots: string[];
    replacedSlots: string[];
    replacementTrianglesRemoved: number;
    mountedAttachments: Array<{
      id: string;
      slot: string;
      scaleAxis: 'x' | 'y' | 'z';
      targetSize: number;
      measuredSize: { x: number; y: number; z: number };
      socketPosition: [number, number, number];
      mountSurfaceDistance: number;
      muzzleAxialGap: number;
      muzzleAxialOverlap: number;
      muzzleBarrelFace: [number, number, number];
    }>;
    canonicalForward: '+X';
    displayedForward: { x: number; y: number; z: number };
  };
  enemies: {
    generatedVisuals: number;
    armedEnemies: number;
    weaponIds: string[];
    minimumWeaponForwardAlignment: number;
    maximumSupportHandDistance: number;
    maximumPrimaryGripDistance: number;
    maximumFootSurfaceError: number;
    groundedSampleCount: number;
    weaponPoses: Array<{
      id: string;
      role: 'rifleman' | 'breacher' | 'suppressor';
      weaponId: string;
      weapon: { x: number; y: number; z: number };
      primaryHand: { x: number; y: number; z: number };
      supportHand: { x: number; y: number; z: number };
      boundsSize: { x: number; y: number; z: number };
      forwardAlignment: number;
      supportDistance: number;
    }>;
    animationActions: number;
    activeAnimations: string[];
  };
  viewmodel: {
    armsVisible: boolean;
    armsMeshCount: number;
    knifeVisible: boolean;
    knifeMeshCount: number;
    weaponMeshCount: number;
    mode: 'hand-bone' | 'camera-space';
    handBone: string | null;
    supportHand: string | null;
    primaryGripDistance: number;
    knifeGripDistance: number;
    weaponForwardAlignment: number;
    activeArmAction: string;
    groupVisible: boolean;
  };
  tacticalMap: {
    distanceMeters: number;
    bearingDegrees: number;
    objectiveId: string;
  };
  ballistics: {
    source: 'player' | 'enemy' | 'probe';
    blocked: boolean;
    distance: number;
    queries: number;
    blocks: number;
  };
  audio: {
    activeVoices: number;
    activeEnemyVoices: number;
    activeFootstepVoices: number;
    maxConcurrentVoices: number;
    maxEnemyVoices: number;
    maxFootstepVoices: number;
    voicesStarted: number;
    voicesStolen: number;
    voicesCoalesced: number;
    masterPeak: number;
    limiterReduction: number;
    zombieDeathCues: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    materials: number;
    meshes: number;
    instancedMeshes: number;
    frameTimeMs: number;
    fps: number;
    dpr: number;
    dprCap: number;
    shadowsEnabled: boolean;
    shadowMapType: number;
    shadowUpdateHz: number;
    postPasses: number;
  };
  performance: import('./core/PerformanceTelemetry').PerformanceTelemetrySnapshot;
  physics: {
    engine: 'rapier';
    timestep: number;
    bodies: number;
    colliders: number;
    sensors: number;
    ccdBodies: number;
    boundaryColliders: number;
    ballisticQueries: number;
    ballisticBlocks: number;
    facilityColliders: number;
    facilityCollidersEnabled: boolean;
    playerMotion: {
      fixedSteps: number;
      planarDistance: number;
      maxPlanarStep: number;
      teleportCount: number;
      teleportEvents: Array<{
        sequence: number;
        from: { x: number; y: number; z: number };
        to: { x: number; y: number; z: number };
        planarDistance: number;
      }>;
    };
    characterCollisions: Array<{
      handle: number;
      label: string;
      normal: { x: number; y: number; z: number };
      remaining: { x: number; y: number; z: number };
    }>;
  };
  spatial: {
    safeSpawn: { x: number; y: number; z: number };
    playableBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    boundaryColliders: number;
    containmentRecoveries: number;
    voidFallRecoveries: number;
    voidFallRecoveryEnabled: boolean;
    missionAnchors: Record<
      'security' | 'comms' | 'intel' | 'extraction' | 'blastDoor',
      { x: number; y: number; z: number }
    >;
  };
  assets: {
    status: string;
    finalArtifacts: number;
    worldReady: boolean;
    worldsReady: number;
    coveragePassed: boolean;
    coverageBlockers: string[];
    visibleFallbacksAllowed: boolean;
    audibleFallbacksAllowed: boolean;
    generatedProductionModels: number;
    worldLoadFailures: number;
    missionRoomsReady: number;
    campusConnectors: number;
    zombiesRoomsReady: number;
    zombiesCampusConnectors: number;
    zombiesCampusRoomPads: number;
    zombiesCampusPerimeterWalls: number;
    zombiesCampusDoorwayGuides: number;
    zombiesCampusVisibleMeshes: number;
    audioLoadedEvents: number;
    audioExpectedEvents: number;
    audibleFallbackActive: boolean;
    vfx: {
      mintImpactAtlasReady: boolean;
      mintSmokeAtlasReady: boolean;
      atlasLoadFailed: boolean;
      proceduralFallbackVisible: boolean;
    };
    runtimeMcpCalls: false;
    worldColliderMeshes: number;
    productionColliderMeshes: number;
  };
  splatLayout: {
    status: string;
    validation: {
      runtimeSafe: boolean;
      releaseReady: boolean;
      errors: string[];
      warnings: string[];
      reachableRoomIds: string[];
      isolatedRoomIds: string[];
      enabledPortalIds: string[];
      doorwayIds: string[];
      blockedRoutes: Array<{
        id: string;
        fromRoomId: string;
        toRoomId: string;
        reason: string;
        requiredAsset: string;
      }>;
    };
    navigation: {
      sourceMode: string;
      totalAreaSquareMetres: number;
      totalTriangles: number;
      totalBoundaryEdges: number;
      rooms: Array<{
        id: string;
        areaSquareMetres: number;
        triangles: number;
        boundaryEdges: number;
        calibrationY: number;
      }>;
    };
    containment: {
      actorCount: number;
      outsideCoverageSamples: number;
      recoveries: number;
    };
    roomTransit: {
      currentRoomId: string | null;
      visitedRoomIds: string[];
      transferCount: number;
      navigation: {
        currentRoom: { id: string; label: string };
        target: {
          terminalId: string;
          roomId: string;
          label: string;
          goalLabel: string;
          position: { x: number; y: number; z: number };
          distance: number;
          inRange: boolean;
        } | null;
        rooms: Array<{
          id: string;
          label: string;
          shortLabel: string;
          visited: boolean;
          active: boolean;
        }>;
      };
      terminals: Array<{
        id: string;
        fromRoomId: string;
        toRoomId: string;
        x: number;
        y: number;
        z: number;
      }>;
    };
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  [key: string]: unknown;
  seed(value: number): void;
  setState(name: string): void;
  setPausedForScreenshot(paused: boolean): void;
  setRenderDisabledForTests(disabled: boolean): void;
  setReducedMotion(enabled: boolean): void;
  zombiesProbeCanvasLuminance?(): {
    mean: number;
    max: number;
    nonClearPct: number;
    drawingBuffer: { width: number; height: number };
    readRect: { x: number; y: number; width: number; height: number };
    renderTarget: string | null;
  } | null;
  hideDebugUi(hidden: boolean): void;
  openZombiesEditor(previewOnly?: boolean): Promise<boolean>;
  zombiesEditorDiagnostics(): {
    active: boolean;
    roomCount: number;
    portalCount: number;
    placementCount: number;
    selectedId: string | null;
    dirty: boolean;
    errors: string[];
    warnings: string[];
    outsideIds: string[];
    connected: boolean;
    connectorCount: number;
    cutCount: number;
    trimCount: number;
    connectiveTissueCount: number;
  } | null;
  zombiesEditorClipVisualDiagnostics(clipId: string): {
    entityId: string;
    kind: 'cut' | 'trim';
    roomId: string;
    enabled: boolean;
    selected: boolean;
    effectiveVisible: boolean;
    inFrustum: boolean;
    screen: [number, number];
    worldCenter: [number, number, number];
    worldSize: [number, number, number];
    materialOpacity: number;
  } | null;
  zombiesEditorPlacements(): {
    version: 1;
    coordinateSpace: 'three-world-metres';
    placements: Array<{
      id: string;
      kind: string;
      roomId: string;
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
      mount: 'floor' | 'wall' | 'socket' | 'free';
    }>;
  } | null;
  zombiesEditorAuthoringSnapshot(): unknown | null;
  zombiesEditorSelect(id: string): boolean;
  zombiesEditorSetView(view: 'perspective' | 'top'): void;
  zombiesEditorSetClipEnabled(
    clipId: string,
    enabled: boolean,
  ): { id: string; kind: 'cut' | 'trim'; enabled: boolean } | null;
  zombiesEditorNudgeTrimPlane(
    trimId: string,
    delta: [number, number, number],
  ): { id: string; position: [number, number, number] } | null;
  zombiesEditorSetTrimPlanePosition(
    trimId: string,
    position: [number, number, number],
  ): { id: string; position: [number, number, number] } | null;
  zombiesEditorSetOverlays(flags: {
    splats?: boolean;
    navigation?: boolean;
    doorways?: boolean;
    trims?: boolean;
    labels?: boolean;
    placements?: boolean;
    grid?: boolean;
    connective?: boolean;
  }): void;
  zombiesEditorSaveProject(): Promise<boolean>;
  zombiesEditorAddWalkablePatch(roomId?: string): {
    patchId: string;
    roomId: string;
    count: number;
  } | null;
  zombiesEditorEditWalkablePatch(patchId: string): boolean;
  zombiesEditorWalkablePatches(): Array<{
    id: string;
    roomId: string;
    pointCount: number;
    editing: boolean;
  }>;
  zombiesEditorNudgeWalkablePoint(
    index: number,
    delta: [number, number],
  ): boolean;
  zombiesEditorFrameClip(
    clipId: string,
    view?: 'perspective' | 'top',
  ): boolean;
  zombiesEditorFrameCutLookThrough(cutId: string, leadIn?: number): boolean;
  zombiesEditorFrameTrimLookThrough(trimId: string, leadIn?: number): boolean;
  zombiesActiveSplatClips(): {
    clipKey: string;
    clipRoomIds: string[];
    clipBindings: Array<{
      id: string;
      kind: 'cut' | 'trim';
      roomId: string;
      ownerRegistered: boolean;
      ownerBase: number;
      ownerCount: number;
    }>;
    cutIds: string[];
    trimIds: string[];
  };
  zombiesRuntimeLayoutClips(): {
    cutVolumes: Array<{
      id: string;
      roomId: string;
      enabled: boolean;
      position: [number, number, number];
      size: [number, number, number];
    }>;
    trimPlanes: Array<{
      id: string;
      roomId: string;
      enabled: boolean;
      position: [number, number, number];
    }>;
  };
  zombiesRuntimeAuthoringSnapshot(): {
    layout: unknown;
    navigation: unknown;
    placements: unknown;
    roomRoots: Array<{
      id: string;
      position: number[] | null;
      rotation: number[] | null;
      scale: number[] | null;
    }>;
    arenaPlacements: Array<{
      id: string;
      kind: string;
      roomId: string;
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
      mount: 'floor' | 'wall' | 'socket' | 'free';
    }>;
  };
  teleportPlayer(x: number, y: number, z: number): void;
  setKeyDown(code: string, down: boolean): void;
  setPlayerLook(yaw: number, pitch: number): void;
  resetPlayerMotionDiagnostics(): void;
  advancePlayerMovement(seconds: number): {
    position: { x: number; y: number; z: number };
    recoveries: number;
    collisions: string[];
  };
  setMouseButtonDown(button: number, down: boolean): void;
  advanceWeaponCombat(seconds: number): {
    knifeVisible: boolean;
    knifeMeshCount: number;
    weaponId: string;
    weaponState: string;
    mode: 'hand-bone' | 'camera-space';
    handBone: string | null;
    supportHand: string | null;
    primaryGripDistance: number;
    knifeGripDistance: number;
    weaponForwardAlignment: number;
    armsVisible: boolean;
    weaponMeshCount: number;
    activeArmAction: string;
    groupVisible: boolean;
  };
  advanceInteraction(seconds: number): void;
  advanceZombieNavigation(seconds: number): void;
  zombiesForcePortalsReady(ready?: boolean): void;
  defeatAllEnemies(): void;
  probeBallistics(
    origin: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
  ): { source: 'probe'; blocked: boolean; distance: number };
  captureAudioStress(seconds?: number): Promise<string | null>;
  teleportEnemy(id: string, x: number, y: number, z: number): void;
  fireEnemyAtPlayer(id: string): {
    healthBefore: number;
    healthAfter: number;
    armorBefore: number;
    armorAfter: number;
    blocked: boolean;
  } | null;
  poseEnemies(semantic: string, time?: number): void;
  poseEnemiesState(state: string, time?: number): void;
  setPlayerView(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
  ): void;
  teleportZombie(id: string, x: number, y: number, z: number): void;
  zombiesAimDiagnostics(id: string): {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    headTarget: { x: number; y: number; z: number } | null;
    closestApproach: number | null;
    intersections: Array<{
      name: string;
      hitZone: string;
      distance: number;
    }>;
  } | null;
  poseZombie(id: string, semantic: string, time?: number): void;
  characterFacingDiagnostics(): {
    enemies: Array<{
      id: string;
      role: string;
      living: boolean;
      hasMintVisual: boolean;
      yaw: number;
      headfrontDotActorForward: number;
    }>;
    zombies: Array<{
      id: string;
      archetype: 'shambler' | 'sprinter' | 'brute';
      sprinter: boolean;
      living: boolean;
      hasMintVisual: boolean;
      yaw: number;
      visualYaw: number;
      headfrontDotActorForward: number;
      x: number;
      y: number;
      z: number;
    }>;
  };
  zombiesGrantPoints(amount: number): void;
  zombiesEquipWeapon(
    weaponId:
      | 'arx-7'
      | 'kestrel-9'
      | 'morrow-dmr12'
      | 'brimstone-lmg6'
      | 'talon-m4'
      | 'aegis-p11'
      | 'ray-gun'
      | 'volt-caster'
      | 'nightfall-50'
      | 'hellion-aa'
      | 'pyre-thrower'
      | 'rupture-rpg'
      | 'specter-pdw'
      | 'storm-howler'
      | 'magnum-rex'
      | 'wraith-burst',
  ): string | null;
  zombiesForcePowerOn(): void;
  zombiesForceClearRound(): void;
  zombiesForceBeginNextRound(): void;
  zombiesForceLethalHit(): void;
  zombiesArmSpawnProtection(seconds?: number): void;
  zombiesResetNavigationDiagnostics(): void;
  zombiesSpawnPowerUp(
    kind: 'max-ammo' | 'insta-kill' | 'double-points' | 'nuke' | 'carpenter',
  ): void;
  zombiesPurchasePerk(perkId: 'revive' | 'juggernog' | 'speed' | 'doubletap'): void;
  zombiesFreezeInteractablePeak(
    id:
      | 'perk-revive'
      | 'perk-juggernog'
      | 'perk-speed'
      | 'perk-doubletap'
      | 'mystery-box'
      | 'pack-a-punch',
  ): boolean;
  zombiesInteractableVisuals(): Array<{
    id:
      | 'perk-revive'
      | 'perk-juggernog'
      | 'perk-speed'
      | 'perk-doubletap'
      | 'mystery-box'
      | 'pack-a-punch';
    role: 'perk-machine' | 'mystery-box' | 'pack-a-punch';
    active: boolean;
    frozenAtPeak: boolean;
    phase: number;
    rootLift: number;
    effectVisible: boolean;
    effectScale: number;
  }>;
  zombiesSnapshot(): {
    round: number;
    points: number;
    powerOn: boolean;
    living: number;
    pendingSpawns: number;
    perks: string[];
    kills: number;
    playerStart: { x: number; y: number; z: number };
    doors: Array<{ id: string; x: number; y: number; z: number }>;
    spawnPoints: Array<{
      id: string;
      zone: string;
      x: number;
      y: number;
      z: number;
      barrierId?: string;
      roomId?: string;
      outsidePosition?: { x: number; y: number; z: number };
      landingPosition?: { x: number; y: number; z: number };
    }>;
    barriers: Array<{ id: string; x: number; y: number; z: number }>;
    archetypeCounts: {
      shambler: number;
      sprinter: number;
      brute: number;
    };
    zombies: Array<{
      id: string;
      archetype: 'shambler' | 'sprinter' | 'brute';
      state: string;
      health: number;
      x: number;
      y: number;
      z: number;
      hasMintVisual: boolean;
      hasPlaceholderVisual: boolean;
      headTarget: { x: number; y: number; z: number } | null;
      presentationBounds: {
        minY: number;
        maxY: number;
        height: number;
      } | null;
      deathAnimation: string | null;
      deathAnimationSeconds: number;
      deathElapsedSeconds: number;
      deathSettled: boolean;
      deathVisualBounds: {
        minY: number;
        maxY: number;
        height: number;
        floorError: number;
      } | null;
      navigation: {
        roomId: string | null;
        targetRoomId: string | null;
        nextRoomId: string | null;
        roomsVisited: string[];
        portalTransitions: number;
        distanceWalked: number;
        currentStuckSeconds: number;
        maxStuckSeconds: number;
        remainingPathDistance: number;
        noProgressSeconds: number;
        maxNoProgressSeconds: number;
        facingPlayerDot: number;
        minimumFacingPlayerDot: number;
        facingViolationSamples: number;
        coverageDistance: number;
        repathCount: number;
        recoveryCount: number;
        waypointCount: number;
        waypointIndex: number;
        coverageByRoom: Array<{
          roomId: string;
          minX: number;
          maxX: number;
          minZ: number;
          maxZ: number;
          spanX: number;
          spanZ: number;
        }>;
      };
    }>;
    proceduralFallbacks: number;
    mintAttachFailures: number;
    campusNavigation: {
      configured: boolean;
      roomCount: number;
      portalCount: number;
      playerRoomId: string | null;
      postEntryZombieOutsideCoverageCount: number;
    };
  } | null;
  zombiesMintCoverage(): {
    zombieWalker: boolean;
    zombieSprinter: boolean;
    zombieAnimations: boolean;
    audioRoundStart: boolean;
    proceduralZombieFallbacks: number;
    zombieMintAttachFailures: number;
    machinePlaceholders: number;
  };
  zombiesCampusWaypoints(): Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    z: number;
    index: number;
  }>;
  zombiesHubResidency(): {
    roomId: string;
    rootPageResident: boolean;
    rootPageWarmed: boolean;
    activeSplats: number;
    pagerAttached: boolean;
    lodTreeRegistered: boolean;
    renderState: string;
  } | null;
  zombiesWalkProbe(): {
    timestamp: number;
    roomId: string | null;
    frameOwner: string | null;
    containmentRoomId: string | null;
    player: { x: number; y: number; z: number; yaw: number; pitch: number };
    containment: {
      signedDistance: number;
      recoveries: number;
      inMesh: boolean;
    };
    collisions: { labels: string[]; maxCount: number };
    nav: { areaSquareMetres: number };
    splat: {
      rootPageResident: boolean;
      rootPageWarmed: boolean;
      activeSplats: number;
      renderState: string | null;
    };
    issueCode:
      | 'OK'
      | 'RAD-DARK'
      | 'NAV-CLIP'
      | 'PHYS-BLOCK'
      | 'OWNER-STUCK'
      | 'UNKNOWN';
  };
  zombiesCampusFloorPlan(): Array<{
    id: string;
    index: number;
    floorY: number;
    bounds: {
      min: { x: number; z: number };
      max: { x: number; z: number };
    };
    corners: Array<{
      name: 'north-west' | 'north-east' | 'south-east' | 'south-west';
      x: number;
      y: number;
      z: number;
    }>;
  }>;
  zombiesRoomTransitSnapshot(): {
    currentRoomId: string | null;
    player: { x: number; y: number; z: number };
    currentRoomLanding: { x: number; y: number; z: number } | null;
    visitedRoomIds: string[];
    transferCount: number;
    selectedInteractionTerminalId: string | null;
    progression: {
      powerOn: boolean;
      openDoorIds: string[];
    };
    navigation: {
      currentRoom: { id: string; label: string };
      target: {
        terminalId: string;
        kind: 'power' | 'door' | 'relay';
        roomId: string;
        label: string;
        goalLabel: string;
        position: { x: number; y: number; z: number };
        distance: number;
        inRange: boolean;
        available: boolean;
        requirement: string | null;
      } | null;
      rooms: Array<{
        id: string;
        label: string;
        shortLabel: string;
        visited: boolean;
        active: boolean;
      }>;
    };
    terminals: Array<{
      id: string;
      fromRoomId: string;
      toRoomId: string;
      x: number;
      y: number;
      z: number;
      navSafe: boolean;
      landingNavSafe: boolean;
      clearPathFromLanding: boolean;
      nearestTerminalDistance: number | null;
      available: boolean;
    }>;
  };
  zombiesActivateRoomTransit(): boolean;
  zombiesSpatialContracts(): Array<{
    id: string;
    index: number;
    floorY: number;
    rootPosition: { x: number; y: number; z: number };
    colliderBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
    objectBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
    radBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
  }>;
  zombiesSetSplatAnalysisRoom(index: number | null): string | null;
  zombiesSetSplatAnalysisBudget(splatCount: number | null): number | null;
  zombiesSplatAnalysis(): {
    frameOwner: string | null;
    activePortalId: string | null;
    connectorPresentationCandidateId: string | null;
    connectorPresentationCandidateOwnerId: string | null;
    connectorTraversalId: string | null;
    connectorTraversalState: string;
    strictConnectorAtPlayer: string | null;
    activePortalApertureNdc: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      corners: Array<{ x: number; y: number }>;
    } | null;
    portalPresentation: {
      visiblePortalIds: string[];
      visibleDoorwaySideIds: string[];
    };
    portalCandidates: Array<{
      id: string;
      destinationId: string;
      distance: number;
      ownerSideDistance: number;
      facingDot: number;
      ndc: { x: number; y: number; z: number };
      ready: boolean;
      prefetched: boolean;
    }>;
    prefetch: string | null;
    prefetchIds: string[];
    predictiveWarmTarget: string | null;
    predictiveWarmStatus: string;
    predictiveReadyRoomIds: string[];
    predictiveHandoffTarget: string | null;
    predictiveHandoffSortReady: boolean;
    predictiveHandoffSortStatus: string;
    preload: {
      activeKey: string | null;
      queuedKeys: string[];
      records: Array<{
        key: string;
        ownerId: string;
        destinationId: string;
        priority: number;
        stage: 'queued' | 'warming' | 'ready' | 'timeout' | 'error';
        requestedAt: number;
        startedAt: number | null;
        completedAt: number | null;
        attempts: number;
        detail: string;
      }>;
    };
    portalLandings: Array<{
      id: string;
      fromId: string;
      toId: string;
      from: { x: number; y: number; z: number } | null;
      to: { x: number; y: number; z: number } | null;
    }>;
    forcedRoom: number | null;
    quality: {
      activeRenderOwnerId: string | null;
      activeRenderSecondaryId: string | null;
      activeRenderTertiaryId: string | null;
      activeRenderOwnerRange: { base: number; count: number };
      activeRenderSecondaryRange: { base: number; count: number };
      activeRenderTertiaryRange: { base: number; count: number };
      lodSplatCount: number;
      lodRenderScale: number;
      focalAdjustment: number;
      blurAmount: number;
      foveationDisabled: boolean;
      sortMode: 'z-depth' | 'radial';
      activeSplats: number;
      autoUpdate: boolean;
      sorting: boolean;
      sortDirty: boolean;
      sortedCenter: { x: number; y: number; z: number };
      continuousPortalCompositeFrames: number;
      continuousPortalFallbackFrames: number;
      continuousPortalBehindActiveSplats: number;
      continuousPortalBehindSourceSplats: number;
      continuousPortalBehindMappings: Array<{
        name: string;
        count: number;
      }>;
      continuousPortalDestinationId: string | null;
      continuousPortalDestinationReady: boolean;
      clipBindings: Array<{
        id: string;
        kind: 'cut' | 'trim';
        roomId: string;
        ownerRegistered: boolean;
        ownerBase: number;
        ownerCount: number;
      }>;
      splatMappings: Array<{
        name: string;
        base: number;
        count: number;
      }>;
      currentLodCenter: { x: number; y: number; z: number } | null;
      currentLodAgeMs: number | null;
    } | null;
    rooms: Array<{
      id: string;
      index: number;
      displayName: string;
      runtimeBytes: number;
      anchor: { x: number; y: number; z: number };
      rootPosition: { x: number; y: number; z: number };
      activeSplats: number;
      splat: {
        id: string;
        integrationMode: 'remote_stream';
        runtimeUrl: string;
        colliderUrl: string;
        sourceKind: 'Spark SplatMesh / paged RAD';
        isSplatMesh: true;
        initialized: boolean;
        paged: boolean;
        pagerAttached: boolean;
        lodTreeRegistered: boolean;
        rootPageResident: boolean;
        rootPageWarmed: boolean;
        activeSplats: number;
        selectedSplats: number;
        mappedSplats: number;
        requestedChunks: number;
        residentRequestedChunks: number;
        missingRequestedChunks: number;
        handoffReady: boolean;
        portalLodInstanceReady: boolean;
        renderState:
          | 'primary'
          | 'portal'
          | 'prefetch'
          | 'resident'
          | 'hidden';
        rootVisible: boolean;
        splatVisible: boolean;
        splatOpacity: number;
        colliderRootVisible: boolean;
        colliderMeshCount: number;
        physicsColliderCount: number;
        visibleColliderMeshes: number;
        visualFallbackActive: false;
      };
    }>;
  };
  zombiesPortalDiagnostics(): {
    id: string;
    ownerId: string;
    destinationId: string;
    distanceToOwnerSocket: number;
    width: number;
    usableWidth: number;
    height: number;
    sourceVisualWidth: number;
    sourceVisualHeight: number;
    destinationSocketWidth: number;
    destinationSocketHeight: number;
    visualToTraversalWidthRatio: number;
    prefetchDistance: number;
    renderDistance: number;
    sourceAperture: {
      center: { x: number; y: number; z: number };
      halfWidth: number;
      halfHeight: number;
      ndcCorners: Array<{ x: number; y: number; z: number }>;
    };
    compositor: {
      requestedSplatBudget: number;
      compositeFrames: number;
      fallbackFrames: number;
      behindActiveSplats: number;
      behindSourceSplats: number;
    };
    containmentSignedDistance: number;
    ready: boolean;
    destinationResident: boolean;
    destinationRenderState: string | null;
    compositorDestinationReady: boolean;
    authoredClipIds: string[];
    authoredCutWidths: number[];
    gameplayClipBindings: string[];
  } | null;
  zombiesSetDebugSplatPaint(enabled: boolean): {
    portalPass: number;
    renderOwnerFilterEnabled: number;
    renderOwnerBase: number;
    renderOwnerCount: number;
    renderSecondaryBase: number;
    renderSecondaryCount: number;
    cutCount: number;
    trimCount: number;
    debugSplatPaint: number;
    minAlpha: number;
    falloff: number;
    encodeLinear: boolean;
  } | null;
  zombiesLiveSparkUniforms(): {
    portalPass: number;
    renderOwnerFilterEnabled: number;
    renderOwnerBase: number;
    renderOwnerCount: number;
    renderSecondaryBase: number;
    renderSecondaryCount: number;
    cutCount: number;
    trimCount: number;
    debugSplatPaint: number;
    minAlpha: number;
    falloff: number;
    encodeLinear: boolean;
  } | null;
  zombiesSparkMeshDiagnostics?(): unknown;
  zombiesSetSplatIsolation(enabled: boolean): {
    enabled: boolean;
    hiddenOrdinaryMeshes: number;
    visibleOrdinaryMeshes: number;
    sparkRendererVisible: boolean;
  };
  zombiesSplatPortals(): Array<{
    id: string;
    fromId: string;
    toId: string;
    from: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
    radius: number;
    continuous: true;
    ready: boolean;
  }>;
  zombiesCampusConnectivity(): {
    connected: boolean;
    roomCount: number;
    linkCount: number;
    reachableRoomIds: string[];
    isolatedRoomIds: string[];
    links: Array<{ fromId: string; toId: string }>;
  };
  zombiesBeginSplatFrameHold(seconds?: number): boolean;
  zombiesReleaseSplatFrameHold(): void;
  zombiesSplatFrameHoldState(): {
    active: boolean;
    holding: boolean;
    primed: boolean;
    activations: number;
    remaining: number;
  };
  debugCenterRaycast(x?: number, y?: number): Array<{
    name: string;
    parentName: string;
    distance: number;
    type: string;
    hierarchy: string[];
    materials: Array<{
      name: string;
      type: string;
      transparent: boolean;
      opacity: number;
      color: string | null;
    }>;
  }>;
  zombiesStartCampusTour(): boolean;
  zombiesCampusTourStatus(): {
    active: boolean;
    done: boolean;
    progress: number;
  };
  zombiesContainmentAudit(): {
    ready: boolean;
    playerInsideSplat: boolean;
    playerInsidePlayable: boolean;
    player: { x: number; y: number; z: number };
    splatBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    playableBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    objects: Array<{
      id: string;
      roomId: string | null;
      x: number;
      y: number;
      z: number;
      insideSplat: boolean;
      insidePlayable: boolean;
    }>;
    outsideSplat: string[];
    outsidePlayable: string[];
  } | null;
  zombiesSurfacePlacement(): {
    total: number;
    placed: number;
    wallMounted: number;
    floorMounted: number;
    sourceTrianglePlacements: number;
    analyzerPlacements: number;
    authoredSocketPlacements: number;
    failures: string[];
  };
  zombiesContainmentPlayerRoom(): string | null;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
