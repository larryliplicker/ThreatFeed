import { describe, expect, it } from 'vitest';
import type { NpmAdvisory, NpmAdvisoryData, NpmIndexEntry, NpmMalwareData, NpmMalwareTuple } from './advisories';
import { affectingKeys, knownAdvisoryIds, matchPackages, OSV_ONLY_RANGE, type PackageResult } from './match';
import type { OsvResult } from './osv';

const NOW = '2026-11-04T00:00:00Z';

function data(index: NpmIndexEntry[], recent: Partial<NpmAdvisory>[] = []): NpmAdvisoryData {
  return { version: 1, generatedAt: NOW, updatedAt: NOW, recent: recent as NpmAdvisory[], index };
}

function malware(entries: NpmMalwareTuple[]): NpmMalwareData {
  return { version: 1, generatedAt: NOW, updatedAt: NOW, entries };
}

const LODASH: NpmIndexEntry = ['GHSA-aaaa-aaaa-aaaa', 'high', [['lodash', '< 4.17.21', '4.17.21']]];
const LODASH_OLD: NpmIndexEntry = ['GHSA-bbbb-bbbb-bbbb', 'critical', [['lodash', '< 4.17.12', '4.17.12']]];
const MULTI: NpmIndexEntry = ['GHSA-cccc-cccc-cccc', 'medium', [['qs', '< 6.2.4', '6.2.4'], ['qs', '>= 6.3.0, < 6.3.3', '6.3.3']]];

