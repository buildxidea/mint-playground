import { z } from "zod";
import type { EventConfigId } from "../app/eventConfigs";

export const FreshnessSchema = z.enum(["fresh", "stale", "static", "modeled", "unknown"]);
export type Freshness = z.infer<typeof FreshnessSchema>;

const TruthStatusSchema = z.enum([
  "official-public",
  "verified-public",
  "observed-public",
  "modeled",
  "unknown-do-not-infer",
]);

export const LiveEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  localDate: z.string(),
  localTime: z.string().nullable(),
  endLocalDate: z.string().nullable(),
  endLocalTime: z.string().nullable(),
  timeZone: z.literal("America/Los_Angeles"),
  url: z.string().url(),
  purchaseUrl: z.string().url().nullable(),
  eventConfigHint: z.enum(["football", "soccer", "concert-end", "concert-round"]).nullable(),
  status: z.enum(["scheduled", "cancelled", "postponed", "rescheduled", "unknown"]),
});

export type LiveEvent = Omit<z.infer<typeof LiveEventSchema>, "eventConfigHint"> & {
  eventConfigHint: EventConfigId | null;
};

const LiveWeatherSchema = z.object({
  observedAt: z.string().nullable(),
  temperatureC: z.number().nullable(),
  relativeHumidityPercent: z.number().nullable(),
  windSpeedKph: z.number().nullable(),
  summary: z.string().nullable(),
  forecastUpdatedAt: z.string().nullable(),
  hourly: z.array(z.object({
    startTime: z.string(),
    temperatureC: z.number().nullable(),
    precipitationChancePercent: z.number().nullable(),
    windSpeed: z.string().nullable(),
    summary: z.string().nullable(),
  })),
  alertsUrl: z.string().url(),
});

export type LiveWeather = z.infer<typeof LiveWeatherSchema>;

function SourcedDatumSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    truthStatus: TruthStatusSchema,
    freshness: FreshnessSchema,
    sourceId: z.string(),
    sourceUrl: z.string().url().nullable(),
    fetchedAt: z.string().nullable(),
    sourceUpdatedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    staleReason: z.string().nullable(),
    cacheStatus: z.string(),
  });
}

export const LiveSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.string(),
  venue: z.object({
    id: z.literal("levis-stadium"),
    timeZone: z.literal("America/Los_Angeles"),
    latitude: z.number(),
    longitude: z.number(),
    ticketmasterLegacyVenueId: z.string(),
    ticketmasterDiscoveryVenueId: z.string().nullable(),
  }),
  events: SourcedDatumSchema(z.array(LiveEventSchema)),
  weather: SourcedDatumSchema(LiveWeatherSchema),
  inventory: SourcedDatumSchema(z.unknown()),
});

export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

export type LiveVenueState = {
  phase: "idle" | "loading" | "ready" | "error" | "static";
  snapshot: LiveSnapshot | null;
  error: string | null;
};

export function effectiveFreshness(
  freshness: Freshness,
  expiresAt: string | null,
  now = Date.now(),
): Freshness {
  if (freshness !== "fresh" || !expiresAt) return freshness;
  return new Date(expiresAt).getTime() > now ? "fresh" : "stale";
}

export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "time unavailable";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function createStaticLiveState(): LiveVenueState {
  return {
    phase: "static",
    error: null,
    snapshot: null,
  };
}
