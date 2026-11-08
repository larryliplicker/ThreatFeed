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

  it('compares a partial bound natively for PyPI, Maven and NuGet', () => {
    for (const eco of ['pypi', 'maven', 'nuget'] as const) {
      const t = rulesFor(eco).ghsaRange('< 2.15')!;
      expect(t(v(eco, '2.14.9')), eco).toBe(true);
      expect(t(v(eco, '2.15.0')), eco).toBe(false);
    }
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
