import { describe, expect, it } from 'vitest';
import vulnsRaw from '../../../public/data/vulns.json?raw';
import { DEFAULT_SHOWN_VENDORS, cleanShownVendors, migrateVendorFilter, setVendorShown, vendorVisible } from './vendorFilter';

describe('vendorVisible', () => {
  it('allow-list mode shows only listed vendors', () => {
    const s = { shownVulnVendors: ['Microsoft'], hiddenVulnVendors: [] };
    expect(vendorVisible('Microsoft', s)).toBe(true);
    expect(vendorVisible('Acme', s)).toBe(false);
  });
  it('legacy mode shows everything except hidden', () => {
    const s = { shownVulnVendors: null, hiddenVulnVendors: ['Acme'] };
    expect(vendorVisible('Acme', s)).toBe(false);
    expect(vendorVisible('Microsoft', s)).toBe(true);
  });
});

describe('setVendorShown', () => {
  it('edits the allow-list in allow-list mode', () => {
    const s = { shownVulnVendors: ['A', 'B'], hiddenVulnVendors: [] };
    expect(setVendorShown(s, 'A', false)).toEqual({ shownVulnVendors: ['B'] });
    expect(setVendorShown(s, 'C', true)).toEqual({ shownVulnVendors: ['A', 'B', 'C'] });
  });
  it('edits the hidden list in legacy mode', () => {
    const s = { shownVulnVendors: null, hiddenVulnVendors: ['A'] };
    expect(setVendorShown(s, 'B', false)).toEqual({ hiddenVulnVendors: ['A', 'B'] });
    expect(setVendorShown(s, 'A', true)).toEqual({ hiddenVulnVendors: [] });
  });
});

describe('migrateVendorFilter', () => {
  it('empty hidden list gets the curated list', () => {
    expect(migrateVendorFilter({ hiddenVulnVendors: [] }).shownVulnVendors).toEqual(DEFAULT_SHOWN_VENDORS);
  });
  it('a user who hid vendors stays in legacy mode', () => {
    expect(migrateVendorFilter({ hiddenVulnVendors: ['Acme'] }).shownVulnVendors).toBeNull();
  });
});

describe('cleanShownVendors', () => {
  it('backup without shownVulnVendors imports as legacy null', () => expect(cleanShownVendors(undefined)).toBeNull());
  it('garbage shownVulnVendors is dropped', () => {
    expect(cleanShownVendors('Microsoft')).toBeNull();
    expect(cleanShownVendors({})).toBeNull();
    expect(cleanShownVendors(['A', 3, null, 'A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('DEFAULT_SHOWN_VENDORS', () => {
  it('has 25 names, each spelled as in the KEV catalog snapshot', () => {
    expect(DEFAULT_SHOWN_VENDORS).toHaveLength(25);
    const kev = new Set<string>((JSON.parse(vulnsRaw).kev as { vendor: string }[]).map(k => k.vendor));
    expect(DEFAULT_SHOWN_VENDORS.filter(v => !kev.has(v))).toEqual([]);
  });
});
