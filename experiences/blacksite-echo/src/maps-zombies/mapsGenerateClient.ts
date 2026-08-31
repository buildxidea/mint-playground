import {
  MAPS_GENERATION_LIMIT_PER_DAY,
  buildMapsOutbreakWorldPrompt,
} from './mapsWorldPrompt';
import {
  createMapsOutbreakDraft,
  findMapsOutbreakDraftByAssetId,
  getMapsOutbreakDraft,
  mapsGenerationsUsedToday,
  recordMapsGenerationAttempt,
  saveMapsOutbreakDraft,
  type MapsOutbreakDraft,
} from './mapsDraftStore';
import { parseGoogleMapsStreetViewUrl } from './mapsUrl';
import type { MapsMintRuntime } from './mapsMintManifest';

export type MapsGenerateClientResult =
  | { ok: true; draft: MapsOutbreakDraft }
  | { ok: false; error: string };

type GenerateApiResponse =
  | {
      ok: true;
      status: 'generating' | 'ready' | 'failed';
      operationId?: string;
      assetId?: string;
      chatUrl?: string;
      runtime?: MapsMintRuntime;
      error?: string;
    }
  | { ok: false; error: string };

async function postGenerate(
  body: Record<string, unknown>,
): Promise<GenerateApiResponse> {
  const response = await fetch('/__maps-zombies/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as GenerateApiResponse;
  if (!response.ok && !json.ok) {
    return {
      ok: false,
      error: json.error || `Generate request failed (${response.status})`,
    };
  }
  return json;
}

export function beginMapsOutbreakFromUrl(input: {
  mapsUrl: string;
  title?: string;
}): MapsGenerateClientResult {
  const parsed = parseGoogleMapsStreetViewUrl(input.mapsUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (mapsGenerationsUsedToday() >= MAPS_GENERATION_LIMIT_PER_DAY) {
    return {
      ok: false,
      error: `Daily generation limit reached (${MAPS_GENERATION_LIMIT_PER_DAY}/day).`,
    };
  }
  const draft = createMapsOutbreakDraft({
    title: input.title?.trim() || parsed.pose.locationLabel,
    pose: parsed.pose,
  });
  return { ok: true, draft };
}

export async function pollMapsOutbreakGeneration(
  draftId: string,
): Promise<MapsGenerateClientResult> {
  const draft = getMapsOutbreakDraft(draftId);
  if (!draft) return { ok: false, error: 'Draft not found.' };
  if (draft.status === 'ready' && draft.runtime) {
    return { ok: true, draft };
  }

  const prompt = buildMapsOutbreakWorldPrompt(draft.pose, draft.title);
  if (draft.status === 'editing' || draft.status === 'queued') {
    recordMapsGenerationAttempt();
    draft.status = 'generating';
    saveMapsOutbreakDraft(draft);
  }

  const result = await postGenerate({
    draftId: draft.id,
    title: draft.title,
    prompt,
    imageUrl: draft.pose.thumbnailUrl,
    sourceUrl: draft.pose.sourceUrl,
    operationId: draft.mintOperationId,
    assetId: draft.mintAssetId,
  });

  const live = getMapsOutbreakDraft(draftId) ?? draft;

  if (!result.ok) {
    live.status = 'failed';
    live.error = result.error;
    saveMapsOutbreakDraft(live);
    return { ok: false, error: result.error };
  }

  if (result.operationId) live.mintOperationId = result.operationId;
  if (result.assetId) live.mintAssetId = result.assetId;
  if (result.chatUrl) live.mintChatUrl = result.chatUrl;

  if (result.status === 'failed') {
    live.status = 'failed';
    live.error = result.error ?? 'Mint generation failed';
    saveMapsOutbreakDraft(live);
    return { ok: false, error: live.error };
  }

  if (result.status === 'ready' && result.runtime) {
    live.status = 'ready';
    live.runtime = result.runtime;
    live.mintAssetId = result.runtime.assetId;
    // Drop any prior pocket/ring placements — deploy always reseats from the
    // editor-style collider nav bake for this runtime.
    live.placements = undefined;
    live.error = undefined;
    saveMapsOutbreakDraft(live);
    return { ok: true, draft: live };
  }

  live.status = 'generating';
  live.error = result.error;
  saveMapsOutbreakDraft(live);
  return { ok: true, draft: live };
}

/** Install a pre-finalized runtime (e.g. MCP proof world) into a local draft. */
export function installMapsOutbreakRuntime(input: {
  title: string;
  mapsUrl: string;
  runtime: MapsMintRuntime;
  chatUrl?: string;
}): MapsGenerateClientResult {
  const parsed = parseGoogleMapsStreetViewUrl(input.mapsUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const existing = findMapsOutbreakDraftByAssetId(input.runtime.assetId);
  const draft =
    existing ??
    createMapsOutbreakDraft({
      title: input.title,
      pose: parsed.pose,
    });

  draft.title = input.title;
  draft.pose = parsed.pose;
  draft.status = 'ready';
  draft.runtime = input.runtime;
  draft.mintAssetId = input.runtime.assetId;
  draft.mintChatUrl = input.chatUrl;
  // Imported/proof runtimes also reseat on deploy from the collider bake.
  draft.placements = undefined;
  draft.error = undefined;
  saveMapsOutbreakDraft(draft);
  return { ok: true, draft };
}
