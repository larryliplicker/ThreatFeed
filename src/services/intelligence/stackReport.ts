import type { CveRecord, KevEntry, VulnData } from '../../types';
import { containsTerm } from '../../utils/textMatch';

/**
 * The "Stack report": the CVEs for a date range that affect a product in My Stack.
 *
 * Built from CVE records only (the CISA KEV catalog and NVD's CVSS 7+ records), never from news articles, and
 * matched only on vendor and product fields, never on descriptions or titles. How broad a match is therefore
 * depends on the stack term itself: "Adobe Acrobat" does not match Lightroom, while "Adobe" matches every Adobe product.
 * All dates are UTC days (YYYY-MM-DD) and both ends of the range are included.
 */

export type ReportGroup = 'critical' | 'high' | 'kev-other';

export const REPORT_GROUPS: { id: ReportGroup; title: string }[] = [
  { id: 'critical', title: 'Critical (CVSS 9.0+)' },
  { id: 'high', title: 'High (CVSS 7.0–8.9)' },
  { id: 'kev-other', title: 'Known exploited, below 7.0 or unscored' },
];

export interface StackReportEntry {
  cve: string;
  group: ReportGroup;
  score?: number;
  /** "Vendor Product", or the first affected products NVD lists */
  product: string;
  /** The My Stack terms this CVE matched */
  matched: string[];
  /** Why it is in this period: published in it, and/or added to KEV in it */
  reasons: ('published' | 'kev')[];
  published?: string;
  kevAdded?: string;
  dueDate?: string;
  ransomware: boolean;
  epss?: number;
  exploit?: { msf: number; nuclei: boolean; pocs: number };
  title?: string;
  description?: string;
}

export interface StackReport {
  from: string;
  to: string;
  generatedAt: string;
  groups: Record<ReportGroup, StackReportEntry[]>;
  total: number;
  /** The days of NVD data the app holds, or null when none is loaded */
  nvdCoverage: { from: string; to: string } | null;
  /** True when the period starts before the NVD data does: earlier days can only show Known Exploited entries */
  partialNvd: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: string) => s.slice(0, 10);

/** Lowercase, with "_" and "-" read as spaces ("acrobat_reader" matches "Acrobat Reader"); applied to terms and text alike */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The stack terms found, as whole words, in the given vendor/product text */
export function stackTermsIn(text: string, stackKeywords: string[]): string[] {
  const haystack = normalize(text);
  return stackKeywords.filter((k) => {
    const term = normalize(k);
    return term !== '' && containsTerm(haystack, term);
  });
}

/** A valid YYYY-MM-DD, or null. Rejects 2026-02-31 and the like. */
export function parseDay(s: string): string | null {
  if (!DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** The period of the last `days` days ending today, both ends included (days = 7 means today and the 6 days before) */
export function lastDays(days: number, now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

const kevText = (k: KevEntry) => `${k.vendor} ${k.product} | ${(k.products ?? []).join(' | ')}`;
const recordText = (r: CveRecord) => (r.products ?? []).join(' | ');

function groupFor(score: number | undefined): ReportGroup {
  if (score !== undefined && score >= 9) return 'critical';
  if (score !== undefined && score >= 7) return 'high';
  return 'kev-other';
}

export function buildStackReport(vulns: VulnData, stackKeywords: string[], fromDay: string, toDay: string, now = new Date()): StackReport {
  const [from, to] = fromDay > toDay ? [toDay, fromDay] : [fromDay, toDay];
  const inRange = (s: string | undefined) => !!s && day(s) >= from && day(s) <= to;

  const kevById = new Map(vulns.kev.map((k) => [k.cve, k]));
  const recordById = new Map<string, CveRecord>();
  for (const r of [...vulns.notable, ...(vulns.watchable ?? [])]) if (!recordById.has(r.id)) recordById.set(r.id, r);

  // Every CVE with activity in the period, from either source
  const ids = new Set<string>();
  for (const k of vulns.kev) if (inRange(k.dateAdded) || inRange(k.published)) ids.add(k.cve);
  for (const r of recordById.values()) if (inRange(r.published)) ids.add(r.id);

  const entries: StackReportEntry[] = [];
  for (const cve of ids) {
    const kev = kevById.get(cve);
    const record = recordById.get(cve);
    const matched = stackTermsIn([kev && kevText(kev), record && recordText(record)].filter(Boolean).join(' | '), stackKeywords);
    if (matched.length === 0) continue;

    const score = record?.score ?? kev?.cvss;
    const group = groupFor(score);
    if (group === 'kev-other' && !kev) continue; // below 7.0 and not exploited: outside this report

    const published = record?.published ?? kev?.published;
    const reasons: StackReportEntry['reasons'] = [];
    if (inRange(published)) reasons.push('published');
    if (kev && inRange(kev.dateAdded)) reasons.push('kev');
    const info = vulns.exploits?.[cve];
    const exploit = info && (info.msf?.length || info.nuclei || info.pocs)
      ? { msf: info.msf?.length ?? 0, nuclei: !!info.nuclei, pocs: info.pocs ?? 0 }
      : undefined;

    entries.push({
      cve,
      group,
      score,
      product: kev ? `${kev.vendor} ${kev.product}`.trim() : (record?.products ?? []).slice(0, 3).join('; '),
      matched,
      reasons,
      published: published ? day(published) : undefined,
      kevAdded: kev?.dateAdded,
      dueDate: kev?.dueDate,
      ransomware: !!kev?.ransomware,
      epss: record?.epss ?? kev?.epss,
      exploit,
      title: kev?.name,
      description: record?.description ?? kev?.description,
    });
  }

  // Known exploited first, then the likeliest to be exploited next
  entries.sort((a, b) => Number(!!b.kevAdded) - Number(!!a.kevAdded) || (b.epss ?? 0) - (a.epss ?? 0) || b.cve.localeCompare(a.cve));

  const groups: Record<ReportGroup, StackReportEntry[]> = { critical: [], high: [], 'kev-other': [] };
  for (const e of entries) groups[e.group].push(e);

  const nvdCoverage = vulns.nvd ? { from: day(vulns.nvd.from), to: day(vulns.nvd.to) } : null;
  return {
    from,
    to,
    generatedAt: now.toISOString(),
    groups,
    total: entries.length,
    nvdCoverage,
    partialNvd: !nvdCoverage || from < nvdCoverage.from,
  };
}
