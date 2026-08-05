import * as SunCalc from "suncalc";
import { MODELED_DISCLAIMER, provenanced } from "./provenance";
import type { ModeledGeometryManifest, ProvenancedValue } from "./schema";

export type ShadeSample = {
  timeIso: string;
  altitudeDeg: number;
  azimuthDeg: number;
  sunAboveHorizon: boolean;
  inDirectSun: boolean;
  occluder?: string;
  status: "modeled";
  sourceIds: string[];
};

export type ShadeReport = {
  kickoff: ShadeSample;
  timeline: ShadeSample[];
  directSunMinutes: ProvenancedValue<number>;
  note: string;
};

/** Convert local wall time in America/Los_Angeles to a Date for solar math. */
export function zonedLocalToUtc(
  dateStr: string,
  timeStr: string,
  timeZone = "America/Los_Angeles",
): Date {
  // Interpret components as wall time in the venue timezone.
  const probe = new Date(`${dateStr}T${timeStr}:00`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  // Iteratively adjust UTC so that the zoned wall clock matches the requested local time.
  let guess = probe.getTime();
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const asLocal = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const desired = Date.UTC(
      Number(dateStr.slice(0, 4)),
      Number(dateStr.slice(5, 7)) - 1,
      Number(dateStr.slice(8, 10)),
      Number(timeStr.slice(0, 2)),
      Number(timeStr.slice(3, 5)),
      0,
    );
    guess += desired - asLocal;
  }
  return new Date(guess);
}

function sunSample(
  when: Date,
  lat: number,
  lon: number,
  seat: { x: number; y: number; z: number },
  towerBlocksWest: boolean,
  occluders: ModeledGeometryManifest["occluders"] = [],
): ShadeSample {
  const pos = SunCalc.getPosition(when, lat, lon);
  // SunCalc v2 returns degrees: altitude above the horizon and azimuth clockwise from north.
  const altitudeDeg = pos.altitude;
  const azimuthDeg = ((pos.azimuth % 360) + 360) % 360;
  const sunAboveHorizon = altitudeDeg > 0;

  // Coarse modeled shade: west suite tower blocks low western sun for seats with x < -20.
  const sunFromWest = azimuthDeg > 200 && azimuthDeg < 340;
  const lowSun = altitudeDeg > 0 && altitudeDeg < 35;
  const inTowerShade = towerBlocksWest && seat.x < -20 && sunFromWest && lowSun;
  let blockingObject: string | undefined;
  if (sunAboveHorizon && occluders.length) {
    const direction = sunDirectionVector(altitudeDeg, azimuthDeg);
    const origin = { x: seat.x, y: seat.y, z: seat.z };
    for (const occluder of occluders) {
      if (rayHitsBounds(origin, direction, occluder.bounds)) {
        blockingObject = occluder.category;
        break;
      }
    }
  }
  const inDirectSun = sunAboveHorizon && !inTowerShade && !blockingObject;

  return {
    timeIso: when.toISOString(),
    altitudeDeg,
    azimuthDeg,
    sunAboveHorizon,
    inDirectSun,
    status: "modeled",
    sourceIds: ["shade-engine", "suncalc-v2"],
    ...(blockingObject ? { occluder: blockingObject } : {}),
  };
}

function rayHitsBounds(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  bounds: ModeledGeometryManifest["occluders"][number]["bounds"],
): boolean {
  let tMin = 0.01;
  let tMax = 350;
  for (const [axis, min, max] of [
    ["x", bounds.min[0], bounds.max[0]],
    ["y", bounds.min[1], bounds.max[1]],
    ["z", bounds.min[2], bounds.max[2]],
  ] as const) {
    const delta = direction[axis];
    if (Math.abs(delta) < 1e-8) {
      if (origin[axis] < min || origin[axis] > max) return false;
      continue;
    }
    const a = (min - origin[axis]) / delta;
    const b = (max - origin[axis]) / delta;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
    if (tMin > tMax) return false;
  }
  return tMax > 0.01;
}

export function computeShadeReport(args: {
  latitude: number;
  longitude: number;
  dateStr: string;
  kickoffLocal: string;
  durationHours: number;
  seatX: number;
  seatY?: number;
  seatZ: number;
  timeZone?: string;
  occluders?: ModeledGeometryManifest["occluders"];
  suiteTowerVisible?: boolean;
}): ShadeReport {
  const tz = args.timeZone ?? "America/Los_Angeles";
  const kickoff = zonedLocalToUtc(args.dateStr, args.kickoffLocal, tz);
  const start = new Date(kickoff.getTime() - 2 * 3600_000);
  const end = new Date(kickoff.getTime() + (args.durationHours + 1) * 3600_000);

  const timeline: ShadeSample[] = [];
  let direct = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 15 * 60_000) {
    const sample = sunSample(
      new Date(t),
      args.latitude,
      args.longitude,
      { x: args.seatX, y: args.seatY ?? 1.2, z: args.seatZ },
      args.suiteTowerVisible ?? true,
      args.occluders ?? [],
    );
    timeline.push(sample);
    if (sample.inDirectSun) direct += 15;
  }

  const kickoffSample = sunSample(
    kickoff,
    args.latitude,
    args.longitude,
    { x: args.seatX, y: args.seatY ?? 1.2, z: args.seatZ },
    args.suiteTowerVisible ?? true,
    args.occluders ?? [],
  );

  return {
    kickoff: kickoffSample,
    timeline,
    directSunMinutes: provenanced(direct, "modeled", ["shade-engine", tz], MODELED_DISCLAIMER),
    note: "Never guaranteed shaded. Modeled from solar position and coarse occluder approximation.",
  };
}

export function sunDirectionVector(altitudeDeg: number, azimuthDeg: number): {
  x: number;
  y: number;
  z: number;
} {
  const alt = (altitudeDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  // Three.js: +X east, +Z south-ish in our field frame — map az from north clockwise.
  const x = Math.sin(az) * Math.cos(alt);
  const y = Math.sin(alt);
  const z = -Math.cos(az) * Math.cos(alt);
  return { x, y, z };
}
