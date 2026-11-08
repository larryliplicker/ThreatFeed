import type { UserSettings } from '../../types';

/** The vendors shown on the Vulnerabilities page by default, spelled as in the CISA KEV catalog's vendorProject */
export const DEFAULT_SHOWN_VENDORS: string[] = [
  'Microsoft', 'Apple', 'Google', 'Cisco', 'Fortinet', 'Ivanti', 'Palo Alto Networks', 'VMware', 'Citrix', 'Adobe',
  'Oracle', 'Apache', 'Linux', 'Mozilla', 'SAP', 'Atlassian', 'Juniper', 'F5', 'SonicWall', 'Progress', 'Zyxel',
  'Samsung', 'Broadcom', 'Check Point', 'Veeam',
];

type VendorFilterSettings = Pick<UserSettings, 'shownVulnVendors' | 'hiddenVulnVendors'>;

/** With an allow-list only its vendors show; with null (legacy mode) every vendor shows except the hidden ones */
export function vendorVisible(vendor: string, s: VendorFilterSettings): boolean {
  return s.shownVulnVendors ? s.shownVulnVendors.includes(vendor) : !s.hiddenVulnVendors.includes(vendor);
}

/** Validates a saved or imported allow-list: strings only, de-duplicated; anything that is not an array means legacy mode (null) */
export function cleanShownVendors(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((x): x is string => typeof x === 'string'))];
}

/** Untouched installs (nothing hidden) get the curated list; a user who hid vendors keeps their own filter (legacy mode) */
export function migrateVendorFilter(saved: Pick<UserSettings, 'hiddenVulnVendors'>): { shownVulnVendors: string[] | null } {
  return { shownVulnVendors: saved.hiddenVulnVendors.length === 0 ? [...DEFAULT_SHOWN_VENDORS] : null };
}

/** The settings change that shows or hides one vendor in the active mode (the allow-list, or the hidden list in legacy mode) */
export function setVendorShown(s: VendorFilterSettings, vendor: string, show: boolean): Partial<Pick<UserSettings, 'shownVulnVendors' | 'hiddenVulnVendors'>> {
  if (s.shownVulnVendors) {
    const rest = s.shownVulnVendors.filter(v => v !== vendor);
    return { shownVulnVendors: show ? [...rest, vendor] : rest };
  }
  const rest = s.hiddenVulnVendors.filter(v => v !== vendor);
  return { hiddenVulnVendors: show ? rest : [...rest, vendor] };
}
