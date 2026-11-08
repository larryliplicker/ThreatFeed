import type { UserSettings } from '../types';
import { DEFAULT_WATCHLIST_KEYWORDS, WATCHLIST_V2_DEFAULTS } from './intelligence/watchlist';

/**
 * Version of the "changed defaults" migrations below. Bump it when adding a step. A step moves only settings that
 * are still exactly at the old default; anything the user changed is kept.
 */
export const SETTINGS_DEFAULTS_VERSION = 1;

type Step = (s: UserSettings) => UserSettings;

/** Case-insensitive, order-free list comparison */
function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  const norm = (list: readonly string[]) => new Set(list.map(t => t.trim().toLowerCase()));
  const x = norm(a);
  const y = norm(b);
  return x.size === y.size && [...x].every(t => y.has(t));
}

/** Built-in rules that used to start enabled and now start disabled so My Feed is empty by default */
const STARTS_DISABLED = ['watchlist', 'stack-news', 'stack-vulns', 'watched-cves'];

/** Version 1: TV 60 s / Medium / Fast -> 30 s / X-Small / Slow; sections and clustering off; untouched built-ins off; watchlist trimmed */
const toVersion1: Step = (s) => ({
  ...s,
  tvIntervalSeconds: s.tvIntervalSeconds === 60 ? 30 : s.tvIntervalSeconds,
  tvTileSize: s.tvTileSize === 'medium' ? 'xsmall' : s.tvTileSize,
  tvAnimationSpeed: s.tvAnimationSpeed === 'fast' ? 'slow' : s.tvAnimationSpeed,
  sectionsEnabled: s.sectionsEnabled === true ? false : s.sectionsEnabled,
  clusteringEnabled: s.clusteringEnabled === true ? false : s.clusteringEnabled,
  // "Untouched" = never saved from the editor (toggling in the list leaves updatedAt alone, but every built-in started
  // enabled, so a toggled one is already off). A rule with notifications on was chosen by the user (they start off), so it stays.
  alertRules: s.alertRules.map(r =>
    r.builtIn && STARTS_DISABLED.includes(r.builtIn) && r.updatedAt === r.createdAt && !r.notify ? { ...r, enabled: false } : r
  ),
  watchlistKeywords: sameTerms(s.watchlistKeywords, WATCHLIST_V2_DEFAULTS) ? [...DEFAULT_WATCHLIST_KEYWORDS] : s.watchlistKeywords,
});

/** Steps in order; step N runs when the saved version is below N. Add the next one here and bump SETTINGS_DEFAULTS_VERSION. */
const STEPS: Step[] = [toVersion1];

/**
 * Brings settings saved at `savedVersion` (0 when unknown: old installs, backups without the field) up to the current
 * defaults. Pure: returns the same object when there is nothing to do.
 */
export function migrateDefaults(saved: UserSettings, savedVersion: number): UserSettings {
  if (savedVersion >= SETTINGS_DEFAULTS_VERSION) return saved;
  const from = Number.isFinite(savedVersion) ? Math.max(0, Math.floor(savedVersion)) : 0;
  const migrated = STEPS.slice(from).reduce((s, step) => step(s), saved);
  return { ...migrated, defaultsVersion: SETTINGS_DEFAULTS_VERSION };
}
