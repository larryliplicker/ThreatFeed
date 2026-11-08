import { describe, expect, it } from 'vitest';
import { compareMaven, parseMaven } from './maven';

const cmp = (a: string, b: string) => {
  const x = parseMaven(a);
  const y = parseMaven(b);
  if (!x || !y) throw new Error(`unparseable: ${a} / ${b}`);
  return compareMaven(x, y);
};

describe('Maven ComparableVersion', () => {
  it('orders qualifiers alpha < beta < milestone < rc < snapshot < release < sp < next', () => {
    const asc = ['1.0-alpha-1', '1.0-beta', '1.0-milestone-1', '1.0-rc1', '1.0-SNAPSHOT', '1.0', '1.0-sp1', '1.0.1'];
    for (let i = 0; i < asc.length - 1; i++) {
      expect(cmp(asc[i], asc[i + 1]), `${asc[i]} < ${asc[i + 1]}`).toBe(-1);
      expect(cmp(asc[i + 1], asc[i])).toBe(1);
    }
  });
  it('treats trailing zeros and dash-zero as equal', () => {
    expect(cmp('1.0', '1.0.0')).toBe(0);
    expect(cmp('1.0.0', '1-0')).toBe(0);
    expect(cmp('1', '1-0')).toBe(0);
  });
  it('compares numeric segments numerically', () => {
    expect(cmp('2.14.1', '2.15.0')).toBe(-1);
    expect(cmp('1.10', '1.9')).toBe(1);
  });
  it('is case-insensitive for qualifiers', () => {
    expect(cmp('1.0-RC1', '1.0-rc1')).toBe(0);
    expect(cmp('1.0-SNAPSHOT', '1.0-snapshot')).toBe(0);
    expect(cmp('1.0-Alpha', '1.0-alpha')).toBe(0);
  });
  it('knows the aliases', () => {
    expect(cmp('1.0-a1', '1.0-alpha-1')).toBe(0);
    expect(cmp('1.0-cr1', '1.0-rc1')).toBe(0);
    expect(cmp('1.0-ga', '1.0')).toBe(0);
    expect(cmp('1.0-final', '1.0')).toBe(0);
  });
  it('ranks an unknown qualifier above the known ones', () => {
    expect(cmp('1.0-foo', '1.0-sp1')).toBe(1);
    expect(cmp('1.0-foo', '1.0')).toBe(1);
  });
  it('handles a real-world log4j sequence', () => {
    expect(cmp('2.0-beta9', '2.0-rc1')).toBe(-1);
    expect(cmp('2.17.0', '2.17.1')).toBe(-1);
    expect(cmp('2.0-rc1', '2.0')).toBe(-1);
  });
  it('returns null for empty or non-version text', () => {
    for (const s of ['', ' ', 'garbage', 'x', '-1', '1.0 beta', '1.0;x', '../1']) expect(parseMaven(s), s).toBeNull();
  });
});
