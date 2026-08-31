export type AppMode =
  | 'loading'
  | 'operations'
  | 'loadout'
  | 'briefing'
  | 'mission'
  | 'zombies'
  | 'maps-zombies'
  | 'maps-zombies-create'
  | 'editor'
  | 'paused'
  | 'settings'
  | 'dead'
  | 'complete';

export type PlayMode = 'mission' | 'zombies' | 'maps-zombies';

export type Difficulty = 'recruit' | 'operative' | 'blacksite';

export type ZombiesResult = {
  roundReached: number;
  kills: number;
  points: number;
  timeMs: number;
};
export type EquipmentId = 'murk-smoke' | 'volt-disruptor';
export type AttachmentSlot = 'optic' | 'muzzle' | 'magazine' | 'grip' | 'stock';

export type WeaponStats = {
  damage: number;
  range: number;
  fireRate: number;
  accuracy: number;
  mobility: number;
  handling: number;
};

export type AttachmentSelection = Record<AttachmentSlot, string>;

export type WeaponLoadout = {
  primaryId: string;
  sidearmId: 'aegis-p11';
  equipmentId: EquipmentId;
  attachments: Record<string, AttachmentSelection>;
};

export type AccessibilitySettings = {
  sensitivity: number;
  fov: number;
  aimMode: 'hold' | 'toggle';
  crouchMode: 'hold' | 'toggle';
  sprintMode: 'hold' | 'toggle';
  subtitles: boolean;
  combatCaptions: boolean;
  reducedShake: boolean;
  reducedFlashing: boolean;
  motionBlur: boolean;
  highContrastReticle: boolean;
};

export type AudioSettings = {
  master: number;
  effects: number;
  ambience: number;
  dialogue: number;
  interface: number;
};

export type GameSettings = {
  accessibility: AccessibilitySettings;
  audio: AudioSettings;
  quality: 'low' | 'medium' | 'high';
};

export type MissionResult = {
  timeMs: number;
  accuracy: number;
  defeated: number;
  damageTaken: number;
  objectivesCompleted: number;
  difficulty: Difficulty;
};

export type PersistedState = {
  version: 1;
  loadout: WeaponLoadout;
  presets: WeaponLoadout[];
  settings: GameSettings;
  selectedDifficulty: Difficulty;
  progress: {
    completed: boolean;
    bestTimeMs: number | null;
    bestTimes: Partial<Record<Difficulty, number>>;
    bestAccuracy: number;
    zombiesBestRound: number;
  };
};

export type MissionStats = {
  startedAt: number;
  elapsedMs: number;
  shotsFired: number;
  shotsHit: number;
  defeated: number;
  damageTaken: number;
};

export type ObjectiveState = {
  id: 'infiltrate' | 'disable' | 'retrieve' | 'extract';
  label: string;
  detail: string;
  progress: number;
  completed: boolean;
};

export const DIFFICULTY_TUNING: Record<
  Difficulty,
  {
    enemyAccuracy: number;
    reactionSeconds: number;
    playerDamageScale: number;
    checkpointArmor: number;
  }
> = {
  recruit: {
    enemyAccuracy: 0.34,
    reactionSeconds: 1.1,
    playerDamageScale: 0.72,
    checkpointArmor: 60,
  },
  operative: {
    enemyAccuracy: 0.48,
    reactionSeconds: 0.72,
    playerDamageScale: 1,
    checkpointArmor: 35,
  },
  blacksite: {
    enemyAccuracy: 0.64,
    reactionSeconds: 0.48,
    playerDamageScale: 1.24,
    checkpointArmor: 15,
  },
};
