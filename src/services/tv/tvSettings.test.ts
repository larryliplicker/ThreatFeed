import { describe, it, expect } from 'vitest';
import { TV_INTERVAL_STEPS, migrateTvInterval, parseTvAnimationSpeed, parseTvTileSize } from './tvSettings';

describe('migrateTvInterval', () => {
  it('defaults to 30', () => expect(migrateTvInterval({})).toBe(30));
  it('keeps a valid step', () => expect(migrateTvInterval({ tvIntervalSeconds: 90 })).toBe(90));
  it('snaps to the nearest step', () => expect(migrateTvInterval({ tvIntervalSeconds: 95 })).toBe(90));
  it('clamps low', () => expect(migrateTvInterval({ tvIntervalSeconds: 10 })).toBe(30));
  it('converts minutes', () => {
    expect(migrateTvInterval({ tvIntervalMinutes: 2 })).toBe(120);
    expect(migrateTvInterval({ tvIntervalMinutes: 10 })).toBe(300);
  });
  it('falls back on junk', () =>
    expect(migrateTvInterval({ tvIntervalSeconds: 'x', tvIntervalMinutes: NaN })).toBe(30));
  it('seconds win over minutes', () =>
    expect(migrateTvInterval({ tvIntervalSeconds: 90, tvIntervalMinutes: 5 })).toBe(90));
});

describe('TV_INTERVAL_STEPS', () => {
  it('spans 30..300 in 10 steps', () => {
    expect(TV_INTERVAL_STEPS).toHaveLength(10);
    expect(TV_INTERVAL_STEPS[0]).toBe(30);
    expect(TV_INTERVAL_STEPS[9]).toBe(300);
  });
});

describe('parseTvTileSize', () => {
  it('accepts valid sizes', () => expect(parseTvTileSize('small')).toBe('small'));
  it('defaults to xsmall', () => expect(parseTvTileSize('huge')).toBe('xsmall'));
  it('accepts xsmall', () => expect(parseTvTileSize('xsmall')).toBe('xsmall'));
});

describe('parseTvAnimationSpeed', () => {
  it('accepts valid speeds', () => expect(parseTvAnimationSpeed('slow')).toBe('slow'));
  it('defaults to slow', () => expect(parseTvAnimationSpeed(undefined)).toBe('slow'));
});
