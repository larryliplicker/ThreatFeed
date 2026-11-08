// Matching watched packages of every ecosystem against the published advisory data (and OSV, when that is on). A
// wrong "not affected" is the worst outcome: a range that can't be read makes the package unknown, a missing fix
// leaves the minimum safe version unset, an ecosystem whose file is missing gives "unknown" ("no data"), and anything
// OSV reports as affecting is taken as affecting. npm is matched exactly as before the other ecosystems existed.

import { NPM_MALWARE_DAYS, type NpmAdvisory, type NpmAdvisoryData, type NpmMalwareData } from './advisories';
import type { OsvResult } from './osv';
import { compareVersions, parseGhsaRange, parseVersion, type PackageEntry, type Version } from './semver';
import type { Ecosystem } from '../packages/ecosystems';
import { normalizeName, watchKey } from '../packages/entries';
import { rulesFor } from '../packages/versions';

export type PackageStatus = 'affected' | 'not-affected' | 'no-version' | 'unknown';
export type Severity = NpmAdvisory['severity'];

/** A watched entry; one without an ecosystem is npm */
export type WatchedEntry = PackageEntry & { ecosystem?: Ecosystem };

/** The loaded advisory files by ecosystem; a missing one means its entries can't be matched */
export type AdvisoriesByEcosystem = Partial<Record<Ecosystem, NpmAdvisoryData>>;

export interface MatchedAdvisory {
  id: string;
  severity: Severity;
  summary?: string;
  vulnerable: string; // the range that matched, or all the package's ranges joined with " || "
  patched?: string;
  source: 'ghsa' | 'osv';
  malware?: boolean;
  unparsed?: boolean; // a range couldn't be read, so the entry may be affected
}

export interface PackageResult {
  ecosystem: Ecosystem;
  entry: PackageEntry; // name and version as watched, without the ecosystem prefix
  status: PackageStatus;
  reason?: 'no data'; // with status unknown: the ecosystem's advisory file is missing or failed to load
  advisories: MatchedAdvisory[];
  minSafeVersion?: string;
  highestSeverity?: Severity;
  malware: boolean;
  malwareCheckedDays: number | null; // the malware window checked, null when the malware file isn't loaded (and outside npm)
  osv: 'checked' | 'unavailable' | 'off';
}

interface Range { vulnerable: string; patched?: string }

/** One advisory as it applies to one package */
interface Candidate { id: string; severity: Severity; summary?: string; ranges: Range[]; malware: boolean }

/** An ecosystem's version rules as matching uses them; versions are opaque and only go back into the same rules */
interface Rules {
  parse(text: string): unknown | null;
  compare(a: unknown, b: unknown): number;
  range(range: string): ((v: unknown) => boolean) | null;
  /** The minimum safe version as shown, when the advisory spelling differs from the one users write */
  display?(text: string): string;
}

