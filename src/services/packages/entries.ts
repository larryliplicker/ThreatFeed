import { formatPackageEntry, parsePackageEntry } from '../npm/semver';
import { ECOSYSTEMS, type Ecosystem } from './ecosystems';

export interface EcoEntry {
  ecosystem: Ecosystem;
  name: string;
  version?: string;
}

const MAX_ENTRIES = 500;
const MAX_NAME = 256;
const MAX_VERSION = 100;

const PREFIXES = new Map<string, Ecosystem>();
for (const [eco, info] of Object.entries(ECOSYSTEMS) as [Ecosystem, (typeof ECOSYSTEMS)[Ecosystem]][]) {
  for (const p of info.prefixes) PREFIXES.set(p, eco);
}

const PART = '[A-Za-z0-9_][A-Za-z0-9._-]*';
const NAME_RULES: Record<Exclude<Ecosystem, 'npm'>, (name: string) => boolean> = {
  pypi: n => /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(n),
  // group:artifact, exactly one colon
  maven: n => new RegExp(`^${PART}:${PART}$`).test(n),
  // a module path: has a slash or a dot
  go: n => /^[A-Za-z0-9._~/-]+$/.test(n) && /[./]/.test(n),
  nuget: n => new RegExp(`^${PART}$`).test(n),
  cargo: n => /^[A-Za-z][A-Za-z0-9_-]*$/.test(n),
};

/** Syntactic only (non-empty, no whitespace); each ecosystem's version module judges the rest */
function versionOk(eco: Ecosystem, v: string): boolean {
  if (!v || v.length > MAX_VERSION || /\s/.test(v)) return false;
  return eco !== 'go' || v.startsWith('v');
}

/** `[prefix:]name[@version]` for any ecosystem; no known prefix means npm. Null when invalid. */
export function parseEntry(s: string): EcoEntry | null {
  const input = s.trim();
  const colon = input.indexOf(':');
  const eco = colon > 0 ? PREFIXES.get(input.slice(0, colon).toLowerCase()) : undefined;
  if (!eco) {
    const npm = parsePackageEntry(input);
    return npm ? { ecosystem: 'npm', ...npm } : null;
  }
  const rest = input.slice(colon + 1);
  const at = rest.lastIndexOf('@');
  const name = at > 0 ? rest.slice(0, at) : rest;
  if (name.length > MAX_NAME || !NAME_RULES[eco as Exclude<Ecosystem, 'npm'>](name)) return null;
  if (at < 0) return { ecosystem: eco, name };
  const version = rest.slice(at + 1);
  return versionOk(eco, version) ? { ecosystem: eco, name, version } : null;
}

/** The stored spelling: npm without a prefix, the others with the canonical prefix */
export function formatEntry(e: EcoEntry): string {
  if (e.ecosystem === 'npm') return formatPackageEntry(e);
  const base = `${ECOSYSTEMS[e.ecosystem].prefixes[0]}:${e.name}`;
  return e.version ? `${base}@${e.version}` : base;
}

/** The name as matching compares it */
export function normalizeName(eco: Ecosystem, name: string): string {
  switch (eco) {
    case 'npm':
    case 'nuget':
      return name.toLowerCase();
    case 'pypi':
      return name.toLowerCase().replace(/[-_.]+/g, '-');
    case 'cargo':
      return name.replace(/_/g, '-');
    default:
      return name;
  }
}

/** Identity of an entry for deduplication: same ecosystem, normalised name and version */
export function entryKey(e: EcoEntry): string {
  return `${e.ecosystem}:${normalizeName(e.ecosystem, e.name)}${e.version ? `@${e.version}` : ''}`;
}

/** Splits entries into the npm list and the prefixed list for the other ecosystems. Invalid entries and duplicates are dropped. */
export function splitEntries(input: string[]): { npm: string[]; other: string[] } {
  const seen = new Set<string>();
  const out = { npm: [] as string[], other: [] as string[] };
  for (const raw of input) {
    const entry = typeof raw === 'string' ? parseEntry(raw) : null;
    if (!entry) continue;
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    (entry.ecosystem === 'npm' ? out.npm : out.other).push(formatEntry(entry));
  }
  return out;
}

/** A stored, imported or synced `ecosystemPackages` value (untrusted): valid, deduplicated, non-npm entries, at most 500 */
export function cleanEcosystemList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return splitEntries(raw).other.slice(0, MAX_ENTRIES);
}

/**
 * The key of a watched entry in match results, OSV answers and alert keys: an npm entry as it always was
 * (`name@version`), the others with their prefix (`pypi:name@version`). An entry without an ecosystem is npm.
 */
export function watchKey(e: { ecosystem?: Ecosystem; name: string; version?: string }): string {
  return formatEntry({ ecosystem: e.ecosystem ?? 'npm', name: e.name, ...(e.version ? { version: e.version } : {}) });
}
