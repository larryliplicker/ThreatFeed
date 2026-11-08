import { describe, expect, it } from 'vitest';
import { chronologicalSort, showsEarlierDivider } from './frontPageOrder';

describe('chronologicalSort', () => {
  it('keeps newest-first as the default', () => {
    expect(chronologicalSort('newest', false)).toBe('newest');
    expect(chronologicalSort('newest', true)).toBe('newest');
  });
  it('honours an explicit choice', () => {
    for (const s of ['severity', 'oldest', 'recently_read', 'recently_viewed'] as const) {
      expect(chronologicalSort(s, false)).toBe(s);
    }
  });
  it('uses relevance only while searching', () => {
    expect(chronologicalSort('relevance', true)).toBe('relevance');
    expect(chronologicalSort('relevance', false)).toBe('newest');
  });
});

describe('showsEarlierDivider', () => {
  it('shows only for newest-first', () => {
    expect(showsEarlierDivider('newest', false)).toBe(true);
    expect(showsEarlierDivider('relevance', false)).toBe(true);
    expect(showsEarlierDivider('severity', false)).toBe(false);
    expect(showsEarlierDivider('oldest', false)).toBe(false);
    expect(showsEarlierDivider('relevance', true)).toBe(false);
  });
});
