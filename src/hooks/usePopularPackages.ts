import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { otherEcosystemEntries } from '../services/packages/entries';
import { decodePopular, type PopularData } from '../services/packages/popular';
import { parsePackageEntry } from '../services/npm/semver';

let loading: Promise<PopularData | null> | null = null;

/** data/popular-packages.json, fetched once per page load; a failure reads as null (no warnings) and is retried on the next use */
function loadPopular(): Promise<PopularData | null> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}data/popular-packages.json`, { cache: 'no-cache' })
      .then(res => (res.ok ? res.json() : null))
      .then(decodePopular)
      .catch(() => null)
      .then(data => { if (!data) loading = null; return data; });
  }
  return loading;
}

/**
 * The popular package names for typosquat checks. Loaded only while at least one npm or PyPI package is watched, so a
 * user without those pays nothing.
 */
export function usePopularPackages(): PopularData | null {
  const { settings } = useSettings();
  const watching = settings.npmPackages.some(p => parsePackageEntry(p)) || otherEcosystemEntries(settings.ecosystemPackages).some(e => e.ecosystem === 'pypi');
  const [data, setData] = useState<PopularData | null>(null);
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    void loadPopular().then(d => { if (!cancelled && d) setData(d); });
    return () => { cancelled = true; };
  }, [watching]);
  return watching ? data : null;
}

/** What a TyposquatChip needs: the popular data, the dismissed packages and a way to dismiss one */
export function useTyposquat() {
  const { settings, updateSettings } = useSettings();
  const popular = usePopularPackages();
  const dismissed = settings.typosquatDismissed;
  const dismiss = useCallback((key: string) => {
    if (!dismissed.includes(key)) updateSettings({ typosquatDismissed: [...dismissed, key] });
  }, [dismissed, updateSettings]);
  return { popular, dismissed, onDismiss: dismiss };
}
