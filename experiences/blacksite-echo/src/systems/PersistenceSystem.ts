import {
  ATTACHMENT_SLOTS,
  DEFAULT_ATTACHMENTS,
  isOpsLoadoutWeapon,
  WEAPONS,
} from '../data/weapons';
import type {
  AttachmentSelection,
  MissionResult,
  PersistedState,
  WeaponLoadout,
} from '../game/types';

const STORAGE_KEY = 'blacksite-echo:v1';

function cloneAttachments(): AttachmentSelection {
  return { ...DEFAULT_ATTACHMENTS };
}

export function createDefaultLoadout(): WeaponLoadout {
  return {
    primaryId: 'arx-7',
    sidearmId: 'aegis-p11',
    equipmentId: 'murk-smoke',
    attachments: Object.fromEntries(
      WEAPONS.map((weapon) => [weapon.id, cloneAttachments()]),
    ),
  };
}

export function createDefaultState(): PersistedState {
  return {
    version: 1,
    loadout: createDefaultLoadout(),
    presets: [],
    selectedDifficulty: 'operative',
    settings: {
      accessibility: {
        sensitivity: 0.72,
        fov: 82,
        aimMode: 'hold',
        crouchMode: 'toggle',
        sprintMode: 'hold',
        subtitles: true,
        combatCaptions: true,
        reducedShake: false,
        reducedFlashing: false,
        motionBlur: false,
        highContrastReticle: false,
      },
      audio: {
        master: 0.82,
        effects: 0.86,
        ambience: 0.68,
        dialogue: 0.8,
        interface: 0.75,
      },
      quality: 'high',
    },
    progress: {
      completed: false,
      bestTimeMs: null,
      bestTimes: {},
      bestAccuracy: 0,
      zombiesBestRound: 0,
    },
  };
}

function sanitizeLoadout(candidate: Partial<WeaponLoadout> | undefined): WeaponLoadout {
  const fallback = createDefaultLoadout();
  if (!candidate) return fallback;
  const primaryExists =
    typeof candidate.primaryId === 'string' &&
    isOpsLoadoutWeapon(candidate.primaryId) &&
    candidate.primaryId !== 'aegis-p11';
  const attachments = { ...fallback.attachments };
  for (const weapon of WEAPONS) {
    const selected = candidate.attachments?.[weapon.id];
    if (!selected) continue;
    attachments[weapon.id] = { ...DEFAULT_ATTACHMENTS };
    for (const slot of ATTACHMENT_SLOTS) {
      if (typeof selected[slot] === 'string') attachments[weapon.id][slot] = selected[slot];
    }
  }
  return {
    primaryId: primaryExists ? candidate.primaryId! : fallback.primaryId,
    sidearmId: 'aegis-p11',
    equipmentId:
      candidate.equipmentId === 'volt-disruptor' ? 'volt-disruptor' : 'murk-smoke',
    attachments,
  };
}

export class PersistenceSystem {
  state: PersistedState;

  constructor() {
    this.state = this.load();
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('Unable to persist Blacksite: Echo state.', error);
    }
  }

  savePreset(): void {
    const snapshot = structuredClone(this.state.loadout);
    const presets = [snapshot, ...this.state.presets].slice(0, 3);
    this.state.presets = presets;
    this.save();
  }

  recordResult(result: MissionResult): void {
    const currentDifficultyBest = this.state.progress.bestTimes[result.difficulty];
    this.state.progress.completed = true;
    this.state.progress.bestTimeMs =
      this.state.progress.bestTimeMs === null
        ? result.timeMs
        : Math.min(this.state.progress.bestTimeMs, result.timeMs);
    this.state.progress.bestTimes[result.difficulty] =
      currentDifficultyBest === undefined
        ? result.timeMs
        : Math.min(currentDifficultyBest, result.timeMs);
    this.state.progress.bestAccuracy = Math.max(
      this.state.progress.bestAccuracy,
      result.accuracy,
    );
    this.save();
  }

  recordZombiesResult(result: { roundReached: number }): void {
    this.state.progress.zombiesBestRound = Math.max(
      this.state.progress.zombiesBestRound ?? 0,
      result.roundReached,
    );
    this.save();
  }

  reset(): void {
    this.state = createDefaultState();
    this.save();
  }

  private load(): PersistedState {
    const fallback = createDefaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.version !== 1) return fallback;
      return {
        ...fallback,
        ...parsed,
        version: 1,
        loadout: sanitizeLoadout(parsed.loadout),
        presets: (parsed.presets ?? []).slice(0, 3).map((preset) => sanitizeLoadout(preset)),
        settings: {
          ...fallback.settings,
          ...parsed.settings,
          accessibility: {
            ...fallback.settings.accessibility,
            ...parsed.settings?.accessibility,
          },
          audio: {
            ...fallback.settings.audio,
            ...parsed.settings?.audio,
          },
        },
        progress: { ...fallback.progress, ...parsed.progress },
      };
    } catch (error) {
      console.warn('Stored Blacksite: Echo state was invalid; defaults restored.', error);
      return fallback;
    }
  }
}
