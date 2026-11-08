import { describe, expect, it } from 'vitest';
import { compareNuget, parseNuget } from './nuget';

const cmp = (a: string, b: string) => {
  const x = parseNuget(a);
  const y = parseNuget(b);
  if (!x || !y) throw new Error(`unparseable: ${a} / ${b}`);
  return compareNuget(x, y);
};

describe('NuGet versions', () => {
  it('treats a missing or zero fourth part as equal', () => {
    expect(cmp('1.0.0.0', '1.0')).toBe(0);
    expect(cmp('1', '1.0.0')).toBe(0);
  });
  it('orders a prerelease below the release', () => expect(cmp('1.0.0-beta', '1.0.0')).toBe(-1));
  it('uses the fourth part', () => {
    expect(cmp('4.0.0.1', '4.0.0')).toBe(1);
    expect(cmp('4.0.0.1', '4.0.0.2')).toBe(-1);
  });
  it('orders prerelease labels, ignoring case', () => {
    expect(cmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(cmp('1.0.0-Beta', '1.0.0-beta')).toBe(0);
    expect(cmp('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(cmp('1.0.0-beta', '1.0.0-beta.1')).toBe(-1);
  });
  it('ignores build metadata', () => expect(cmp('1.0.0+abc', '1.0.0')).toBe(0));
  it('compares numerically', () => expect(cmp('1.10.0', '1.9.0')).toBe(1));
  it('returns null for garbage', () => {
    for (const s of ['', 'garbage', '1.0.0.0.0', '1.x', 'v1.0', '1.0.0-', '1.0.0-be ta']) {
      expect(parseNuget(s), s).toBeNull();
    }
  });
});
