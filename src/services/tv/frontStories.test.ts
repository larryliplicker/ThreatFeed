import { describe, expect, it } from 'vitest';
import { frontWallStories } from './frontStories';
import { article, feed } from '../../test/fixtures';

describe('frontWallStories', () => {
  const feeds = [feed({ id: 'f1', category: 'Vendor' }), feed({ id: 'f2', category: 'News' })];
  const articles = [
    article('old', { sourceId: 'f2', publishedAt: '2026-10-30T10:00:00Z' }),
    article('hidden', { sourceId: 'f1', publishedAt: '2026-10-31T10:00:00Z' }),
    article('new', { sourceId: 'f2', publishedAt: '2026-10-31T11:00:00Z' }),
  ];
  it('is newest first and leaves out the front page\'s hidden categories', () => {
    const ids = frontWallStories(articles, feeds, { watchlistKeywords: [], frontPageHiddenCategories: ['Vendor'] }).map((a) => a.id);
    expect(ids).toEqual(['new', 'old']);
  });
  it('keeps every category when none is hidden', () => {
    expect(frontWallStories(articles, feeds, { watchlistKeywords: [] }).map((a) => a.id)).toEqual(['new', 'hidden', 'old']);
  });
});
