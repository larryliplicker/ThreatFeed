# Final fix report

| Finding | Change | Test |
|---|---|---|
| Important 1 (Sort By on chronological front page) | New pure `src/services/frontPageOrder.ts` (`chronologicalSort`, `showsEarlierDivider`); `App.tsx` uses it. Explicit sort honoured, newest default, relevance only while searching, Earlier divider only when newest-first. | `frontPageOrder.test.ts`; browser check: Severity changes the order, Newest restores it (final-*.png) |
| Important 2 (case-insensitive names) | `normalizeName` lowercases Maven and Go too. npm unchanged. | `entries.test.ts` (normalizeName, new case block); `match.test.ts` Saxon-HE and Go case tests; npm golden unchanged and passing |
| Minor 3 (eco= with file loading/failed) | `VulnerabilitiesPage`: render NpmTab when `eco` is set | none (no component test; wiring is one condition) |
| Minor 4 (duplicate keys) | `NpmTab` uses `resultKey(r)` for cards and malware rows | none (React key) |
| Minor 5 (stale copy) | "My packages" wording on the tab | none |
| Minor 9 + deferred Go test | Invalid message says Go versions start with v. The rejection test for `go:golang.org/x/net@0.17.0` already existed in `entries.test.ts` invalid list. | `entries.test.ts` rejects cases |

Left: Minors 6, 7, 8 (not marked to fix). README and CHANGELOG updated.
Browser: the Earlier divider could not be seen (fresh browser has no last-visit baseline); its decision logic is unit-tested.
