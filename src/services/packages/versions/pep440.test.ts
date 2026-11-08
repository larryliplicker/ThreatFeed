import { describe, expect, it } from 'vitest';
import { comparePep440, parsePep440 } from './pep440';

const cmp = (a: string, b: string) => {
  const x = parsePep440(a);
  const y = parsePep440(b);
  if (!x || !y) throw new Error(`unparseable: ${a} / ${b}`);
  return comparePep440(x, y);
};

describe('PEP 440', () => {
  it('orders dev < alpha < beta < rc < release < post < next', () => {
    const asc = ['1.0.dev1', '1.0a1', '1.0b2', '1.0rc1', '1.0', '1.0.post1', '1.1'];
    for (let i = 0; i < asc.length - 1; i++) {
      expect(cmp(asc[i], asc[i + 1]), `${asc[i]} < ${asc[i + 1]}`).toBe(-1);
      expect(cmp(asc[i + 1], asc[i])).toBe(1);
    }
  });
  it('epoch beats the release segment', () => expect(cmp('1!0.5', '2.0')).toBe(1));
  it('ignores the local segment', () => expect(cmp('1.0+local', '1.0')).toBe(0));
  it('treats trailing zeros as equal', () => {
    expect(cmp('1.0', '1.0.0')).toBe(0);
    expect(cmp('1.0.0', '1')).toBe(0);
  });
  it('accepts the alternate spellings', () => {
    expect(cmp('1.0-alpha1', '1.0a1')).toBe(0);
    expect(cmp('1.0.c1', '1.0rc1')).toBe(0);
    expect(cmp('1.0-1', '1.0.post1')).toBe(0);
    expect(cmp('v1.0', '1.0')).toBe(0);
    expect(cmp('1.0A1', '1.0a1')).toBe(0);
  });
  it('orders a pre-release of a post release and dev of post', () => {
    expect(cmp('1.0.post1.dev1', '1.0.post1')).toBe(-1);
    expect(cmp('1.0.post1.dev1', '1.0')).toBe(1);
    expect(cmp('1.0a1.dev1', '1.0a1')).toBe(-1);
  });
  it('compares numbers numerically', () => expect(cmp('1.10', '1.9')).toBe(1));
  it('returns null for garbage', () => {
    for (const s of ['', 'garbage', '1.0.x', '1..0', '9'.repeat(30) + '.0', 'v', '1.0+']) {
      expect(parsePep440(s), s).toBeNull();
    }
  });
});
