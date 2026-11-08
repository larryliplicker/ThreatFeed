import { describe, expect, it } from 'vitest';
import { buildPopular, decodePopular, POPULAR_MAX_LIST, POPULAR_MAX_TARGETS } from './popular';

const npmLists = { highImpact: ['semver', 'React'], topDependents: ['typescript', 'semver'], topDownloads: ['lodash', 'semver', 'chalk'] };

describe('buildPopular', () => {
  it('uses top downloads, in order, as npm targets and the union as allow', () => {
    const p = buildPopular(npmLists, [], '2026-11-08T00:00:00.000Z');
    expect(p.npm.targets).toEqual(['lodash', 'semver', 'chalk']);
    expect(p.npm.allow).toEqual(['semver', 'react', 'typescript', 'lodash', 'chalk']);
    expect(p.builtAt).toBe('2026-11-08T00:00:00.000Z');
  });

  it('normalises PyPI names, de-duplicates them and keeps popularity order', () => {
    const p = buildPopular(npmLists, ['Requests', 'Foo_Bar.baz', 'foo-bar-baz', 'urllib3', '']);
    expect(p.pypi.allow).toEqual(['requests', 'foo-bar-baz', 'urllib3']);
    expect(p.pypi.targets).toEqual(p.pypi.allow);
  });

  it('caps targets at 5,000 and allow at 20,000', () => {
    const rows = Array.from({ length: 25000 }, (_, i) => `pkg${i}`);
    const p = buildPopular({ highImpact: rows, topDependents: [], topDownloads: rows }, rows);
    expect(p.npm.targets).toHaveLength(POPULAR_MAX_TARGETS);
    expect(p.npm.allow).toHaveLength(POPULAR_MAX_LIST);
    expect(p.pypi.allow).toHaveLength(POPULAR_MAX_LIST);
    expect(p.pypi.targets).toHaveLength(POPULAR_MAX_TARGETS);
    expect(p.pypi.targets[0]).toBe('pkg0');
  });
});

describe('decodePopular', () => {
  const good = { npm: { allow: ['a', 'b'], targets: ['a'] }, pypi: { allow: ['c'], targets: ['c'] }, builtAt: '2026-11-08T00:00:00.000Z' };

  it('reads a built file back', () => {
    expect(decodePopular(good)).toEqual(good);
    const built = buildPopular(npmLists, ['requests']);
    expect(decodePopular(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it('rejects garbage', () => {
    for (const bad of [null, 'x', 5, [], {}, { ...good, npm: null }, { ...good, npm: { allow: [1], targets: [] } }, { ...good, pypi: { allow: [] } },
      { ...good, builtAt: 'yesterday' }, { ...good, builtAt: undefined }, { ...good, npm: { allow: new Array(POPULAR_MAX_LIST + 1).fill('a'), targets: [] } }]) {
      expect(decodePopular(bad)).toBeNull();
    }
  });
});
