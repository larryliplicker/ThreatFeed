import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { getStoredValue, saveStoredValue } from '../services/storage/indexeddb';
import type { NpmAdvisoryData, NpmMalwareData } from '../services/npm/advisories';
import { knownAdvisoryIds, matchPackages, type AdvisoriesByEcosystem, type PackageResult, type WatchedEntry } from '../services/npm/match';
import { affectingByAdvisory, type AffectedEntry } from '../services/npm/npmFilters';
import { osvCacheFresh, osvQueryBatch, type OsvResult } from '../services/npm/osv';
import { parsePackageEntry, type PackageEntry } from '../services/npm/semver';
import { parseEntry, watchKey, type EcoEntry } from '../services/packages/entries';
import type { Ecosystem } from '../services/packages/ecosystems';
import { useEcosystemAdvisories } from './useNpmAdvisories';

const OSV_CACHE_KEY = 'npmOsv';

/** The last OSV answer on this device: when, for which list (sorted entries), and the results by entry */
interface OsvCache { at: string; key: string; results: [string, OsvResult][] }

// The tab and the advisory panel both match: one lookup per list at a time, shared
interface Lookup { key: string; promise: Promise<Map<string, OsvResult> | null> }
let inFlight: Lookup | null = null;
function lookUp(key: string, entries: WatchedEntry[], known: ReadonlySet<string>): Promise<Map<string, OsvResult> | null> {
  if (inFlight?.key === key) return inFlight.promise;
  const lookup: Lookup = { key, promise: Promise.resolve(null) };
  lookup.promise = osvQueryBatch(entries, known).then(async (results) => {
    // Kept only while it is still the latest lookup: an answer for an older list never overwrites a newer one
    if (results && inFlight === lookup) {
      const cache: OsvCache = { at: new Date().toISOString(), key, results: [...results] };
      await saveStoredValue(OSV_CACHE_KEY, cache).catch(() => undefined);
    }
    if (inFlight === lookup) inFlight = null;
    return results;
  });
  inFlight = lookup;
  return lookup.promise;
}

export interface NpmMatches {
  entries: PackageEntry[]; // the watched packages, from Settings: npm first (as before), then the other ecosystems' EcoEntry
  results: PackageResult[]; // matchPackages' answer, in its order; empty until the advisories load
  affecting: Map<string, AffectedEntry[]>; // advisory id → the watched entries it lists
  osvChecking: boolean; // an OSV lookup is under way
}

/**
 * The watched packages matched against the advisories of their ecosystems and the npm malware reports. The files of
 * the other ecosystems are loaded only for ecosystems with a watched package; their entries join the results once
 * the file has loaded, or as unknown ("no data") when it failed. Results wait for the npm data as before. With "Also check full history
 * with OSV.dev" on, OSV is asked at most once a day or when the list changes (the answer is kept in IndexedDB);
 * with it off nothing leaves the device.
 */
export function useNpmMatches(advisories: NpmAdvisoryData | null, malware: NpmMalwareData | null): NpmMatches {
  const { settings } = useSettings();
  const enabled = settings.npmOsvLookup;
  const npmEntries = useMemo(
    () => settings.npmPackages.map(parsePackageEntry).filter((e): e is PackageEntry => e !== null),
    [settings.npmPackages]
  );
  const ecoPackages = settings.ecosystemPackages;
  const ecoEntries = useMemo(
    () => (ecoPackages ?? []).map(parseEntry).filter((e): e is EcoEntry => e !== null && e.ecosystem !== 'npm'),
    [ecoPackages]
  );
  const watchedEcos = useMemo(() => [...new Set(ecoEntries.map(e => e.ecosystem))], [ecoEntries]);
  const { data: ecoData, failed: ecoFailed } = useEcosystemAdvisories(watchedEcos);
  const entries = useMemo<PackageEntry[]>(() => (ecoEntries.length ? [...npmEntries, ...ecoEntries] : npmEntries), [npmEntries, ecoEntries]);
  // npm entries key as they always did, so an npm-only list keeps its cached OSV answer
  const listKey = useMemo(() => (entries as WatchedEntry[]).map(watchKey).sort().join(' '), [entries]);

  // Latest values for the lookup, which only reruns when the setting, the list or the data's arrival changes
  const latest = useRef({ entries, advisories, malware, ecoData });
  latest.current = { entries, advisories, malware, ecoData };
  const hasData = advisories !== null;

  const [osv, setOsv] = useState<{ key: string; results: Map<string, OsvResult> | null } | null>(null);
  const [osvChecking, setOsvChecking] = useState(false);
  useEffect(() => {
    if (!enabled || !listKey || !hasData) return;
    let cancelled = false;
    void (async () => {
      const cached = await getStoredValue<OsvCache>(OSV_CACHE_KEY);
      const usable = cached && typeof cached.key === 'string' && typeof cached.at === 'string' && Array.isArray(cached.results);
      if (cancelled) return;
      if (usable && cached.key === listKey) {
        setOsv({ key: listKey, results: new Map(cached.results) });
        if (osvCacheFresh(cached.at, listKey, cached.key, Date.now())) return;
      }
      setOsvChecking(true);
      const { entries, advisories, malware, ecoData } = latest.current;
      const results = await lookUp(listKey, entries, knownAdvisoryIds({ ...ecoData, npm: advisories! }, malware));
      if (cancelled) return;
      setOsvChecking(false);
      // A failed lookup shows as "OSV unavailable", not as the older answer
      setOsv({ key: listKey, results });
    })();
    return () => {
      cancelled = true;
      setOsvChecking(false);
    };
  }, [enabled, listKey, hasData]);

  // undefined: OSV off; null: not (yet) answered for this list, which shows as unavailable
  const osvResults = useMemo(() => (enabled ? (osv?.key === listKey ? osv.results : null) : undefined), [enabled, osv, listKey]);
  const results = useMemo(() => {
    if (!advisories) return [];
    // An ecosystem still loading leaves its entries out for now; one that failed shows them as unknown
    const ready = ecoEntries.filter(e => ecoData[e.ecosystem] || ecoFailed.includes(e.ecosystem as Ecosystem));
    if (!ready.length) return matchPackages(npmEntries, advisories, malware, osvResults);
    const files: AdvisoriesByEcosystem = { ...ecoData, npm: advisories };
    return matchPackages([...npmEntries, ...ready], files, malware, osvResults);
  }, [npmEntries, ecoEntries, ecoData, ecoFailed, advisories, malware, osvResults]);
  const affecting = useMemo(() => affectingByAdvisory(results), [results]);
  return { entries, results, affecting, osvChecking };
}
