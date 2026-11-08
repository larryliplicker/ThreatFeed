import type { FilterState } from '../types';

type SortBy = FilterState['sortBy'];

/**
 * The sort a chronological front page uses. Newest-first is the default; an explicit Sort By choice
 * (Severity, Oldest, ...) is honoured, and Relevance only means something while searching.
 */
export function chronologicalSort(sortBy: SortBy, isSearching: boolean): SortBy {
  if (sortBy === 'relevance') return isSearching ? 'relevance' : 'newest';
  return sortBy;
}

/** The "Earlier" divider only makes sense in a newest-first stream */
export function showsEarlierDivider(sortBy: SortBy, isSearching: boolean): boolean {
  return chronologicalSort(sortBy, isSearching) === 'newest';
}