describe('matchPackages', () => {
  it('flags an exact version inside a range and clears one outside it', () => {
    const d = data([LODASH, LODASH_OLD]);
    const [inside] = matchPackages([{ name: 'lodash', version: '4.17.20' }], d, null);
    expect(inside.status).toBe('affected');
    expect(inside.advisories.map(a => a.id)).toEqual(['GHSA-aaaa-aaaa-aaaa']);
    expect(inside.advisories[0]).toMatchObject({ severity: 'high', vulnerable: '< 4.17.21', patched: '4.17.21', source: 'ghsa' });
    expect(inside.highestSeverity).toBe('high');

    const [outside] = matchPackages([{ name: 'lodash', version: '4.17.21' }], d, null);
    expect(outside.status).toBe('not-affected');
    expect(outside.advisories).toEqual([]);
    expect(outside.minSafeVersion).toBeUndefined();
    expect(outside.highestSeverity).toBeUndefined();
  });

  it('uses the range that contains the version when an advisory has several', () => {
    const [r] = matchPackages([{ name: 'qs', version: '6.3.1' }], data([MULTI]), null);
    expect(r.status).toBe('affected');
    expect(r.advisories[0]).toMatchObject({ vulnerable: '>= 6.3.0, < 6.3.3', patched: '6.3.3' });
    expect(matchPackages([{ name: 'qs', version: '6.2.5' }], data([MULTI]), null)[0].status).toBe('not-affected');
  });

  it('gives no-version and lists every advisory on the package when the entry has no version', () => {
    const [r] = matchPackages([{ name: 'lodash' }], data([LODASH, LODASH_OLD, MULTI]), null);
    expect(r.status).toBe('no-version');
    expect(r.advisories.map(a => a.id).sort()).toEqual(['GHSA-aaaa-aaaa-aaaa', 'GHSA-bbbb-bbbb-bbbb']);
    expect(r.highestSeverity).toBe('critical');
    const [qs] = matchPackages([{ name: 'qs' }], data([MULTI]), null);
    expect(qs.advisories[0]).toMatchObject({ vulnerable: '< 6.2.4 || >= 6.3.0, < 6.3.3', patched: '6.3.3' });
  });

  it('reads a package with no advisories at all as not affected even without a version', () => {
    expect(matchPackages([{ name: 'left-pad' }], data([LODASH]), null)[0].status).toBe('not-affected');
  });

  it('gives unknown, never not-affected, when a relevant range cannot be parsed', () => {
    const bad: NpmIndexEntry = ['GHSA-dddd-dddd-dddd', 'low', [['lodash', '~4.17']]];
    const empty: NpmIndexEntry = ['GHSA-eeee-eeee-eeee', 'low', [['lodash', '']]];
    for (const entry of [bad, empty]) {
      const [r] = matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH, entry]), null);
      expect(r.status).toBe('unknown');
      expect(r.advisories).toEqual([expect.objectContaining({ id: entry[0], unparsed: true })]);
    }
    // Something else marks it affected: affected wins, the unreadable one stays listed
    const [r] = matchPackages([{ name: 'lodash', version: '4.17.20' }], data([LODASH, bad]), null);
    expect(r.status).toBe('affected');
    expect(r.advisories.map(a => a.id).sort()).toEqual(['GHSA-aaaa-aaaa-aaaa', 'GHSA-dddd-dddd-dddd']);
    // An unreadable range on another package is not relevant
    const other: NpmIndexEntry = ['GHSA-ffff-ffff-ffff', 'low', [['qs', 'garbage']]];
    expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH, other]), null)[0].status).toBe('not-affected');
  });

  it('gives unknown when the entry version itself cannot be read', () => {
    const [r] = matchPackages([{ name: 'lodash', version: 'latest' }], data([LODASH]), null);
    expect(r.status).toBe('unknown');
    expect(r.advisories.map(a => a.id)).toEqual(['GHSA-aaaa-aaaa-aaaa']);
    expect(matchPackages([{ name: 'left-pad', version: 'latest' }], data([LODASH]), null)[0].status).toBe('unknown');
  });

  it('ignores withdrawn advisories', () => {
    const withdrawn: NpmIndexEntry = ['GHSA-gggg-gggg-gggg', 'critical', [['lodash', '< 5.0.0', '5.0.0']], 1];
    const d = data([withdrawn]);
    expect(matchPackages([{ name: 'lodash', version: '4.17.20' }], d, null)[0].status).toBe('not-affected');
    expect(matchPackages([{ name: 'lodash' }], d, null)[0].status).toBe('not-affected');
    // Also when the withdrawn one has an unreadable range
    const withdrawnBad: NpmIndexEntry = ['GHSA-gggg-gggg-gggg', 'critical', [['lodash', '???']], 1];
    expect(matchPackages([{ name: 'lodash', version: '4.17.20' }], data([withdrawnBad]), null)[0].status).toBe('not-affected');
  });

  it('takes the summary from the detailed list when the advisory is in it', () => {
    const [r] = matchPackages([{ name: 'lodash', version: '4.17.20' }], data([LODASH], [{ id: 'GHSA-aaaa-aaaa-aaaa', summary: 'Prototype pollution' }]), null);
    expect(r.advisories[0].summary).toBe('Prototype pollution');
    const [r2] = matchPackages([{ name: 'lodash', version: '4.17.10' }], data([LODASH, LODASH_OLD]), null);
    expect(r2.advisories.every(a => a.summary === undefined)).toBe(true);
  });

  it('flags malware for a matching version, an unversioned entry and says the window was checked', () => {
    const m = malware([['GHSA-mmmm-mmmm-mmmm', 'evil-pkg', '>= 0', '2026-11-01T00:00:00Z'], ['GHSA-nnnn-nnnn-nnnn', 'hijacked', '= 1.2.4', '2026-11-02T00:00:00Z']]);
    const results = matchPackages([{ name: 'evil-pkg', version: '1.0.0' }, { name: 'evil-pkg' }, { name: 'hijacked', version: '1.2.4' }, { name: 'hijacked', version: '1.2.3' }], data([]), m);
    const by = (name: string, version?: string) => results.find(r => r.entry.name === name && r.entry.version === version)!;
    expect(by('evil-pkg', '1.0.0')).toMatchObject({ status: 'affected', malware: true, highestSeverity: 'critical', malwareCheckedDays: 30 });
    expect(by('evil-pkg', '1.0.0').advisories[0]).toMatchObject({ id: 'GHSA-mmmm-mmmm-mmmm', malware: true, source: 'ghsa', vulnerable: '>= 0' });
    expect(by('evil-pkg', undefined)).toMatchObject({ status: 'no-version', malware: true });
    expect(by('hijacked', '1.2.4')).toMatchObject({ status: 'affected', malware: true });
    expect(by('hijacked', '1.2.3')).toMatchObject({ status: 'not-affected', malware: false, malwareCheckedDays: 30 });
    expect(by('evil-pkg', '1.0.0').minSafeVersion).toBeUndefined();
  });

  it('says malware was not checked when the malware file is not loaded', () => {
    expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null)[0].malwareCheckedDays).toBeNull();
  });

  it('takes the highest patched version as the minimum safe version, none when a fix is missing', () => {
    const [r] = matchPackages([{ name: 'lodash', version: '4.17.10' }], data([LODASH, LODASH_OLD]), null);
    expect(r.minSafeVersion).toBe('4.17.21');
    const [n] = matchPackages([{ name: 'lodash' }], data([LODASH, LODASH_OLD]), null);
    expect(n.minSafeVersion).toBe('4.17.21');
    const unfixed: NpmIndexEntry = ['GHSA-hhhh-hhhh-hhhh', 'low', [['lodash', '< 5.0.0']]];
    expect(matchPackages([{ name: 'lodash', version: '4.17.10' }], data([LODASH, unfixed]), null)[0].minSafeVersion).toBeUndefined();
  });

  it('matches advisory package names case-insensitively, in the index and the malware list', () => {
    const electron: NpmIndexEntry = ['GHSA-6h98-cf9g-vmg2', 'high', [['Electron', '>= 1.7.0, < 1.7.6', '1.7.6']]];
    const m = malware([['GHSA-mmmm-mmmm-mmmm', 'Evil-Pkg', '>= 0', NOW]]);
    const [r] = matchPackages([{ name: 'electron', version: '1.7.5' }], data([electron]), null);
    expect(r.status).toBe('affected');
    expect(r.advisories.map(a => a.id)).toEqual(['GHSA-6h98-cf9g-vmg2']);
    expect(matchPackages([{ name: 'electron' }], data([electron]), null)[0].status).toBe('no-version');
    expect(matchPackages([{ name: 'evil-pkg', version: '1.0.0' }], data([]), m)[0]).toMatchObject({ status: 'affected', malware: true });
  });

  it('moves the minimum safe version past a fix that another advisory still covers', () => {
    const a: NpmIndexEntry = ['GHSA-aaaa-1111-aaaa', 'high', [['pkg', '< 1.2.0', '1.2.0']]];
    const c: NpmIndexEntry = ['GHSA-cccc-1111-cccc', 'high', [['pkg', '>= 1.1.0, < 1.3.0', '1.3.0']]];
    const [r] = matchPackages([{ name: 'pkg', version: '1.0.0' }], data([a, c]), null);
    expect(r.advisories.map(x => x.id)).toEqual(['GHSA-aaaa-1111-aaaa']);
    expect(r.minSafeVersion).toBe('1.3.0');
    // No clear fix: unfixed later range, or an unreadable range
    const open: NpmIndexEntry = ['GHSA-dddd-1111-dddd', 'low', [['pkg', '>= 1.1.0']]];
    expect(matchPackages([{ name: 'pkg', version: '1.0.0' }], data([a, open]), null)[0].minSafeVersion).toBeUndefined();
    const bad: NpmIndexEntry = ['GHSA-eeee-1111-eeee', 'low', [['pkg', '~1.2']]];
    expect(matchPackages([{ name: 'pkg', version: '1.0.0' }], data([a, bad]), null)[0].minSafeVersion).toBeUndefined();
  });

  it('orders malware first, then by severity, then by name', () => {
    const d = data([
      ['GHSA-1111-1111-1111', 'low', [['a-low', '< 2.0.0', '2.0.0']]],
      ['GHSA-2222-2222-2222', 'critical', [['z-crit', '< 2.0.0', '2.0.0']]],
      ['GHSA-3333-3333-3333', 'critical', [['b-crit', '< 2.0.0', '2.0.0']]],
      ['GHSA-4444-4444-4444', 'medium', [['c-med', '< 2.0.0', '2.0.0']]],
    ]);
    const m = malware([['GHSA-5555-5555-5555', 'y-mal', '>= 0', NOW]]);
    const names = matchPackages(
      ['clean', 'a-low', 'c-med', 'z-crit', 'y-mal', 'b-crit', 'aaa-clean'].map(name => ({ name, version: '1.0.0' })), d, m,
    ).map(r => r.entry.name);
    expect(names).toEqual(['y-mal', 'b-crit', 'z-crit', 'c-med', 'a-low', 'aaa-clean', 'clean']);
  });

  it('returns one result per distinct entry', () => {
    expect(matchPackages([{ name: 'lodash', version: '4.17.20' }, { name: 'lodash', version: '4.17.20' }, { name: 'lodash' }], data([LODASH]), null)).toHaveLength(2);
  });

  describe('with OSV', () => {
    const key = 'lodash@4.17.21';
    it('marks OSV off when no OSV results are given, unavailable when the lookup failed', () => {
      expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null)[0].osv).toBe('off');
      expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null, null)[0].osv).toBe('unavailable');
      expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null, new Map())[0].osv).toBe('unavailable');
    });

    it('adds OSV-only vulnerabilities as affecting and keeps not-affected when OSV agrees', () => {
      const clean = new Map<string, OsvResult>([[key, { vulns: [], complete: true }]]);
      expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null, clean)[0]).toMatchObject({ status: 'not-affected', osv: 'checked' });

      const found = new Map<string, OsvResult>([[key, { complete: true, vulns: [
        { id: 'MAL-2025-1', summary: 'Malicious code in lodash (npm)', severity: 'critical', malware: true, aliases: [], ranges: [{ vulnerable: '= 4.17.21' }] },
        { id: 'OSV-NODETAIL', severity: 'unknown', malware: false, aliases: [], ranges: [] },
      ] }]]);
      const [r] = matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null, found);
      expect(r).toMatchObject({ status: 'affected', malware: true, osv: 'checked', highestSeverity: 'critical' });
      expect(r.advisories.map(a => [a.id, a.source])).toEqual([['MAL-2025-1', 'osv'], ['OSV-NODETAIL', 'osv']]);
      expect(r.advisories[1].vulnerable).toBe(OSV_ONLY_RANGE);
    });

    it('does not repeat an advisory already matched, by id or alias, and never revives a withdrawn one', () => {
      const withdrawn: NpmIndexEntry = ['GHSA-gggg-gggg-gggg', 'critical', [['lodash', '< 5.0.0', '5.0.0']], 1];
      const m = malware([['GHSA-mmmm-mmmm-mmmm', 'lodash', '>= 0', NOW]]);
      const osv = new Map<string, OsvResult>([['lodash@4.17.20', { complete: true, vulns: [
        { id: 'GHSA-aaaa-aaaa-aaaa', severity: 'unknown', malware: false, aliases: [], ranges: [] },
        { id: 'GHSA-gggg-gggg-gggg', severity: 'unknown', malware: false, aliases: [], ranges: [] },
        { id: 'MAL-2025-2', severity: 'critical', malware: true, aliases: ['GHSA-mmmm-mmmm-mmmm'], ranges: [] },
      ] }]]);
      const [r] = matchPackages([{ name: 'lodash', version: '4.17.20' }], data([LODASH, withdrawn]), m, osv);
      expect(r.advisories.map(a => [a.id, a.source]).sort()).toEqual([['GHSA-aaaa-aaaa-aaaa', 'ghsa'], ['GHSA-mmmm-mmmm-mmmm', 'ghsa']]);
    });

    it('trusts OSV over our own reading for an indexed advisory it reports as affecting', () => {
      const osv = new Map<string, OsvResult>([['lodash@4.17.21', { complete: true, vulns: [{ id: 'GHSA-aaaa-aaaa-aaaa', severity: 'unknown', malware: false, aliases: [], ranges: [] }] }]]);
      const [r] = matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null, osv);
      expect(r.status).toBe('affected');
      expect(r.advisories[0]).toMatchObject({ id: 'GHSA-aaaa-aaaa-aaaa', source: 'osv', severity: 'high', vulnerable: '< 4.17.21' });
    });

    it('turns unknown into affected when OSV confirms an advisory whose range we could not read', () => {
      const bad: NpmIndexEntry = ['GHSA-dddd-dddd-dddd', 'low', [['lodash', '~4.17']]];
      const osv = new Map<string, OsvResult>([[key, { complete: true, vulns: [{ id: 'GHSA-dddd-dddd-dddd', severity: 'unknown', malware: false, aliases: [], ranges: [] }] }]]);
      const [r] = matchPackages([{ name: 'lodash', version: '4.17.21' }], data([bad]), null, osv);
      expect(r.status).toBe('affected');
      expect(r.advisories).toHaveLength(1);
      expect(r.advisories[0].unparsed).toBeUndefined();
    });

    it('reads an incomplete OSV answer with nothing in it as unavailable', () => {
      const osv = new Map<string, OsvResult>([[key, { vulns: [], complete: false }]]);
      expect(matchPackages([{ name: 'lodash', version: '4.17.21' }], data([LODASH]), null, osv)[0]).toMatchObject({ status: 'not-affected', osv: 'unavailable' });
    });
  });
});

