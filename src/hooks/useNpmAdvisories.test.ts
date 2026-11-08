import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type { NpmAdvisoryData } from '../services/npm/advisories';
import type { Ecosystem } from '../services/packages/ecosystems';

const NOW = '2026-11-08T00:00:00Z';
const data = (index: NpmAdvisoryData['index'] = []): NpmAdvisoryData => ({ version: 1, generatedAt: NOW, updatedAt: NOW, recent: [], index });

const feeds = {
  npmAdvisories: null as NpmAdvisoryData | null,
  ecosystemAdvisories: {} as Partial<Record<Ecosystem, NpmAdvisoryData>>,
  ensureNpmAdvisories: vi.fn(async () => feeds.npmAdvisories),
  ensureNpmMalware: vi.fn(async () => null),
  ensureEcosystemAdvisories: vi.fn(async (eco: Ecosystem) => feeds.ecosystemAdvisories[eco] ?? null),
  npmMalware: null,
  snapshotGeneratedAt: NOW,
};
vi.mock('../context/FeedContext', () => ({ useFeeds: () => feeds }));
const settings = { npmPackages: [] as string[], ecosystemPackages: [] as string[], npmOsvLookup: false };
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings }) }));
vi.mock('../services/storage/indexeddb', () => ({ getStoredValue: vi.fn(async () => null), saveStoredValue: vi.fn(async () => undefined) }));

import { useEcosystemAdvisories } from './useNpmAdvisories';
import { useNpmMatches, type NpmMatches } from './useNpmMatches';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
async function render(probe: () => null) {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => { root.render(createElement(probe)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  vi.clearAllMocks();
  feeds.npmAdvisories = data([['GHSA-aaaa-aaaa-aaaa', 'high', [['lodash', '< 4.17.21', '4.17.21']]]]);
  feeds.ecosystemAdvisories = {};
  settings.npmPackages = ['lodash@4.17.15'];
  settings.ecosystemPackages = [];
});
afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
});

describe('useEcosystemAdvisories', () => {
  it('loads only the ecosystems asked for and reports the ones that failed', async () => {
    feeds.ecosystemAdvisories = { pypi: data() };
    let last: ReturnType<typeof useEcosystemAdvisories> | null = null;
    await render(() => { last = useEcosystemAdvisories(['pypi', 'maven', 'pypi']); return null; });
    expect(feeds.ensureEcosystemAdvisories.mock.calls.map(c => c[0]).sort()).toEqual(['maven', 'pypi']);
    expect(feeds.ensureNpmAdvisories).not.toHaveBeenCalled();
    expect(Object.keys(last!.data)).toEqual(['pypi']);
    expect(last!.failed).toEqual(['maven']);
  });

  it('asks for nothing with an empty list', async () => {
    let last: ReturnType<typeof useEcosystemAdvisories> | null = null;
    await render(() => { last = useEcosystemAdvisories([]); return null; });
    expect(feeds.ensureEcosystemAdvisories).not.toHaveBeenCalled();
    expect(last).toEqual({ data: {}, failed: [] });
  });
});

describe('useNpmMatches across ecosystems', () => {
  it('makes no new requests for an npm-only list', async () => {
    let last: NpmMatches | null = null;
    await render(() => { last = useNpmMatches(feeds.npmAdvisories, null); return null; });
    expect(feeds.ensureEcosystemAdvisories).not.toHaveBeenCalled();
    expect(last!.results.map(r => [r.ecosystem, r.status])).toEqual([['npm', 'affected']]);
  });

  it('loads and matches only the watched ecosystems, and shows a failed one as unknown with no data', async () => {
    settings.ecosystemPackages = ['pypi:django@3.2.0', 'maven:org.apache.logging.log4j:log4j-core@2.14.1'];
    feeds.ecosystemAdvisories = { pypi: data([['GHSA-pypi-dj01-0001', 'critical', [['django', '>= 3.2, < 3.2.14', '3.2.14']]]]) };
    let last: NpmMatches | null = null;
    await render(() => { last = useNpmMatches(feeds.npmAdvisories, null); return null; });
    expect(feeds.ensureEcosystemAdvisories.mock.calls.map(c => c[0]).sort()).toEqual(['maven', 'pypi']);
    const by = (eco: string) => last!.results.find(r => r.ecosystem === eco)!;
    expect(by('pypi').status).toBe('affected');
    expect(by('maven')).toMatchObject({ status: 'unknown', reason: 'no data' });
    expect(by('npm').status).toBe('affected');
    expect(last!.entries).toHaveLength(3);
  });
});
