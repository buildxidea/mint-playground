import type { MapsStreetViewPose } from './mapsUrl';
import type { MapsMintRuntime } from './mapsMintManifest';
import type { ZombiesPlacementLayout } from '../zombies/ZombiesPlacementLayout';

export type MapsOutbreakDraftStatus =
  | 'editing'
  | 'queued'
  | 'generating'
  | 'installing'
  | 'ready'
  | 'failed';

export type MapsOutbreakDraft = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: MapsOutbreakDraftStatus;
  pose: MapsStreetViewPose;
  mintAssetId?: string;
  mintOperationId?: string;
  mintChatUrl?: string;
  runtime?: MapsMintRuntime;
  placements?: ZombiesPlacementLayout;
  error?: string;
  generationDayKey: string;
};

const STORAGE_KEY = 'blacksite:maps-outbreak-drafts:v1';
const QUOTA_KEY = 'blacksite:maps-outbreak-quota:v1';

const IN_FLIGHT_STATUSES: ReadonlySet<MapsOutbreakDraftStatus> = new Set([
  'editing',
  'queued',
  'generating',
  'installing',
]);

function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Collapse identical ready/failed arenas (same Mint asset or same Street View URL). */
export function mapsOutbreakDraftDedupeKey(draft: MapsOutbreakDraft): string {
  const assetId = draft.mintAssetId ?? draft.runtime?.assetId;
  if (assetId) return `asset:${assetId}`;
  const url = draft.pose.sourceUrl.trim();
  const title = draft.title.trim().toLowerCase();
  return `url:${url}|${title}`;
}

function dedupeMapsOutbreakDrafts(
  drafts: MapsOutbreakDraft[],
): MapsOutbreakDraft[] {
  const sorted = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
  const kept: MapsOutbreakDraft[] = [];
  const seen = new Set<string>();
  for (const draft of sorted) {
    if (IN_FLIGHT_STATUSES.has(draft.status)) {
      kept.push(draft);
      continue;
    }
    const key = mapsOutbreakDraftDedupeKey(draft);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(draft);
  }
  return kept;
}

function readAllMapsOutbreakDrafts(): MapsOutbreakDraft[] {
  return readJson<MapsOutbreakDraft[]>(STORAGE_KEY, []).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function listMapsOutbreakDrafts(): MapsOutbreakDraft[] {
  const all = readAllMapsOutbreakDrafts();
  const deduped = dedupeMapsOutbreakDrafts(all);
  if (deduped.length !== all.length) {
    writeJson(STORAGE_KEY, deduped.slice(0, 24));
  }
  return deduped;
}

export function getMapsOutbreakDraft(id: string): MapsOutbreakDraft | null {
  return listMapsOutbreakDrafts().find((draft) => draft.id === id) ?? null;
}

export function findMapsOutbreakDraftByAssetId(
  assetId: string,
): MapsOutbreakDraft | null {
  const id = assetId.trim();
  if (!id) return null;
  return (
    listMapsOutbreakDrafts().find(
      (draft) =>
        draft.mintAssetId === id || draft.runtime?.assetId === id,
    ) ?? null
  );
}

export function saveMapsOutbreakDraft(draft: MapsOutbreakDraft): void {
  const drafts = readAllMapsOutbreakDrafts().filter(
    (entry) => entry.id !== draft.id,
  );
  drafts.unshift({ ...draft, updatedAt: Date.now() });
  writeJson(STORAGE_KEY, dedupeMapsOutbreakDrafts(drafts).slice(0, 24));
}

export function createMapsOutbreakDraft(input: {
  title: string;
  pose: MapsStreetViewPose;
}): MapsOutbreakDraft {
  const now = Date.now();
  const draft: MapsOutbreakDraft = {
    id: `maps-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || input.pose.locationLabel,
    createdAt: now,
    updatedAt: now,
    status: 'editing',
    pose: input.pose,
    generationDayKey: dayKey(now),
  };
  saveMapsOutbreakDraft(draft);
  return draft;
}

export function mapsGenerationsUsedToday(): number {
  const quota = readJson<{ day: string; count: number }>(QUOTA_KEY, {
    day: dayKey(),
    count: 0,
  });
  if (quota.day !== dayKey()) return 0;
  return quota.count;
}

export function recordMapsGenerationAttempt(): number {
  const today = dayKey();
  const quota = readJson<{ day: string; count: number }>(QUOTA_KEY, {
    day: today,
    count: 0,
  });
  const count = quota.day === today ? quota.count + 1 : 1;
  writeJson(QUOTA_KEY, { day: today, count });
  return count;
}