describe('affectingKeys', () => {
  it('keys advisory + package + version, or advisory + package without a version', () => {
    const m = malware([['GHSA-mmmm-mmmm-mmmm', 'evil', '>= 0', NOW]]);
    const bad: NpmIndexEntry = ['GHSA-dddd-dddd-dddd', 'low', [['qs', 'nonsense']]];
    const results = matchPackages(
      [{ name: 'lodash', version: '4.17.20' }, { name: 'lodash', version: '4.17.21' }, { name: 'evil' }, { name: 'qs', version: '1.0.0' }],
      data([LODASH, bad]), m,
    );
    expect(affectingKeys(results).sort()).toEqual([
      'GHSA-aaaa-aaaa-aaaa|lodash@4.17.20',
      'GHSA-dddd-dddd-dddd|qs@1.0.0',
      'GHSA-mmmm-mmmm-mmmm|evil',
    ]);
  });
});

describe('knownAdvisoryIds', () => {
  it('collects index and malware ids', () => {
    const ids = knownAdvisoryIds(data([LODASH]), malware([['GHSA-mmmm-mmmm-mmmm', 'evil', '>= 0', NOW]]));
    expect([...ids].sort()).toEqual(['GHSA-aaaa-aaaa-aaaa', 'GHSA-mmmm-mmmm-mmmm']);
    expect([...knownAdvisoryIds(data([LODASH]), null)]).toEqual(['GHSA-aaaa-aaaa-aaaa']);
  });
});

