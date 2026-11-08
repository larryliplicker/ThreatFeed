import { describe, expect, it } from 'vitest';
import type { PopularData } from './popular';
import { cleanTyposquatDismissed, typosquatCandidate, typosquatKey, typosquatWarning } from './typosquat';

const popular: PopularData = {
  npm: {
    allow: ['react', 'preact', 'lodash', 'request', 'requests', '@types/node', 'express', 'left-pad'],
    targets: ['react', 'lodash', '@types/node', 'express', 'request', 'left-pad'],
  },
  pypi: {
    allow: ['requests', 'request', 'colorama', 'numpy', 'python-dateutil', 'pip', 'pyyaml'],
    targets: ['requests', 'numpy', 'colorama', 'pyyaml', 'python-dateutil'],
  },
  builtAt: '2026-11-08T00:00:00.000Z',
};

describe('typosquatCandidate', () => {
  it('finds the popular name a transposition or typo is close to', () => {
    expect(typosquatCandidate('pypi', 'reqeusts', popular)).toBe('requests');
    expect(typosquatCandidate('npm', 'lodahs', popular)).toBe('lodash');
    expect(typosquatCandidate('npm', 'expresss', popular)).toBe('express');
  });

  it('never warns about a name on the allow-list, however close to another', () => {
    for (const n of ['requests', 'request', 'preact', 'react']) expect(typosquatCandidate('npm', n, popular)).toBeNull();
    expect(typosquatCandidate('pypi', 'requests', popular)).toBeNull();
    expect(typosquatCandidate('pypi', 'Requests', popular)).toBeNull();
  });

  it('compares PyPI names by PEP 503 and npm names in lower case', () => {
    expect(typosquatCandidate('pypi', 'Python_DateUtil', popular)).toBeNull(); // python-dateutil, on allow
    expect(typosquatCandidate('pypi', 'Reqeusts', popular)).toBe('requests');
    expect(typosquatCandidate('npm', 'LODAHS', popular)).toBe('lodash');
  });

  it('matches a scope swap in both directions', () => {
    expect(typosquatCandidate('npm', 'types-node', popular)).toBe('@types/node');
    expect(typosquatCandidate('npm', 'node-types', popular)).toBe('@types/node');
    expect(typosquatCandidate('npm', '@lodash/express', popular)).toBeNull();
    expect(typosquatCandidate('npm', '@left/pad', popular)).toBe('left-pad');
  });

  it('matches a popular name with a common affix', () => {
    expect(typosquatCandidate('pypi', 'colorama-py', popular)).toBe('colorama');
    expect(typosquatCandidate('pypi', 'py-numpy', popular)).toBe('numpy');
    expect(typosquatCandidate('pypi', 'python-numpy', popular)).toBe('numpy');
    expect(typosquatCandidate('npm', 'lodash-js', popular)).toBe('lodash');
    expect(typosquatCandidate('npm', 'lodash.js', popular)).toBe('lodash');
    expect(typosquatCandidate('npm', 'lodash-py', popular)).toBe('lodash');
  });

  it('matches a name that differs only in separators', () => {
    expect(typosquatCandidate('npm', 'leftpad', popular)).toBe('left-pad');
    expect(typosquatCandidate('npm', 'left_pad', popular)).toBe('left-pad');
    expect(typosquatCandidate('npm', 'left.pad', popular)).toBe('left-pad');
  });

  it('leaves short names to the other rules only', () => {
    const p: PopularData = { ...popular, npm: { allow: ['react'], targets: ['react'] } };
    expect(typosquatCandidate('npm', 'rect', p)).toBeNull();
    expect(typosquatCandidate('npm', 'reakt', p)).toBeNull(); // distance 1, but under 6 characters
    expect(typosquatCandidate('npm', 'reacts', p)).toBeNull(); // 5 characters in react
  });

  it('prefers the most popular candidate', () => {
    const p: PopularData = { ...popular, npm: { allow: ['abcdef', 'abcdeg'], targets: ['abcdeg', 'abcdef'] } };
    expect(typosquatCandidate('npm', 'abcdex', p)).toBe('abcdeg');
  });

  it('does not warn without popular data for the ecosystem', () => {
    expect(typosquatCandidate('npm', 'lodahs', null)).toBeNull();
    const noPypi: PopularData = { ...popular, pypi: { allow: [], targets: [] } };
    expect(typosquatCandidate('pypi', 'reqeusts', noPypi)).toBeNull();
    expect(typosquatCandidate('npm', 'lodahs', noPypi)).toBe('lodash');
  });
});

describe('typosquatWarning', () => {
  it('is null for a dismissed name', () => {
    expect(typosquatWarning('pypi', 'reqeusts', popular, [])).toBe('requests');
    expect(typosquatWarning('pypi', 'reqeusts', popular, [typosquatKey('pypi', 'Reqeusts')])).toBeNull();
    expect(typosquatWarning('npm', 'reqeusts', popular, [typosquatKey('pypi', 'reqeusts')])).toBeNull(); // not close to anything on npm
  });
});

describe('cleanTyposquatDismissed', () => {
  it('keeps unique strings only, at most 500', () => {
    expect(cleanTyposquatDismissed(['pypi:a', 5, null, 'pypi:a', ' npm:b ', '', 'x'.repeat(400)])).toEqual(['pypi:a', 'npm:b']);
    expect(cleanTyposquatDismissed('nope')).toEqual([]);
    expect(cleanTyposquatDismissed(Array.from({ length: 700 }, (_, i) => `npm:p${i}`))).toHaveLength(500);
  });
});
