import { describe, expect, it } from 'vitest';
import { compareGo, parseGo } from './goVersion';

const cmp = (a: string, b: string) => {
  const x = parseGo(a);
  const y = parseGo(b);
  if (!x || !y) throw new Error(`unparseable: ${a} / ${b}`);
  return compareGo(x, y);
};

describe('Go module versions', () => {
  it('orders a pseudo-version below the next release', () => {
    expect(cmp('v0.0.0-20230101000000-abcdef123456', 'v0.1.0')).toBe(-1);
  });
  it('orders pseudo-versions by timestamp', () => {
    expect(cmp('v0.0.0-20230101000000-abcdef123456', 'v0.0.0-20240101000000-abcdef123456')).toBe(-1);
  });
  it('orders a pseudo-version based on a release above that release', () => {
    expect(cmp('v1.2.4-0.20230101000000-abcdef123456', 'v1.2.3')).toBe(1);
    expect(cmp('v1.2.4-0.20230101000000-abcdef123456', 'v1.2.4')).toBe(-1);
  });
  it('ignores +incompatible', () => expect(cmp('v1.2.3+incompatible', 'v1.2.3')).toBe(0));
  it('compares numerically', () => expect(cmp('v1.10.0', 'v1.9.0')).toBe(1));
  it('orders prereleases below the release', () => expect(cmp('v1.0.0-rc.1', 'v1.0.0')).toBe(-1));
  it('requires the leading v', () => {
    expect(parseGo('1.2.3')).toBeNull();
    expect(parseGo('vv1.2.3')).toBeNull();
  });
  it('returns null for garbage', () => {
    for (const s of ['', 'v', 'v1', 'v1.2', 'garbage', 'v1.2.x']) expect(parseGo(s), s).toBeNull();
  });
});