describe('matchPackages across ecosystems', () => {
  const DJANGO: NpmIndexEntry = ['GHSA-pypi-dj01-0001', 'critical', [['Django', '>= 3.2, < 3.2.14', '3.2.14']]];
  const NPM_DJANGO: NpmIndexEntry = ['GHSA-npm0-dj01-0001', 'high', [['django', '< 99.0.0', '99.0.0']]];
  const LOG4J: NpmIndexEntry = ['GHSA-jfh8-c2jp-5v3q', 'critical', [['org.apache.logging.log4j:log4j-core', '>= 2.13.0, < 2.15.0', '2.15.0']]];
  const pypi = { ecosystem: 'pypi' as const, name: 'django', version: '3.2.0' };

  it('matches a PyPI entry against pip advisories and not against an npm advisory of the same name', () => {
    const results = matchPackages([pypi], { npm: data([NPM_DJANGO]), pypi: data([DJANGO]) }, null);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ecosystem: 'pypi', status: 'affected', entry: { name: 'django', version: '3.2.0' }, minSafeVersion: '3.2.14' });
    expect(results[0].advisories.map(a => a.id)).toEqual(['GHSA-pypi-dj01-0001']);
    // and the npm entry of the same name sees only the npm advisory
    const [npm] = matchPackages([{ name: 'django', version: '1.0.0' }], { npm: data([NPM_DJANGO]), pypi: data([DJANGO]) }, null);
    expect(npm).toMatchObject({ ecosystem: 'npm', status: 'affected' });
    expect(npm.advisories.map(a => a.id)).toEqual(['GHSA-npm0-dj01-0001']);
  });

  it('normalises names on both sides (PEP 503 for PyPI)', () => {
    const odd: NpmIndexEntry = ['GHSA-pypi-odd0-0001', 'low', [['foo-bar-baz', '< 2.0', '2.0']]];
    const [r] = matchPackages([{ ecosystem: 'pypi', name: 'Foo_Bar.baz', version: '1.0' }], { pypi: data([odd]) }, null);
    expect(r).toMatchObject({ status: 'affected', entry: { name: 'Foo_Bar.baz', version: '1.0' } });
  });

  it('flags log4j-core 2.14.1 for Log4Shell, and 2.15.0 is outside that range', () => {
    const maven = { ecosystem: 'maven' as const, name: 'org.apache.logging.log4j:log4j-core' };
    const [hit] = matchPackages([{ ...maven, version: '2.14.1' }], { maven: data([LOG4J]) }, null);
    expect(hit).toMatchObject({ status: 'affected', ecosystem: 'maven', minSafeVersion: '2.15.0' });
    expect(matchPackages([{ ...maven, version: '2.15.0' }], { maven: data([LOG4J]) }, null)[0].status).toBe('not-affected');
  });

  it('gives unknown for a Maven entry whose version cannot be read', () => {
    const [r] = matchPackages([{ ecosystem: 'maven', name: 'org.apache.logging.log4j:log4j-core', version: '${project.version}' }], { maven: data([LOG4J]) }, null);
    expect(r.status).toBe('unknown');
    expect(r.advisories.map(a => a.id)).toEqual(['GHSA-jfh8-c2jp-5v3q']);
  });

  it('gives unknown with "no data", never not-affected, for an ecosystem whose file failed', () => {
    const results = matchPackages([pypi, { ecosystem: 'pypi', name: 'requests' }, { name: 'lodash', version: '4.17.21' }], { npm: data([LODASH]) }, null);
    const by = (name: string) => results.find(r => r.entry.name === name)!;
    expect(by('django')).toMatchObject({ status: 'unknown', reason: 'no data', ecosystem: 'pypi', advisories: [] });
    expect(by('requests')).toMatchObject({ status: 'unknown', reason: 'no data' });
    expect(by('lodash')).toMatchObject({ status: 'not-affected', ecosystem: 'npm' });
    expect(by('lodash').reason).toBeUndefined();
  });

  it('never applies npm malware to another ecosystem', () => {
    const m = malware([['GHSA-mmmm-mmmm-mmmm', 'django', '>= 0', NOW]]);
    const [r] = matchPackages([pypi], { pypi: data([]) }, m);
    expect(r).toMatchObject({ status: 'not-affected', malware: false });
  });

  it('keys OSV answers by the prefixed entry for other ecosystems', () => {
    const osv = new Map<string, OsvResult>([['pypi:django@3.2.0', { complete: true, vulns: [{ id: 'PYSEC-1', severity: 'high', malware: false, aliases: [], ranges: [] }] }]]);
    const [r] = matchPackages([pypi], { pypi: data([]) }, null, osv);
    expect(r).toMatchObject({ status: 'affected', osv: 'checked' });
  });

  it('keeps npm results byte-identical to before for an npm-only list, by either call', async () => {
    const golden = (await import('./match.npm-golden.json')).default as { plain: unknown; osv: unknown };
    const d = data([
      ['GHSA-aaaa-aaaa-aaaa', 'high', [['lodash', '< 4.17.21', '4.17.21']]],
      ['GHSA-bbbb-bbbb-bbbb', 'critical', [['lodash', '< 4.17.12', '4.17.12']]],
      ['GHSA-cccc-cccc-cccc', 'medium', [['qs', '< 6.2.4', '6.2.4'], ['qs', '>= 6.3.0, < 6.3.3', '6.3.3']]],
      ['GHSA-dddd-dddd-dddd', 'low', [['Electron', '~1.7']]],
      ['GHSA-gggg-gggg-gggg', 'critical', [['qs', '< 9.0.0', '9.0.0']], 1],
    ], [{ id: 'GHSA-aaaa-aaaa-aaaa', summary: 'Prototype pollution' }]);
    const m = malware([['GHSA-mmmm-mmmm-mmmm', 'Evil-Pkg', '>= 0', NOW]]);
    const entries = [{ name: 'lodash', version: '4.17.10' }, { name: 'lodash' }, { name: 'qs', version: '6.3.1' }, { name: 'qs', version: '6.2.5' }, { name: 'electron', version: '1.7.5' }, { name: 'evil-pkg', version: '1.0.0' }, { name: 'left-pad' }, { name: 'lodash', version: 'not-a-version' }, { name: 'lodash', version: '4.17.10' }];
    const osv = new Map<string, OsvResult>([
      ['qs@6.2.5', { complete: true, vulns: [{ id: 'OSV-1', severity: 'high', malware: false, aliases: [], ranges: [{ vulnerable: '< 7.0.0', patched: '7.0.0' }] }] }],
      ['electron@1.7.5', { complete: false, vulns: [{ id: 'GHSA-dddd-dddd-dddd', severity: 'unknown', malware: false, aliases: [], ranges: [] }] }],
    ]);
    const withoutEco = (rs: PackageResult[]) => {
      expect(rs.every(r => r.ecosystem === 'npm')).toBe(true);
      return JSON.parse(JSON.stringify(rs.map(({ ecosystem: _e, ...rest }) => rest)));
    };
    for (const run of [(o?: Map<string, OsvResult>) => matchPackages(entries, d, m, o), (o?: Map<string, OsvResult>) => matchPackages(entries, { npm: d }, m, o)]) {
      expect(withoutEco(run())).toEqual(golden.plain);
      expect(withoutEco(run(osv))).toEqual(golden.osv);
      expect(affectingKeys(run())).toEqual(affectingKeys(matchPackages(entries, d, m)));
    }
  });
});

describe('affectingKeys across ecosystems', () => {
  it('prefixes the other ecosystems and leaves npm as it was', () => {
    const d = data([['GHSA-aaaa-aaaa-aaaa', 'high', [['django', '< 4.0', '4.0']]]]);
    const results = matchPackages([{ ecosystem: 'pypi', name: 'django', version: '3.2.0' }, { ecosystem: 'pypi', name: 'django' }, { name: 'django', version: '1.0.0' }], { npm: d, pypi: d }, null);
    expect(affectingKeys(results).sort()).toEqual(['GHSA-aaaa-aaaa-aaaa|django@1.0.0', 'GHSA-aaaa-aaaa-aaaa|pypi:django', 'GHSA-aaaa-aaaa-aaaa|pypi:django@3.2.0']);
  });

  it('collects known advisory ids of every loaded ecosystem', () => {
    const ids = knownAdvisoryIds({ npm: data([LODASH]), pypi: data([['GHSA-pypi-0000-0001', 'low', []]]) }, null);
    expect([...ids].sort()).toEqual(['GHSA-aaaa-aaaa-aaaa', 'GHSA-pypi-0000-0001']);
  });
});
