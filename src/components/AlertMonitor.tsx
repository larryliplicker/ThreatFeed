import { useEffect, useRef, useState } from 'react';
import { useFeeds } from '../context/FeedContext';
import { useSettings } from '../context/SettingsContext';
import { NPM_RULE_ID, runAlertCheck } from '../services/intelligence/alertEngine';
import { alertSettingsFrom, rulesNeedVulns, type AlertSettings } from '../services/intelligence/alertRules';
import { getSettingsFromDB } from '../services/storage/indexeddb';
import { loadAlertStore, saveAlertStore } from '../services/intelligence/alertStore';
import { fetchEpssScores } from '../services/intelligence/cveWatch';
import { notificationsSupported, notifyAlertMatches } from '../services/notifications';
import { otherEcosystemEntries } from '../services/packages/entries';
import type { OtherEcosystem } from '../services/packages/ecosystems';

const CHECK_INTERVAL_MS = 5 * 60_000; // sends matches held by the gap once it ends, even with auto-refresh off
const LEADER_LOCK = 'threatfeed-alerts';

const packagesRuleOn = (s: Pick<AlertSettings, 'alertRules'>) => s.alertRules.some(r => r.builtIn === NPM_RULE_ID && r.enabled);

/** The npm advisory files are only loaded for an enabled "My packages" rule with npm packages to match */
const needsNpmData = (s: Pick<AlertSettings, 'alertRules' | 'npmPackages'>) => s.npmPackages.length > 0 && packagesRuleOn(s);

/** The other ecosystems whose files the "My packages" rule needs: those with a watched package, none when it is off */
function watchedEcosystems(s: Pick<AlertSettings, 'alertRules' | 'ecosystemPackages'>): OtherEcosystem[] {
  if (!packagesRuleOn(s)) return [];
  return [...new Set(otherEcosystemEntries(s.ecosystemPackages).map(e => e.ecosystem))].sort();
}

const locksSupported = () => typeof navigator !== 'undefined' && 'locks' in navigator && !!navigator.locks;

/**
 * Runs the alert rules after every refresh, when the rules change, and every few minutes. New matches become
 * one combined desktop notification; the rest is recorded for My Feed. Renders nothing.
 *
 * Only one tab checks: the alert store is shared, and a tab with older settings would drop the state of rules it
 * doesn't know about (and both would notify). The tab holding the Web Lock runs the checks and reads the saved
 * settings at each check, so rules edited in another tab apply. Without Web Locks every tab checks, as before.
 */
