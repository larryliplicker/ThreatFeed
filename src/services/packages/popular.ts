// Popular package names for typosquat checks, as the snapshot job publishes them (data/popular-packages.json).
// `allow` is every name that counts as legitimate (never warned about); `targets` are the most popular names, in
// popularity order, that a warning can point to. Names are normalised the way matching compares them.

import { normalizeName } from './entries';

export interface PopularList { allow: string[]; targets: string[] }

export interface PopularData {
  npm: PopularList;
  pypi: PopularList;
  builtAt: string;
}

export const POPULAR_MAX_TARGETS = 5000;
export const POPULAR_MAX_LIST = 20000;

/** Normalised, de-duplicated (first occurrence wins), empty names dropped */
function names(eco: 'npm' | 'pypi', list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const n of list) {
    if (typeof n !== 'string') continue;
    const name = normalizeName(eco, n.trim());
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * npm: targets are the top downloads (at most 5,000); allow is the union of high impact, top dependents and top
 * downloads. PyPI: allow is every row, targets the first 5,000.
 */
export function buildPopular(
  npmLists: { highImpact: readonly string[]; topDependents: readonly string[]; topDownloads: readonly string[] },
  pypiRows: readonly string[],
  builtAt: string = new Date().toISOString(),
): PopularData {
  const npmTargets = names('npm', npmLists.topDownloads);
  const pypiAllow = names('pypi', pypiRows);
  return {
    npm: {
      allow: names('npm', [...npmLists.highImpact, ...npmLists.topDependents, ...npmLists.topDownloads]).slice(0, POPULAR_MAX_LIST),
      targets: npmTargets.slice(0, POPULAR_MAX_TARGETS),
    },
    pypi: { allow: pypiAllow.slice(0, POPULAR_MAX_LIST), targets: pypiAllow.slice(0, POPULAR_MAX_TARGETS) },
    builtAt,
  };
}

const isList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= POPULAR_MAX_LIST && v.every(x => typeof x === 'string');

function decodeList(raw: unknown): PopularList | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { allow, targets } = raw as Record<string, unknown>;
  return isList(allow) && isList(targets) ? { allow, targets } : null;
}

/** A published popular-packages.json, or null when it isn't one */
export function decodePopular(raw: unknown): PopularData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const npm = decodeList(r.npm);
  const pypi = decodeList(r.pypi);
  if (!npm || !pypi || typeof r.builtAt !== 'string' || Number.isNaN(Date.parse(r.builtAt))) return null;
  return { npm, pypi, builtAt: r.builtAt };
}
