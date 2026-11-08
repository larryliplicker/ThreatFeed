import { describe, expect, it } from 'vitest';
import { ECOSYSTEMS } from './ecosystems';
import { cleanEcosystemList, formatEntry, normalizeName, parseEntry, splitEntries } from './entries';

describe('ECOSYSTEMS', () => {
  it('carries labels and the GHSA / OSV names', () => {
    expect(Object.values(ECOSYSTEMS).map(e => e.label)).toEqual(['npm', 'PyPI', 'Maven', 'Go', 'NuGet', 'crates.io']);
    expect(Object.values(ECOSYSTEMS).map(e => e.ghsa)).toEqual(['npm', 'pip', 'maven', 'go', 'nuget', 'rust']);
    expect(Object.values(ECOSYSTEMS).map(e => e.osv)).toEqual(['npm', 'PyPI', 'Maven', 'Go', 'NuGet', 'crates.io']);
  });
});

describe('parseEntry', () => {
  const valid: [string, object][] = [
    ['lodash', { ecosystem: 'npm', name: 'lodash' }],
    ['lodash@4.17.15', { ecosystem: 'npm', name: 'lodash', version: '4.17.15' }],
    ['@scope/x@1.0.0', { ecosystem: 'npm', name: '@scope/x', version: '1.0.0' }],
    ['pypi:requests@2.31.0', { ecosystem: 'pypi', name: 'requests', version: '2.31.0' }],
    ['pip:requests', { ecosystem: 'pypi', name: 'requests' }],
    ['PyPI:Foo_Bar.baz', { ecosystem: 'pypi', name: 'Foo_Bar.baz' }],
    ['maven:org.apache.logging.log4j:log4j-core@2.14.1', { ecosystem: 'maven', name: 'org.apache.logging.log4j:log4j-core', version: '2.14.1' }],
    ['go:golang.org/x/net@v0.17.0', { ecosystem: 'go', name: 'golang.org/x/net', version: 'v0.17.0' }],
    ['go:github.com/foo/bar', { ecosystem: 'go', name: 'github.com/foo/bar' }],
    ['nuget:Newtonsoft.Json@13.0.1', { ecosystem: 'nuget', name: 'Newtonsoft.Json', version: '13.0.1' }],
    ['cargo:serde@1.0.188', { ecosystem: 'cargo', name: 'serde', version: '1.0.188' }],
    ['RUST:serde', { ecosystem: 'cargo', name: 'serde' }],
    ['crates:serde_json', { ecosystem: 'cargo', name: 'serde_json' }],
  ];
  it.each(valid)('accepts %s', (input, expected) => {
    expect(parseEntry(input)).toEqual(expected);
  });

  const invalid = [
    '', 'maven:g', 'maven:g:a:c', 'maven::a', 'maven:g:', 'maven:g:a@', 'go:foo', 'go:golang.org/x/net@0.17.0',
    'pypi:', 'pypi:@1.0', 'pypi:foo@', 'pypi:foo@1 0', 'nuget:bad name', 'cargo:1abc', 'ruby:rails', 'Lodash@^4', 'lodash:x',
  ];
  it.each(invalid)('rejects %j', input => {
    expect(parseEntry(input)).toBeNull();
  });

  it('round-trips through formatEntry, canonicalising prefixes', () => {
    for (const [input] of valid) {
      const entry = parseEntry(input)!;
      expect(parseEntry(formatEntry(entry))).toEqual(entry);
    }
    expect(formatEntry(parseEntry('pip:requests@2.31.0')!)).toBe('pypi:requests@2.31.0');
    expect(formatEntry(parseEntry('RUST:serde')!)).toBe('cargo:serde');
    expect(formatEntry(parseEntry('@scope/x@1.0.0')!)).toBe('@scope/x@1.0.0');
    expect(formatEntry(parseEntry('maven:a.b:c@1')!)).toBe('maven:a.b:c@1');
  });
});

describe('normalizeName', () => {
  it('follows each ecosystem', () => {
    expect(normalizeName('pypi', 'Foo_Bar.baz')).toBe('foo-bar-baz');
    expect(normalizeName('pypi', 'a--b__c')).toBe('a-b-c');
    expect(normalizeName('npm', 'Lodash')).toBe('lodash');
    expect(normalizeName('nuget', 'Newtonsoft.Json')).toBe('newtonsoft.json');
    expect(normalizeName('cargo', 'serde_json')).toBe('serde-json');
    expect(normalizeName('maven', 'Org.Foo:Bar_x')).toBe('Org.Foo:Bar_x');
    expect(normalizeName('go', 'Github.com/Foo/bar')).toBe('Github.com/Foo/bar');
  });
});

describe('splitEntries', () => {
  it('separates npm from the rest and drops invalid and duplicate entries', () => {
    expect(splitEntries(['lodash@4.17.15', 'pip:Requests', 'pypi:requests', 'pypi:Foo_Bar', 'pypi:foo-bar', 'maven:g:a@1', 'bad entry', 'lodash@4.17.15'])).toEqual({
      npm: ['lodash@4.17.15'],
      other: ['pypi:Requests', 'pypi:Foo_Bar', 'maven:g:a@1'],
    });
  });
});

describe('cleanEcosystemList', () => {
  it('drops npm entries, garbage and duplicates', () => {
    expect(cleanEcosystemList(['lodash', 'rust:serde', 'cargo:serde', 7, null, 'maven:g', 'nuget:Newtonsoft.Json@13.0.1'])).toEqual([
      'cargo:serde',
      'nuget:Newtonsoft.Json@13.0.1',
    ]);
  });
  it('returns [] for anything that is not an array (an old backup without the field)', () => {
    expect(cleanEcosystemList(undefined)).toEqual([]);
    expect(cleanEcosystemList('pypi:requests')).toEqual([]);
    expect(cleanEcosystemList({})).toEqual([]);
  });
  it('caps the list at 500', () => {
    const many = Array.from({ length: 600 }, (_, i) => `cargo:crate-${i}`);
    expect(cleanEcosystemList(many)).toHaveLength(500);
  });
});
