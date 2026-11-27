import type { Coordinates, DistanceUnit, MeasurementKind } from "./distance";

/**
 * The unsaved circle, kept for this tab only so it survives the round trip
 * through sign-in. Not the retired `austingarrod.utilities.radius-map.v1`
 * library key, which must stay untouched.
 */
export const DRAFT_KEY = "austingarrod.utilities.radius-map.draft.v1";

export interface RadiusDraft {
  center: Coordinates | null;
  centerLabel: string;
  /** The distance exactly as typed. */
  value: string;
  kind: MeasurementKind;
  unit: DistanceUnit;
  /** The visitor asked to save and left to sign in. */
  pendingSave: boolean;
}

type StorageSource = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

const sessionSource: StorageSource = () => window.sessionStorage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDraft(raw: string | null): RadiusDraft | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value)) return null;
  const { center, centerLabel, kind, unit, pendingSave } = value;
  const typed = value.value;
  if (kind !== "radius" && kind !== "diameter") return null;
  if (unit !== "km" && unit !== "mi") return null;
  if (typeof typed !== "string" || typed.length > 32) return null;
  if (typeof centerLabel !== "string" || centerLabel.length > 240) return null;
  let point: Coordinates | null = null;
  if (center !== null) {
    if (!isRecord(center)) return null;
    const lat = Number(center.lat), lng = Number(center.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    point = { lat, lng };
  }
  return { center: point, centerLabel: point ? centerLabel : "", value: typed, kind, unit, pendingSave: pendingSave === true };
}

export function readDraft(source: StorageSource = sessionSource): RadiusDraft | null {
  try { return parseDraft(source().getItem(DRAFT_KEY)); } catch { return null; }
}

export function writeDraft(draft: RadiusDraft, source: StorageSource = sessionSource): void {
  try { source().setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* Storage can be unavailable; the draft then lasts for this page only. */ }
}

export function forgetDraft(source: StorageSource = sessionSource): void {
  try { source().removeItem(DRAFT_KEY); } catch { /* Nothing to forget when storage is unavailable. */ }
}