// npm keeps the functions it always used, so its results cannot drift
const NPM_RULES: Rules = {
  parse: parseVersion,
  compare: (a, b) => compareVersions(a as Version, b as Version),
  range: (range) => {
    const t = parseGhsaRange(range);
    return t && ((v) => t(v as Version));
  },
};
const ruleCache = new Map<Ecosystem, Rules>([['npm', NPM_RULES]]);
function rulesOf(eco: Ecosystem): Rules {
  let r = ruleCache.get(eco);
  if (!r) {
    const v = rulesFor(eco);
    r = { parse: v.parse, compare: v.compare, range: v.ghsaRange };
    // Go advisories write fixed versions without the "v" ("0.17.0") that go.mod needs: read both, show it with the "v"
    if (eco === 'go') r = { ...r, parse: (t) => v.parse(t) ?? v.parse(`v${t}`), display: (t) => (t.startsWith('v') ? t : `v${t}`) };
    ruleCache.set(eco, r);
  }
  return r;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
const rank = (s: Severity | undefined) => (s ? SEVERITY_RANK[s] : 5);

/** The highest of the versions, or undefined when one is missing or unreadable (no fix, no safe version) */
function highestVersion(rules: Rules, versions: (string | undefined)[]): string | undefined {
  let best: { text: string; v: unknown } | undefined;
  for (const text of versions) {
    const v = text ? rules.parse(text) : null;
    if (!text || v === null) return undefined;
    if (!best || rules.compare(v, best.v) > 0) best = { text, v };
  }
  return best?.text;
}

/** The range shown for an OSV vulnerability whose details weren't fetched: OSV reported it, without ranges */
export const OSV_ONLY_RANGE = 'per OSV';

const joined = (ranges: Range[]) => ranges.map(r => r.vulnerable).join(' || ');

type RangePick = (ranges: Range[], v: unknown) => Range | 'unparsed' | null;

/**
 * The first of the package's fixed versions, from `from` up, that no range of the package covers or might
 * cover (an unreadable range): a fix for one advisory can still sit inside another. Undefined when none is clear.
 */
function safeVersion(rules: Rules, from: string | undefined, candidates: Candidate[], pick: RangePick): string | undefined {
  const start = from ? rules.parse(from) : null;
  if (start === null) return undefined;
  const fixes = new Map<string, unknown>();
  for (const c of candidates) {
    for (const r of c.ranges) {
      const v = r.patched ? rules.parse(r.patched) : null;
      if (r.patched && v !== null && rules.compare(v, start) >= 0) fixes.set(r.patched, v);
    }
  }
  fixes.set(from!, start);
  const ranges = candidates.flatMap(c => c.ranges);
  return [...fixes].sort((a, b) => rules.compare(a[1], b[1])).find(([, v]) => pick(ranges, v) === null)?.[0];
}

const isSingle = (data: NpmAdvisoryData | AdvisoriesByEcosystem): data is NpmAdvisoryData => Array.isArray((data as NpmAdvisoryData).index);

/** The ids of our own data (every loaded ecosystem), which the OSV lookup doesn't need details for */
export function knownAdvisoryIds(data: NpmAdvisoryData | AdvisoriesByEcosystem, malware: NpmMalwareData | null): Set<string> {
  const files = isSingle(data) ? [data] : Object.values(data).filter((d): d is NpmAdvisoryData => Boolean(d));
  return new Set([...files.flatMap(d => d.index.map(e => e[0])), ...(malware?.entries ?? []).map(m => m[0])]);
}

/** One ecosystem's advisories by normalised package name, with its range reader */
interface EcoIndex {
  withdrawn: Set<string>;
  candidates(name: string): Candidate[];
  pick: RangePick;
}

function buildIndex(eco: Ecosystem, data: NpmAdvisoryData | undefined, malware: NpmMalwareData | null, rules: Rules): EcoIndex {
  const summaries = new Map(data?.recent.map(a => [a.id, a.summary]));
  const withdrawn = new Set<string>();
  const byPackage = new Map<string, Map<string, Candidate>>();
  // Names compare normalised on both sides; for npm that is lowercase, as some advisories spell them otherwise ("Electron")
  const add = (pkg: string, c: Omit<Candidate, 'ranges'>, range: Range) => {
    const name = normalizeName(eco, pkg);
    let forPkg = byPackage.get(name);
    if (!forPkg) byPackage.set(name, (forPkg = new Map()));
    const existing = forPkg.get(c.id);
    if (existing) existing.ranges.push(range);
    else forPkg.set(c.id, { ...c, ranges: [range] });
  };
  for (const [id, severity, ranges, isWithdrawn] of data?.index ?? []) {
    if (isWithdrawn) { withdrawn.add(id); continue; }
    const summary = summaries.get(id);
    for (const [pkg, vulnerable, patched] of ranges) {
      add(pkg, { id, severity, summary, malware: false }, patched ? { vulnerable, patched } : { vulnerable });
    }
  }
  for (const [id, pkg, vulnerable] of malware?.entries ?? []) {
    add(pkg, { id, severity: 'critical', malware: true }, { vulnerable });
  }

  const parsed = new Map<string, ((v: unknown) => boolean) | null>();
  const test = (range: string) => {
    if (!parsed.has(range)) parsed.set(range, rules.range(range));
    return parsed.get(range)!;
  };
  /** The first range containing the version; 'unparsed' when none does but one couldn't be read */
  const pick: RangePick = (ranges, v) => {
    let unreadable = false;
    for (const r of ranges) {
      const t = test(r.vulnerable);
      if (!t) unreadable = true;
      else if (t(v)) return r;
    }
    return unreadable ? 'unparsed' : null;
  };
  return { withdrawn, candidates: (name) => [...(byPackage.get(normalizeName(eco, name))?.values() ?? [])], pick };
}

/**
 * Each distinct entry's status against the reviewed advisory index of its ecosystem and, for npm, the malware
 * list, plus OSV's results when given (undefined: OSV off; null: the lookup failed). `data` is the npm file alone
 * or the loaded files by ecosystem; an entry whose ecosystem has no file is unknown with the reason "no data"
 * (OSV can still show it affected). Withdrawn advisories never match. Ordered malware first, then by highest
 * severity, then by name.
 */
export function matchPackages(
  entries: WatchedEntry[],
  data: NpmAdvisoryData | AdvisoriesByEcosystem,
  malware: NpmMalwareData | null,
  osv?: Map<string, OsvResult> | null,
): PackageResult[] {
  const files: AdvisoriesByEcosystem = isSingle(data) ? { npm: data } : data;
  const indexes = new Map<Ecosystem, EcoIndex>();
  const indexOf = (eco: Ecosystem) => {
    let index = indexes.get(eco);
    if (!index) indexes.set(eco, (index = buildIndex(eco, files[eco], eco === 'npm' ? malware : null, rulesOf(eco))));
    return index;
  };

  const seen = new Set<string>();
  const results: PackageResult[] = [];
  for (const entry of entries) {
    const eco = entry.ecosystem ?? 'npm';
    const key = watchKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const rules = rulesOf(eco);
    const { withdrawn, pick, candidates: candidatesOf } = indexOf(eco);
    const noData = !files[eco];

    const matched = (c: Candidate, source: MatchedAdvisory['source'], range: Range | null, unparsed = false): MatchedAdvisory => {
      const vulnerable = range ? range.vulnerable : c.ranges.length ? joined(c.ranges) : OSV_ONLY_RANGE;
      const a: MatchedAdvisory = { id: c.id, severity: c.severity, vulnerable, source };
      const patched = range ? range.patched : highestVersion(rules, c.ranges.map(r => r.patched));
      if (c.summary) a.summary = c.summary;
      if (patched) a.patched = patched;
      if (c.malware) a.malware = true;
      if (unparsed) a.unparsed = true;
      return a;
    };

    // No version, or one we can't read: every advisory on the package is listed
    const version = entry.version ? rules.parse(entry.version) : null;
    const candidates = candidatesOf(entry.name);
    const advisories: MatchedAdvisory[] = [];
    let affected = false;
    for (const c of candidates) {
      if (version === null) { advisories.push(matched(c, 'ghsa', null)); continue; }
      const hit = pick(c.ranges, version);
      if (hit === 'unparsed') advisories.push(matched(c, 'ghsa', null, true));
      else if (hit) { advisories.push(matched(c, 'ghsa', hit)); affected = true; }
    }

    const osvOnly: Candidate[] = [];
    let osvState: PackageResult['osv'] = 'off';
    if (osv !== undefined) {
      const found = osv?.get(key);
      osvState = found?.complete ? 'checked' : 'unavailable';
      for (const vuln of found?.vulns ?? []) {
        const ids = [vuln.id, ...vuln.aliases];
        if (ids.some(id => withdrawn.has(id))) continue;
        const listed = advisories.find(a => ids.includes(a.id));
        if (listed) {
          // OSV confirms an advisory whose range we couldn't read
          if (listed.unparsed && version !== null) { delete listed.unparsed; affected = true; }
          continue;
        }
        const ours = candidates.find(c => ids.includes(c.id));
        const c: Candidate = ours ?? { id: vuln.id, severity: vuln.severity, summary: vuln.summary, ranges: vuln.ranges, malware: vuln.malware };
        if (!ours) osvOnly.push(c);
        // With a version OSV only reports what affects it, so it counts even where our ranges disagree
        const hit = version !== null ? pick(c.ranges, version) : null;
        advisories.push(matched(c, 'osv', hit && hit !== 'unparsed' ? hit : null));
        if (version !== null) affected = true;
      }
    }

    advisories.sort((a, b) => Number(Boolean(b.malware)) - Number(Boolean(a.malware)) || rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id));
    let status: PackageStatus;
    if (entry.version && version === null) status = 'unknown';
    else if (!advisories.length) status = 'not-affected';
    else if (!entry.version) status = 'no-version';
    else status = affected ? 'affected' : 'unknown';
    // Without the ecosystem's data only "affected" (from OSV) is known; anything else could be wrong
    if (noData && status !== 'affected') status = 'unknown';

    const result: PackageResult = {
      ecosystem: eco,
      entry: entry.version ? { name: entry.name, version: entry.version } : { name: entry.name },
      status,
      advisories,
      malware: advisories.some(a => a.malware),
      malwareCheckedDays: malware && eco === 'npm' ? NPM_MALWARE_DAYS : null,
      osv: osvState,
    };
    if (noData && status === 'unknown') result.reason = 'no data';
    const minSafe = advisories.length ? safeVersion(rules, highestVersion(rules, advisories.map(a => a.patched)), [...candidates, ...osvOnly], pick) : undefined;
    if (minSafe) result.minSafeVersion = rules.display ? rules.display(minSafe) : minSafe;
    if (advisories.length) result.highestSeverity = advisories[0].malware ? 'critical' : advisories.reduce((s, a) => (rank(a.severity) < rank(s) ? a.severity : s), advisories[0].severity);
    results.push(result);
  }

  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return results.sort((a, b) => Number(b.malware) - Number(a.malware) || rank(a.highestSeverity) - rank(b.highestSeverity)
    || order(a.entry.name, b.entry.name)
    || (a.entry.version ?? '').localeCompare(b.entry.version ?? '')
    || order(a.ecosystem, b.ecosystem));
}

/** The watched entry of a result as keys and labels spell it: npm unprefixed, the others `eco:name[@version]` */
export const resultKey = (r: Pick<PackageResult, 'ecosystem' | 'entry'>): string => watchKey({ ecosystem: r.ecosystem, ...r.entry });

/**
 * Notification keys for the advisories listed on the results: `advisoryId|package@version`, or
 * `advisoryId|package` for an unversioned entry; other ecosystems prefix the package (`advisoryId|pypi:name@1.0`).
 * Unreadable ranges count: they are flagged, never safe.
 */
export function affectingKeys(results: PackageResult[]): string[] {
  const keys = new Set<string>();
  for (const r of results) {
    for (const a of r.advisories) keys.add(`${a.id}|${resultKey(r)}`);
  }
  return [...keys];
}
