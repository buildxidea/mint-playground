export const turntablePreferenceKey = "side-one:turntable-variant";
export const legacyTurntablePreferenceKey =
  "needle-archive:turntable-variant";

export type TurntableVariantId =
  | "archive-walnut"
  | "mint-walnut-console"
  | "mint-studio-aluminium"
  | "mint-clear-acrylic";

export type TurntableVariantTransform = {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
};

export type TurntableVariant = {
  id: TurntableVariantId;
  label: string;
  description: string;
  palette: readonly [string, string, string];
  source: "builtin" | "mint";
  available: boolean;
  assetKey?: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  transform?: TurntableVariantTransform;
};

/**
 * Stable application-facing IDs let a synchronized Mint artifact replace a
 * pending entry without changing settings persistence or scene code.
 */
export const turntableVariants: readonly TurntableVariant[] = [
  {
    id: "archive-walnut",
    label: "Walnut Classic",
    description: "Warm timber plinth with a brushed-metal playback deck.",
    palette: ["#5a3827", "#242722", "#bcb29f"],
    source: "builtin",
    available: true,
  },
  {
    id: "mint-walnut-console",
    label: "Walnut Console",
    description: "A low mid-century chassis with sculpted timber edges.",
    palette: ["#70452d", "#171815", "#d0b78f"],
    source: "mint",
    available: true,
    assetKey: "turntable-chassis-collection",
    modelUrl:
      "https://cdn.mint.gg/glb/walnut-console-normalized-b44bd675e5c9bdb7.glb",
    thumbnailUrl:
      "https://cdn.mint.gg/images/models/walnut-console-a7bbcce04bc6a3ca.webp",
    transform: {
      position: [0, 0.133, 0],
      rotation: [0, 0, 0],
      scale: [3.57, 4.2, 2.86],
    },
  },
  {
    id: "mint-studio-aluminium",
    label: "Studio Aluminium",
    description: "A precise direct-drive shell in satin silver and graphite.",
    palette: ["#c5c7c5", "#363936", "#8d2f26"],
    source: "mint",
    available: true,
    assetKey: "turntable-chassis-collection",
    modelUrl:
      "https://cdn.mint.gg/glb/studio-aluminium-normalized-f0027498bae3d3f4.glb",
    thumbnailUrl:
      "https://cdn.mint.gg/images/models/studio-aluminium-98fd685f512be280.webp",
    transform: {
      position: [0, 0.147, 0],
      rotation: [0, 0, 0],
      scale: [3.57, 3.55, 3.16],
    },
  },
  {
    id: "mint-clear-acrylic",
    label: "Clear Acrylic",
    description: "A minimal transparent plinth with restrained metal details.",
    palette: ["#dce7e5", "#7a8e8b", "#c0a36d"],
    source: "mint",
    available: true,
    assetKey: "turntable-clear-acrylic",
    modelUrl:
      "https://cdn.mint.gg/glb/champagne-acrylic-plinth-normalized-4beb84ff32716f54.glb",
    thumbnailUrl:
      "https://cdn.mint.gg/images/models/champagne-acrylic-plinth-c01b11adfa22d649.webp",
    transform: {
      position: [0, 0.137, 0],
      rotation: [0, 0, 0],
      scale: [3.57, 3.2, 2.9],
    },
  },
] as const;

export const defaultTurntableVariantId: TurntableVariantId =
  "archive-walnut";

export function isTurntableVariantId(
  value: string | null,
): value is TurntableVariantId {
  return turntableVariants.some((variant) => variant.id === value);
}

export function getTurntableVariant(id: TurntableVariantId) {
  return (
    turntableVariants.find((variant) => variant.id === id) ??
    turntableVariants[0]
  );
}
