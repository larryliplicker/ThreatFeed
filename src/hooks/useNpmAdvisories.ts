import { useEffect, useMemo, useState } from 'react';
import { useFeeds } from '../context/FeedContext';
import type { NpmAdvisoryData, NpmMalwareData } from '../services/npm/advisories';
import type { Ecosystem } from '../services/packages/ecosystems';

/**
 * The npm advisories (data/npm-advisories.json, about 700 KB compressed) and malware reports
 * (data/npm-malware.json), loaded on first use: only the npm views and package matching pay for them. With `enabled`
 * false nothing loads and both read as null (the TV wall needs them only on the npm wall and in mixed mode).
 */
export function useNpmAdvisories(enabled = true): { advisories: NpmAdvisoryData | null; malware: NpmMalwareData | null; failed: boolean } {
  const { npmAdvisories, ensureNpmAdvisories, npmMalware, ensureNpmMalware, snapshotGeneratedAt } = useFeeds();
  const [failed, setFailed] = useState(false); // the advisories couldn't be loaded and no stored copy exists
  useEffect(() => {
    if (!enabled) return;
    void ensureNpmAdvisories().then((data) => setFailed(!data), () => setFailed(true));
    void ensureNpmMalware();
  }, [enabled, ensureNpmAdvisories, ensureNpmMalware, snapshotGeneratedAt]);
  if (!enabled) return { advisories: null, malware: null, failed: false };
  return { advisories: npmAdvisories, malware: npmMalware, failed: failed && !npmAdvisories };
}

export interface EcosystemAdvisories {
  data: Partial<Record<Ecosystem, NpmAdvisoryData>>; // the loaded files of the ecosystems asked for
  failed: Ecosystem[]; // asked for, couldn't be loaded and no stored copy exists: their packages show "no data"
}

/**
 * The advisory files of the given ecosystems (data/npm-advisories.json for npm, data/advisories-<eco>.json for the
 * others), loaded on first use and cached like useNpmAdvisories. Only the ecosystems in `ecos` are requested, so an
 * npm-only user (or an empty list) costs no new request. An ecosystem still loading is in neither list.
 */
export function useEcosystemAdvisories(ecos: Ecosystem[]): EcosystemAdvisories {
  const { npmAdvisories, ensureNpmAdvisories, ecosystemAdvisories, ensureEcosystemAdvisories, snapshotGeneratedAt } = useFeeds();
  const key = [...new Set(ecos)].sort().join(',');
  const [failedSet, setFailedSet] = useState<ReadonlySet<Ecosystem>>(() => new Set());
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const mark = (eco: Ecosystem, failed: boolean) => {
      if (cancelled) return;
      setFailedSet((prev) => {
        if (prev.has(eco) === failed) return prev;
        const next = new Set(prev);
        if (failed) next.add(eco);
        else next.delete(eco);
        return next;
      });
    };
    for (const eco of key.split(',') as Ecosystem[]) {
      const ensure = eco === 'npm' ? ensureNpmAdvisories : () => ensureEcosystemAdvisories(eco);
      void ensure().then((data) => mark(eco, !data), () => mark(eco, true));
    }
    return () => { cancelled = true; };
  }, [key, ensureNpmAdvisories, ensureEcosystemAdvisories, snapshotGeneratedAt]);

  return useMemo(() => {
    const data: Partial<Record<Ecosystem, NpmAdvisoryData>> = {};
    const failed: Ecosystem[] = [];
    if (!key) return { data, failed };
    for (const eco of key.split(',') as Ecosystem[]) {
      const loaded = eco === 'npm' ? npmAdvisories : ecosystemAdvisories[eco];
      if (loaded) data[eco] = loaded;
      else if (failedSet.has(eco)) failed.push(eco);
    }
    return { data, failed };
  }, [key, npmAdvisories, ecosystemAdvisories, failedSet]);
}
