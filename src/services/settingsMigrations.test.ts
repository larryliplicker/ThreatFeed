import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../context/SettingsContext';
import type { UserSettings } from '../types';
import { createBuiltInRules } from './intelligence/alertRules';
import { DEFAULT_WATCHLIST_KEYWORDS, WATCHLIST_V2_DEFAULTS } from './intelligence/watchlist';
import { DEFAULT_SHOWN_VENDORS } from './intelligence/vendorFilter';
import feedsFile from '../../public/data/feeds.json';
import { DEFAULT_DISABLED_CATEGORIES, SETTINGS_DEFAULTS_VERSION, migrateDefaults } from './settingsMigrations';

const T = new Date('2026-10-01T00:00:00Z');

/** An install from before this migration: every value at the old default */
function oldInstall(over: Partial<UserSettings> = {}): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    tvIntervalSeconds: 60,
    tvTileSize: 'medium',
    tvAnimationSpeed: 'fast',
    sectionsEnabled: true,
    clusteringEnabled: true,
    alertRules: createBuiltInRules(false, T).map(r => ({ ...r, enabled: true })),
    watchlistKeywords: [...WATCHLIST_V2_DEFAULTS],
    defaultsVersion: undefined as unknown as number,
    ...over,
  };
}

const enabledOf = (s: UserSettings) => Object.fromEntries(s.alertRules.map(r => [r.builtIn, r.enabled]));

describe('migrateDefaults', () => {
  it('untouched install moves to new defaults', () => {
    const out = migrateDefaults(oldInstall(), 0);
    expect(out).toMatchObject({
      tvIntervalSeconds: 30, tvTileSize: 'xsmall', tvAnimationSpeed: 'slow', sectionsEnabled: false, clusteringEnabled: false,
      defaultsVersion: SETTINGS_DEFAULTS_VERSION,
    });
    expect(enabledOf(out)).toEqual({
      'watchlist': false, 'stack-news': false, 'stack-vulns': false, 'watched-cves': false, 'npm-packages': true,
    });
  });

  it('changed values are kept', () => {
    const out = migrateDefaults(oldInstall({ tvIntervalSeconds: 120, tvTileSize: 'large', tvAnimationSpeed: 'medium' }), 0);
    expect(out).toMatchObject({ tvIntervalSeconds: 120, tvTileSize: 'large', tvAnimationSpeed: 'medium' });
    // sectionsEnabled true is the old default, so it moves; a user who had turned them off is not touched
    expect(migrateDefaults(oldInstall({ sectionsEnabled: false, clusteringEnabled: false }), 0)).toMatchObject({ sectionsEnabled: false, clusteringEnabled: false });
  });

  it('edited built-in stays enabled', () => {
    const rules = oldInstall().alertRules.map(r => (r.builtIn === 'stack-vulns' ? { ...r, updatedAt: '2026-10-05T00:00:00.000Z' } : r));
    const out = migrateDefaults(oldInstall({ alertRules: rules }), 0);
    expect(enabledOf(out)).toMatchObject({ 'stack-vulns': true, 'watchlist': false });
  });

  it('keeps a built-in the user switched off and custom rules', () => {
    const custom = { id: 'c', name: 'c', kind: 'vulns' as const, enabled: true, notify: false, root: { op: 'all' as const, items: [{ field: 'kev' as const }] }, createdAt: 't', updatedAt: 't' };
    const rules = [...oldInstall().alertRules.map(r => (r.builtIn === 'watchlist' ? { ...r, enabled: false, notify: true } : r)), custom];
    const out = migrateDefaults(oldInstall({ alertRules: rules }), 0);
    expect(out.alertRules.find(r => r.builtIn === 'watchlist')).toMatchObject({ enabled: false, notify: true });
    expect(out.alertRules.find(r => r.id === 'c')).toEqual(custom);
  });

  it('built-in with notifications on stays enabled', () => {
    const rules = oldInstall().alertRules.map(r => (r.builtIn === 'watched-cves' ? { ...r, notify: true } : r));
    expect(enabledOf(migrateDefaults(oldInstall({ alertRules: rules }), 0))).toMatchObject({ 'watched-cves': true, 'watchlist': false });
  });

  it('default watchlist is trimmed', () => {
    const shuffled = [...WATCHLIST_V2_DEFAULTS].reverse().map(t => t.toUpperCase());
    const out = migrateDefaults(oldInstall({ watchlistKeywords: shuffled }), 0);
    expect(out.watchlistKeywords).toEqual(DEFAULT_WATCHLIST_KEYWORDS);
    expect(out.watchlistKeywords).toHaveLength(21);
  });

  it('custom watchlist is kept', () => {
    const custom = [...WATCHLIST_V2_DEFAULTS, 'MyVendor'];
    expect(migrateDefaults(oldInstall({ watchlistKeywords: custom }), 0).watchlistKeywords).toEqual(custom);
    const removed = WATCHLIST_V2_DEFAULTS.filter(t => t !== 'Cisco');
    expect(migrateDefaults(oldInstall({ watchlistKeywords: removed }), 0).watchlistKeywords).toEqual(removed);
  });

  it('already migrated is a no-op', () => {
    const s = oldInstall({ defaultsVersion: SETTINGS_DEFAULTS_VERSION });
    expect(migrateDefaults(s, SETTINGS_DEFAULTS_VERSION)).toBe(s);
  });

  it('treats a bad version as 0', () => {
    expect(migrateDefaults(oldInstall(), NaN).tvIntervalSeconds).toBe(30);
  });

  it('untouched vendor filter moves to the curated allow-list', () => {
    expect(migrateDefaults(oldInstall({ shownVulnVendors: null }), 0).shownVulnVendors).toEqual(DEFAULT_SHOWN_VENDORS);
  });

  it('hidden vendors keep the legacy filter', () => {
    const out = migrateDefaults(oldInstall({ shownVulnVendors: null, hiddenVulnVendors: ['Acme'] }), 0);
    expect(out.shownVulnVendors).toBeNull();
    expect(out.hiddenVulnVendors).toEqual(['Acme']);
  });
});

describe('categories off by default', () => {
  const feedCategories = new Set<string>(
    (feedsFile.feeds as { category: string }[]).map(f => f.category)
  );

  it('new installs turn the three categories off', () => {
    expect(DEFAULT_SETTINGS.disabledCategories).toEqual(['Consumer Tech', 'Swedish (Feber)', 'Tech Guides & How-To']);
    expect(DEFAULT_SETTINGS.frontPageHiddenCategories).toEqual([]);
  });

  it('empty disabledCategories migrates to the default', () => {
    expect(migrateDefaults(oldInstall({ disabledCategories: [] }), 0).disabledCategories).toEqual(DEFAULT_DISABLED_CATEGORIES);
  });

  it('a changed disabledCategories is kept', () => {
    expect(migrateDefaults(oldInstall({ disabledCategories: ['Malware'] }), 0).disabledCategories).toEqual(['Malware']);
  });

  it('the default names exist in feeds.json', () => {
    for (const c of DEFAULT_DISABLED_CATEGORIES) expect(feedCategories.has(c)).toBe(true);
  });

  it('the "at least one category stays on" rule still holds', () => {
    // The settings page disables the last remaining toggle (IntelligenceSettings); the default must leave some on
    expect([...feedCategories].filter(c => !DEFAULT_DISABLED_CATEGORIES.includes(c)).length).toBeGreaterThan(0);
  });
});
