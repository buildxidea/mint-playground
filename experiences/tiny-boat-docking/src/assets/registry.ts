export type ModelAssetId =
  | 'boat_red_runabout'
  | 'boat_teal_skiff'
  | 'boat_yellow_utility'
  | 'dock_straight'
  | 'dock_corner_l'
  | 'dock_finger_end'
  | 'cleat_post'
  | 'buoy_striped'
  | 'marina_boathouse'
  | 'crate_stack'
  | 'bollard_lantern'
  | 'life_ring_post';

export type AudioAssetId =
  | 'boat_engine'
  | 'water_move'
  | 'buoy_bell'
  | 'dock_hit'
  | 'rope_attach'
  | 'success_chime';

export type ModelRegistryEntry = {
  id: ModelAssetId;
  path: string;
  /** Semantic forward axis in model space after normalize. */
  forward: 'posZ' | 'negZ' | 'posX' | 'negX';
  targetLength: number;
};

export type AudioRegistryEntry = {
  id: AudioAssetId;
  path: string;
  loop?: boolean;
};

export const MODEL_REGISTRY: Record<ModelAssetId, ModelRegistryEntry> = {
  boat_red_runabout: {
    id: 'boat_red_runabout',
    path: 'https://cdn.mint.gg/glb/boat-red-runabout-normalized-5855b55f0c81e000.glb',
    forward: 'posZ',
    targetLength: 5.2,
  },
  boat_teal_skiff: {
    id: 'boat_teal_skiff',
    path: 'https://cdn.mint.gg/glb/boat-teal-skiff-normalized-a12d1fb49a041a5a.glb',
    forward: 'posZ',
    targetLength: 5.4,
  },
  boat_yellow_utility: {
    id: 'boat_yellow_utility',
    path: 'https://cdn.mint.gg/glb/boat-yellow-utility-normalized-3b21401eb04d6037.glb',
    forward: 'posZ',
    targetLength: 5.0,
  },
  dock_straight: {
    id: 'dock_straight',
    path: 'https://cdn.mint.gg/glb/dock-straight-normalized-55550e2ea01d6257.glb',
    forward: 'posX',
    targetLength: 6,
  },
  dock_corner_l: {
    id: 'dock_corner_l',
    path: 'https://cdn.mint.gg/glb/dock-corner-l-normalized-102ba734afc3deeb.glb',
    forward: 'posX',
    targetLength: 6,
  },
  dock_finger_end: {
    id: 'dock_finger_end',
    path: 'https://cdn.mint.gg/glb/dock-finger-end-normalized-b96194a69de55545.glb',
    forward: 'posX',
    targetLength: 4,
  },
  cleat_post: {
    id: 'cleat_post',
    path: 'https://cdn.mint.gg/glb/cleat-post-normalized-a9defd02ad8de591.glb',
    forward: 'posZ',
    targetLength: 1.2,
  },
  buoy_striped: {
    id: 'buoy_striped',
    path: 'https://cdn.mint.gg/glb/buoy-striped-normalized-5963d97f5599870c.glb',
    forward: 'posZ',
    targetLength: 1.1,
  },
  marina_boathouse: {
    id: 'marina_boathouse',
    path: 'https://cdn.mint.gg/glb/marina-boathouse-normalized-7bb594c4a01881d6.glb',
    forward: 'posZ',
    targetLength: 10,
  },
  crate_stack: {
    id: 'crate_stack',
    path: 'https://cdn.mint.gg/glb/crate-stack-normalized-286638c93b77e19e.glb',
    forward: 'posZ',
    targetLength: 1.6,
  },
  bollard_lantern: {
    id: 'bollard_lantern',
    path: 'https://cdn.mint.gg/glb/bollard-lantern-normalized-3021f9b2761d630f.glb',
    forward: 'posZ',
    targetLength: 1.4,
  },
  life_ring_post: {
    id: 'life_ring_post',
    path: 'https://cdn.mint.gg/glb/life-ring-post-normalized-78a2405411e86550.glb',
    forward: 'posZ',
    targetLength: 1.5,
  },
};

export const AUDIO_REGISTRY: Record<AudioAssetId, AudioRegistryEntry> = {
  boat_engine: { id: 'boat_engine', path: 'https://cdn.mint.gg/audio/xd766pqhhpbb82zfnsqhswc9gs8bxzr4/boat-engine-cbeae2-2fc1f764b43704ec.mp3', loop: true },
  water_move: { id: 'water_move', path: 'https://cdn.mint.gg/audio/xd7f6980fnb0srge2ar61hb7y98bwvmf/water-move-d2d95c-9f32ff894930cbac.mp3', loop: true },
  buoy_bell: { id: 'buoy_bell', path: 'https://cdn.mint.gg/audio/xd7fp8fb0qea93fvrxtcbf83r58bxq3z/buoy-bell-3c5df1-e1094c602be41306.mp3' },
  dock_hit: { id: 'dock_hit', path: 'https://cdn.mint.gg/audio/xd76z6cs9yc39jgsnxfz078hvn8bxvwr/dock-hit-db920d-1f30196681a7abbc.mp3' },
  rope_attach: { id: 'rope_attach', path: 'https://cdn.mint.gg/audio/xd7bv7xznh5mcvz0wwfa8et0ws8bxy6r/rope-attach-07cc8d-af5135e75d054c04.mp3' },
  success_chime: { id: 'success_chime', path: 'https://cdn.mint.gg/audio/xd7cz9c2dp8ajrs4hpayt5w7258bwa22/success-chime-63f233-d56748d6b30c416e.mp3' },
};
