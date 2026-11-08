import { describe, expect, it } from 'vitest';
import type { Ecosystem } from '../ecosystems';
import { rulesFor } from './index';

const ECOS: Ecosystem[] = ['npm', 'pypi', 'maven', 'go', 'nuget', 'cargo'];
// A version that every ecosystem parses, written the way that ecosystem writes it.
const v = (eco: Ecosystem, s: string) => rulesFor(eco).parse(eco === 'go' ? `v${s}` : s);

describe('rulesFor', () => {
  it('parse and compare dispatch per ecosystem', () => {
    const r = rulesFor('pypi');
    expect(r.compare(r.parse('1.0rc1'), r.parse('1.0'))).toBe(-1);
    const m = rulesFor('maven');
    expect(m.compare(m.parse('1.0-SNAPSHOT'), m.parse('1.0'))).toBe(-1);
    const c = rulesFor('cargo');
    expect(c.compare(c.parse('1.0.0-alpha'), c.parse('1.0.0'))).toBe(-1);
    const n = rulesFor('npm');
    expect(n.compare(n.parse('1.10.0'), n.parse('1.9.0'))).toBe(1);
  });

  it('cargo uses plain semver (no v prefix, no partial versions)', () => {
    expect(rulesFor('cargo').parse('v1.0.0')).toBeNull();
    expect(rulesFor('cargo').parse('1.0')).toBeNull();
  });

  describe.each(ECOS)('ghsaRange (%s)', (eco) => {
    const r = rulesFor(eco);
    it('handles a closed range', () => {
      const t = r.ghsaRange('>= 2.0.0, < 2.15.0');
      expect(t).not.toBeNull();
      expect(t!(v(eco, '2.14.1'))).toBe(true);
      expect(t!(v(eco, '2.0.0'))).toBe(true);
      expect(t!(v(eco, '2.15.0'))).toBe(false);
      expect(t!(v(eco, '1.9.9'))).toBe(false);
    });
    it('handles <, <= and =', () => {
      expect(r.ghsaRange('< 2.15.0')!(v(eco, '2.14.1'))).toBe(true);
      expect(r.ghsaRange('<= 2.15.0')!(v(eco, '2.15.0'))).toBe(true);
      expect(r.ghsaRange('<= 2.15.0')!(v(eco, '2.15.1'))).toBe(false);
      expect(r.ghsaRange('= 2.15.0')!(v(eco, '2.15.0'))).toBe(true);
      expect(r.ghsaRange('= 2.15.0')!(v(eco, '2.15.1'))).toBe(false);
    });
    it('reads ">= 0" as everything', () => {
      expect(r.ghsaRange('>= 0')!(v(eco, '0.0.1'))).toBe(true);
      expect(r.ghsaRange('>= 0, < 1.0.0')!(v(eco, '0.5.0'))).toBe(true);
      expect(r.ghsaRange('>= 0, < 1.0.0')!(v(eco, '1.0.0'))).toBe(false);
    });
    it('gives null for anything else', () => {
      for (const s of ['garbage', '', '>= x', '~> 1.0', '^1.2.3', '>= 1.0.0 < 2.0.0', '>= 1.0.0,']) {
        expect(r.ghsaRange(s), s).toBeNull();
      }
    });
  });

  it('reads a partial bound in the widest way (semver ecosystems)', () => {
    for (const eco of ['npm', 'cargo', 'go'] as const) {
      const t = rulesFor(eco).ghsaRange('<= 2.15')!;
      expect(t(v(eco, '2.15.7')), eco).toBe(true);
      expect(t(v(eco, '2.16.0')), eco).toBe(false);
    }
  });

  it('reads a partial bound in the widest way in every ecosystem', () => {
    const cases: [Ecosystem, string, string, boolean][] = [
      ['pypi', '<= 3.1', '3.1.5', true],
      ['pypi', '= 3.1', '3.1.5', true],
      ['pypi', '<= 3', '3.9.9', true],
      ['pypi', '<= 3.1', '3.2', false],
      ['pypi', '= 3.1', '3.2.dev1', false],
      ['pypi', '= 3.1', '3.0.9', false],
      ['maven', '<= 3.1', '3.1.5', true],
      ['maven', '= 3.1', '3.1.2', true],
      ['maven', '<= 31.1', '31.1-jre', true],
      ['maven', '<= 3.1', '3.2', false],
      ['maven', '<= 3', '3.9', true],
      ['maven', '<= 3', '4.0', false],
      ['nuget', '<= 4.0', '4.0.1', true],
      ['nuget', '= 4.0', '4.0.9.1', true],
      ['nuget', '<= 4.0', '4.1.0', false],
      ['nuget', '<= 4', '4.9.0', true],
    ];
    for (const [eco, range, ver, want] of cases) {
      const r = rulesFor(eco);
      expect(r.ghsaRange(range)!(r.parse(ver)), `${eco} ${range} vs ${ver}`).toBe(want);
    }
  });

  it('a plain numeric <= / = bound also covers post-release and qualifier variants (PyPI, Maven)', () => {
    const cases: [Ecosystem, string, string, boolean][] = [
      ['pypi', '<= 2.0', '2.0.post1', true],
      ['pypi', '<= 2.0.0', '2.0.0.post1', true],
      ['pypi', '= 2.0.0', '2.0.0.post1', true],
      ['pypi', '<= 2.0.0', '2.0.0+local', true],
      ['pypi', '<= 2.0.0', '2.0.0.1', false],
      ['pypi', '<= 2.0.0', '2.0.1', false],
      ['maven', '<= 31.1.0', '31.1.0-jre', true],
      ['maven', '<= 31.1.0', '31.1-android', true],
      ['maven', '= 31.1.0', '31.1.0-sp1', true],
      ['maven', '<= 31.1.0', '31.1.0-final', true],
      ['maven', '<= 31.1.0', '31.1.1-jre', false],
      ['maven', '<= 31.1.0', '31.10', false],
    ];
    for (const [eco, range, ver, want] of cases) {
      const r = rulesFor(eco);
      expect(r.ghsaRange(range)!(r.parse(ver)), `${eco} ${range} vs ${ver}`).toBe(want);
    }
  });

  it('keeps < and >= exact, including for qualifier variants', () => {
    const p = rulesFor('pypi');
    expect(p.ghsaRange('< 2.15.0')!(p.parse('2.15.0'))).toBe(false);
    expect(p.ghsaRange('< 2.15.0')!(p.parse('2.15.0.post1'))).toBe(false);
    expect(p.ghsaRange('>= 2.15.0')!(p.parse('2.15.0.post1'))).toBe(true);
    const m = rulesFor('maven');
    expect(m.ghsaRange('< 2.15.0')!(m.parse('2.15.0'))).toBe(false);
    expect(m.ghsaRange('< 2.15.0')!(m.parse('2.15.0-jre'))).toBe(false);
    expect(m.ghsaRange('< 2.15.0')!(m.parse('2.14.1-jre'))).toBe(true);
    expect(m.ghsaRange('< 3')!(m.parse('2.9-jre'))).toBe(true);
    expect(m.ghsaRange('< 3')!(m.parse('3.0-jre'))).toBe(false);
    expect(m.ghsaRange('>= 31.1')!(m.parse('31.1-jre'))).toBe(true);
    const n = rulesFor('nuget');
    expect(n.ghsaRange('< 4.0')!(n.parse('4.0.1'))).toBe(false);
  });

  it('refuses text longer than 256 characters as unknown', () => {
    for (const eco of ECOS) {
      const r = rulesFor(eco);
      const long = (eco === 'go' ? 'v' : '') + '1' + '.1'.repeat(200);
      expect(r.parse(long), eco).toBeNull();
      expect(r.ghsaRange(`< ${long}`), eco).toBeNull();
      expect(r.osvAffected(v(eco, '1.0.0'), [{ introduced: '0' }, { fixed: long }]), eco).toBeNull();
    }
  });

  it('does not recurse on a deeply nested Maven version', () => {
    const r = rulesFor('maven');
    expect(() => r.parse('1' + '-1'.repeat(100000))).not.toThrow();
    expect(r.parse('1' + '-1'.repeat(100000))).toBeNull();
    expect(r.parse('1' + '-a'.repeat(100))).not.toBeNull(); // within the cap still works
  });

  it('cargo bounds and events reject a leading v like cargo versions do', () => {
    const c = rulesFor('cargo');
    expect(c.ghsaRange('< v1.0.0')).toBeNull();
    expect(c.osvAffected(c.parse('0.5.0'), [{ introduced: '0' }, { fixed: 'v1.0.0' }])).toBeNull();
  });

  it('accepts GHSA-style Go bounds without the v', () => {
    const r = rulesFor('go');
    expect(r.ghsaRange('>= 0.1.0, < 0.17.0')!(r.parse('v0.16.0'))).toBe(true);
    expect(r.ghsaRange('< 0.17.0')!(r.parse('v0.17.0'))).toBe(false);
    expect(r.ghsaRange('< v0.17.0')!(r.parse('v0.17.0'))).toBe(false);
  });

  it('PyPI and Maven ranges use their own ordering', () => {
    const p = rulesFor('pypi');
    expect(p.ghsaRange('< 1.0')!(p.parse('1.0rc1'))).toBe(true);
    const m = rulesFor('maven');
    expect(m.ghsaRange('< 1.0')!(m.parse('1.0-SNAPSHOT'))).toBe(true);
    expect(m.ghsaRange('>= 2.0-beta9, < 2.15.0')!(m.parse('2.14.1'))).toBe(true);
  });

  describe.each(ECOS)('osvAffected (%s)', (eco) => {
    const r = rulesFor(eco);
    const events = [{ introduced: '0' }, { fixed: '2.15.0' }];
    it('walks introduced / fixed', () => {
      expect(r.osvAffected(v(eco, '2.14.1'), events)).toBe(true);
      expect(r.osvAffected(v(eco, '2.15.0'), events)).toBe(false);
      expect(r.osvAffected(v(eco, '3.0.0'), events)).toBe(false);
    });
    it('handles introduced after the beginning and last_affected', () => {
      const ev = [{ introduced: '2.0.0' }, { last_affected: '2.5.0' }];
      expect(r.osvAffected(v(eco, '1.9.0'), ev)).toBe(false);
      expect(r.osvAffected(v(eco, '2.5.0'), ev)).toBe(true);
      expect(r.osvAffected(v(eco, '2.5.1'), ev)).toBe(false);
    });
    it('gives null for empty, malformed or garbage events', () => {
      expect(r.osvAffected(v(eco, '1.0.0'), [])).toBeNull();
      expect(r.osvAffected(v(eco, '1.0.0'), [{ fixed: '1.0.0' }])).toBeNull();
      expect(r.osvAffected(v(eco, '1.0.0'), [{ introduced: 'garbage' }])).toBeNull();
      expect(r.osvAffected(v(eco, '1.0.0'), [{ introduced: '0', fixed: '1.0.0' }])).toBeNull();
    });
  });

  it('keeps a prerelease below an introduced "0" affected (PyPI dev release)', () => {
    const r = rulesFor('pypi');
    expect(r.osvAffected(r.parse('0.dev1'), [{ introduced: '0' }, { fixed: '1.0' }])).toBe(true);
  });
});
