import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSavedSettings } from './SettingsContext';
import { DEFAULT_SHOWN_VENDORS } from '../services/intelligence/vendorFilter';
import { SETTINGS_DEFAULTS_VERSION } from '../services/settingsMigrations';
import type { UserSettings } from '../types';

const save = (over: Record<string, unknown>) => ({ ...DEFAULT_SETTINGS, defaultsVersion: SETTINGS_DEFAULTS_VERSION, ...over }) as unknown as UserSettings;

describe('loadSavedSettings', () => {
  it('a current save with the TV and layout fields missing gets the new defaults', () => {
    const saved = save({});
    for (const k of ['clusteringEnabled', 'sectionsEnabled', 'tvTileSize', 'tvAnimationSpeed', 'tvIntervalSeconds']) delete (saved as unknown as Record<string, unknown>)[k];
    expect(loadSavedSettings(saved)).toMatchObject({
      clusteringEnabled: false, sectionsEnabled: false, tvTileSize: 'xsmall', tvAnimationSpeed: 'slow', tvIntervalSeconds: 30,
    });
  });

  it('a pre-migration save with nothing hidden gets the curated vendors', () => {
    const saved = save({ defaultsVersion: undefined });
    delete (saved as unknown as Record<string, unknown>).shownVulnVendors;
    expect(loadSavedSettings(saved).shownVulnVendors).toEqual(DEFAULT_SHOWN_VENDORS);
  });

  it('a pre-migration save with hidden vendors stays in legacy mode', () => {
    const out = loadSavedSettings(save({ defaultsVersion: undefined, hiddenVulnVendors: ['Acme'], shownVulnVendors: undefined }));
    expect(out.shownVulnVendors).toBeNull();
    expect(out.hiddenVulnVendors).toEqual(['Acme']);
  });

  it('a current save keeps its own allow-list and drops a garbage one', () => {
    expect(loadSavedSettings(save({ shownVulnVendors: ['Acme', 5] })).shownVulnVendors).toEqual(['Acme']);
    expect(loadSavedSettings(save({ shownVulnVendors: 'x' })).shownVulnVendors).toBeNull();
  });
});
