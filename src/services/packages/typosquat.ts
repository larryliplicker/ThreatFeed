// Typosquat check for watched npm and PyPI packages, on device: a name that is not itself popular but is very close to
// a popular one. The popular list (data/popular-packages.json) is the allow-list; a name on it never warns.

import { normalizeName } from './entries';
import type { PopularData, PopularList } from './popular';

export type TyposquatEcosystem = 'npm' | 'pypi';

const MIN_FUZZY_LENGTH = 6; // Damerau-Levenshtein distance 1 is only trusted for names this long
const MAX_DISMISSED = 500;
const MAX_KEY = 300;

interface Index {
  allow: Set<string>;
  rank: Map<string, number>; // target -> popularity position
  separatorless: Map<string, number>; // target without - _ . -> rank of its most popular target
  flatScope: Map<string, number>; // `a-b` and `b-a` for each scoped target `@a/b` -> its rank
  byLength: Map<number, number[]>; // length -> ranks of the targets of that length
  targets: string[];
  results: Map<string, string | null>;
}

const indexes = new WeakMap<PopularList, Index>();
const strip = (s: string) => s.replace(/[-_.]/g, '');
const lowest = (m: Map<string, number>, key: string, rank: number) => { if (!m.has(key) || m.get(key)! > rank) m.set(key, rank); };

function indexOf(list: PopularList): Index {
  let ix = indexes.get(list);
  if (ix) return ix;
  const built: Index = { allow: new Set(list.allow), rank: new Map(), separatorless: new Map(), flatScope: new Map(), byLength: new Map(), targets: list.targets, results: new Map() };
  list.targets.forEach((t, i) => {
    lowest(built.rank, t, i);
    lowest(built.separatorless, strip(t), i);
    const scoped = /^@([^/]+)\/(.+)$/.exec(t);
    if (scoped) {
      lowest(built.flatScope, `${scoped[1]}-${scoped[2]}`, i);
      lowest(built.flatScope, `${scoped[2]}-${scoped[1]}`, i);
    }
    const sameLength = built.byLength.get(t.length);
    if (sameLength) sameLength.push(i);
    else built.byLength.set(t.length, [i]);
  });
  ix = built;
  indexes.set(list, ix);
  return ix;
}

/** Optimal string alignment distance is exactly 1: one substitution, insertion, deletion or adjacent swap */
function distanceIsOne(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i); // insertion / deletion
}

const AFFIXES: readonly [prefix: string, suffix: string][] = [['', '-js'], ['', '.js'], ['', '-py'], ['py-', ''], ['python-', '']];

function findCandidate(ix: Index, n: string): string | null {
  let best = Infinity;
  const take = (rank: number | undefined) => { if (rank !== undefined && rank < best) best = rank; };

  // Same name once -, _ and . are removed
  take(ix.separatorless.get(strip(n)));
  // npm scope swap: `types-node` for `@types/node`, and the other way round
  take(ix.flatScope.get(n));
  const scoped = /^@([^/]+)\/(.+)$/.exec(n);
  if (scoped) { take(ix.rank.get(`${scoped[1]}-${scoped[2]}`)); take(ix.rank.get(`${scoped[2]}-${scoped[1]}`)); }
  // A popular name plus one affix
  for (const [prefix, suffix] of AFFIXES) {
    if (n.length > prefix.length + suffix.length && n.startsWith(prefix) && n.endsWith(suffix)) take(ix.rank.get(n.slice(prefix.length, n.length - suffix.length)));
  }
  // Distance 1, prefiltered by length, when both names are long enough
  if (n.length >= MIN_FUZZY_LENGTH) {
    for (let len = Math.max(MIN_FUZZY_LENGTH, n.length - 1); len <= n.length + 1; len++) {
      for (const rank of ix.byLength.get(len) ?? []) if (rank < best && distanceIsOne(n, ix.targets[rank])) best = rank;
    }
  }
  const found = best === Infinity ? null : ix.targets[best];
  return found === n ? null : found;
}

/**
 * The popular package a watched name looks like a misspelling of, or null. Null too for a name on the allow-list, when
 * there is no popular data, and when the ecosystem has no targets (its list was never built).
 */
export function typosquatCandidate(eco: TyposquatEcosystem, name: string, popular: PopularData | null): string | null {
  const list = popular?.[eco];
  if (!list || list.targets.length === 0) return null;
  const n = normalizeName(eco, name.trim());
  if (!n) return null;
  const ix = indexOf(list);
  if (ix.allow.has(n)) return null;
  if (ix.results.has(n)) return ix.results.get(n)!;
  const found = findCandidate(ix, n);
  ix.results.set(n, found);
  return found;
}

/** Identity of a dismissal: ecosystem and normalised name, whatever the version */
export function typosquatKey(eco: TyposquatEcosystem, name: string): string {
  return `${eco}:${normalizeName(eco, name.trim())}`;
}

/** The warning to show for a watched package: the candidate, unless the user dismissed this package */
export function typosquatWarning(eco: TyposquatEcosystem, name: string, popular: PopularData | null, dismissed: readonly string[]): string | null {
  if (dismissed.includes(typosquatKey(eco, name))) return null;
  return typosquatCandidate(eco, name, popular);
}

/** A stored, imported or synced `typosquatDismissed` value (untrusted): unique non-empty strings, at most 500 */
export function cleanTyposquatDismissed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const key = v.trim().toLowerCase();
    if (key && key.length <= MAX_KEY) seen.add(key);
    if (seen.size >= MAX_DISMISSED) break;
  }
  return [...seen];
}