export function AlertMonitor(): null {
  const {
    feeds, articles, cveIntel, vulns, ensureVulns, npmAdvisories, ensureNpmAdvisories, npmMalware, ensureNpmMalware,
    ecosystemAdvisories, ensureEcosystemAdvisories, snapshotGeneratedAt, isRefreshing, initialSyncDone,
  } = useFeeds();
  const { settings } = useSettings();
  const latest = useRef({ feeds, articles, cveIntel, vulns, npmAdvisories, npmMalware, ecosystemAdvisories, settings, initialSyncDone });
  latest.current = { feeds, articles, cveIntel, vulns, npmAdvisories, npmMalware, ecosystemAdvisories, settings, initialSyncDone };
  const running = useRef(false);
  const rerun = useRef(false);
  const [isLeader, setIsLeader] = useState(() => !locksSupported());
  const leader = useRef(isLeader);
  leader.current = isLeader;

  // Held for the tab's lifetime; released on unmount so a remount (or StrictMode) can take it again
  useEffect(() => {
    if (!locksSupported()) return;
    let active = true;
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const abort = new AbortController();
    navigator.locks.request(LEADER_LOCK, { signal: abort.signal }, () => {
      if (active) setIsLeader(true);
      return held;
    }).catch(() => { /* aborted on unmount while waiting */ });
    return () => {
      active = false;
      abort.abort();
      release();
      setIsLeader(false);
    };
  }, []);
  const needsVulns = rulesNeedVulns(settings.alertRules, settings);

  // Again for every new snapshot, like useVulns: otherwise a long-open tab keeps checking the first vulns.json
  useEffect(() => {
    if (needsVulns) void ensureVulns();
  }, [needsVulns, ensureVulns, snapshotGeneratedAt]);

  const needsNpm = needsNpmData(settings);
  useEffect(() => {
    if (!needsNpm) return;
    void ensureNpmAdvisories();
    void ensureNpmMalware();
  }, [needsNpm, ensureNpmAdvisories, ensureNpmMalware, snapshotGeneratedAt]);

  // Each other ecosystem's file only while a package in it is watched (never for an npm-only list)
  const ecosKey = watchedEcosystems(settings).join(',');
  useEffect(() => {
    for (const eco of ecosKey ? (ecosKey.split(',') as OtherEcosystem[]) : []) void ensureEcosystemAdvisories(eco);
  }, [ecosKey, ensureEcosystemAdvisories, snapshotGeneratedAt]);

  const check = async () => {
    // Before the stored data and first refresh have landed, articles/vulns are partial and would mis-baseline
    if (!latest.current.initialSyncDone || !leader.current) return;
    if (running.current) { rerun.current = true; return; }
    running.current = true;
    try {
      const s = alertSettingsFrom(latest.current.settings, await getSettingsFromDB(), new Date());
      // A Vulns rule added in another tab: load the data; its arrival re-runs the check
      if (rulesNeedVulns(s.alertRules, s)) void ensureVulns();
      if (needsNpmData(s)) { void ensureNpmAdvisories(); void ensureNpmMalware(); }
      const ecos = watchedEcosystems(s);
      for (const eco of ecos) void ensureEcosystemAdvisories(eco);
      const watched = s.watchedCves;
      const epss = watched.length > 0 ? await fetchEpssScores(watched) : new Map<string, number>();
      const { feeds: feedList, articles: list, cveIntel: intel, vulns: data, npmAdvisories: npmData, npmMalware: malware, ecosystemAdvisories: ecoData } = latest.current; // read after the await
      const store = await loadAlertStore();
      const categories = new Map(feedList.map(f => [f.id, f.category]));
      const result = runAlertCheck({
        rules: s.alertRules,
        settings: s,
        articles: list,
        vulns: data,
        cveIntel: intel,
        epss,
        feedCategory: id => categories.get(id),
        now: new Date(),
        permissionGranted: notificationsSupported() && Notification.permission === 'granted',
        // Matched once both files are in: malware arriving after the advisories would read as new reports
        // The other ecosystems' packages wait (not baselined) until their file is in
        npm: {
          packages: s.npmPackages, advisories: npmData && malware ? npmData : null, malware,
          ecosystemPackages: s.ecosystemPackages, ecosystems: Object.fromEntries(ecos.map(eco => [eco, ecoData[eco] ?? null])),
        },
      }, store);
      await saveAlertStore(result.store);
      notifyAlertMatches(result.notify);
    } catch (err) {
      console.warn('Alert check failed:', err);
    } finally {
      running.current = false;
      if (rerun.current) { rerun.current = false; void check(); }
    }
  };
  const checkRef = useRef(check);
  checkRef.current = check;

  // After a refresh settles, on becoming the checking tab, and whenever the rules or lists they read change
  useEffect(() => {
    if (isRefreshing || !initialSyncDone || !isLeader) return;
    void checkRef.current();
  }, [isRefreshing, initialSyncDone, isLeader, vulns, npmAdvisories, npmMalware, ecosystemAdvisories, settings.alertRules, settings.watchlistKeywords, settings.stackKeywords, settings.watchedCves, settings.npmPackages, settings.ecosystemPackages, settings.alertGapHours]);

  useEffect(() => {
    const timer = window.setInterval(() => void checkRef.current(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
