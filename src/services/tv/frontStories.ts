import type { Article, Feed } from '../../types';
import { filterAndSortArticles } from '../articles/filterSort';

const NO_FILTERS = {
  searchQuery: '', selectedCategory: null, selectedSourceId: null, selectedTag: null,
  readStatus: 'all', viewedStatus: 'all', bookmarkedOnly: false, dateRange: 'all', sortBy: 'newest',
} as const;

/** The stories the front page's TV wall draws from: newest first, muted keywords and the front page's hidden categories left out */
export function frontWallStories(
  articles: Article[],
  feeds: Feed[],
  settings: { watchlistKeywords: string[]; mutedKeywords?: string[]; frontPageHiddenCategories?: string[] }
): Article[] {
  return filterAndSortArticles(articles, NO_FILTERS, false, feeds, settings.watchlistKeywords, {
    mutedKeywords: settings.mutedKeywords,
    hiddenCategories: settings.frontPageHiddenCategories,
  });
}
