/**
 * storage.ts — keeps setup answers on this device so people can come back.
 * Browser storage can be missing or blocked (private windows, previews), so
 * every access is guarded and the app works the same without it.
 */

import { CONFIGURED_TAX_YEARS } from "../engine-src/index";
import type { HouseholdInputs } from "../engine-src/index";
import type { Mode, SetupMeta, StepId } from "./model";

const KEY = "childcare-tax-check:v1";

export interface SavedSession {
  inputs: HouseholdInputs;
  meta: SetupMeta;
  step: StepId;
  mode: Exclude<Mode, "landing">;
  savedAt: string;
}

export function loadSession(): SavedSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    if (!s?.inputs?.parentA || !Array.isArray(s.inputs.children) || !s.meta || !s.step || !s.mode) return null;
    if (!(CONFIGURED_TAX_YEARS as readonly string[]).includes(s.inputs.taxYear)) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Omit<SavedSession, "savedAt">): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: new Date().toISOString() }));
  } catch {
    // Storage unavailable: answers just aren't kept between visits.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
