# Part D: package watch for more ecosystems, typosquat warnings, and the UI and defaults list (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Watch PyPI, Maven, Go, NuGet and crates.io packages the way npm is watched today, warn about npm and PyPI typosquats, and ship the user's list of UI and default changes.

**Architecture:**
- **Part 2 first.** The UI and defaults list comes first. Those tasks are independent, settings-heavy and quick.
- **Then Part 1, the ecosystems:**
  - per-ecosystem version-rule modules behind one interface
  - per-ecosystem data files written by the snapshot job
  - one generalised matcher that the existing npm hooks, alerts, tab and TV build on
  - a typosquat check on the device against a published popular-names file

**Tech Stack:** React 18 + TS + Vite + Tailwind, vitest + jsdom, `tsx` snapshot script, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-package-ecosystems-design.md`. Part 1 is the ecosystems and typosquat design; Part 2 is the UI and defaults list. Read both parts; each task names its section.

## Global Constraints

- **Project rules** (CLAUDE.md):
  - client-side only, static-hostable
  - all feed and advisory text is untrusted and rendered as text
  - CSP unchanged
  - backups and imports validated, JSON backup format backward compatible
  - polite to APIs
  - tests next to the code (`*.test.ts`)
- **"Do not redesign the UI".** Reuse the existing card, chip, filter-row and icon styles.
- **Changed defaults** (spec Part 2, "Shared rule"):
  - New installs get the new defaults.
  - Existing installs migrate only settings still exactly at the old default, with a version bump.
  - User-changed values are kept.
- **npm stays unchanged:**
  - `npmPackages`, `npm-advisories.json`, `npm-malware.json`, `npm.xml`, `#/vulns/npm`, `?advisory=`
  - npm alert keys `advisoryId|package[@version]`
- **Other ecosystems:**
  - Entries live in a new `ecosystemPackages: string[]` setting, its own sync collection and backup field.
  - Prefixes: `pypi:` (alias `pip:`), `maven:`, `go:`, `nuget:`, `cargo:` (aliases `rust:`, `crates:`), case-insensitive.
  - The version is after the last `@`. No prefix means npm.
- **GitHub ecosystem query values:** `pip`, `maven`, `go`, `nuget`, `rust`.
- **OSV ecosystem names:** `npm`, `PyPI`, `Maven`, `Go`, `NuGet`, `crates.io`.
- **Per-ecosystem files:** `data/advisories-<eco>.json` with `<eco>` = `pypi|maven|go|nuget|cargo`, in the same shape as `npm-advisories.json`.
- **Popular names:** `data/popular-packages.json`, shaped `{ npm: { allow, targets }, pypi: { allow, targets } }`, targets in popularity order.
- **Unparseable version or range means "unknown", never "not affected".** A missing or failed ecosystem file shows "no data" for that ecosystem.
- **Version rules are pure functions** with table-driven tests.
- **Browser checks:**
  - The user's dev server runs on http://localhost:5173. Never start one.
  - Use playwright-core with Edge (`/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`, headless).
  - Screenshots go to the scratchpad given in the dispatch.

## Review Focus

1. **Upgrading an existing install:** no alert storm, the npm list is untouched, and every setting the user changed survives the migrations. Tasks 1, 2, 6 and 9.
2. **Old kiosk links:** `#/latest?tv=1&mix=1&size=small` still opens mixed TV with the same params after Latest is removed. Task 3.
3. **Package names that look odd:**
   - `maven:org.apache.logging.log4j:log4j-core@2.14.1`, `go:golang.org/x/net@v0.17.0` and `@scope/x@1.0.0` (npm) all parse correctly.
   - `pypi:Foo_Bar.baz` matches `foo-bar-baz`.
   - Tasks 6 and 7.
4. **No false safety:** a failed or missing ecosystem file, or an unparseable version, never shows "not affected". Tasks 7 and 9.
5. **Typosquat noise:**
   - `preact`, `request` and `requests` never warn.
   - Nothing warns when the popular file is missing.
   - Task 10.

---

### Task 1: TV defaults, chronological front-page defaults, empty My Feed, trimmed watchlist (spec Part 2, items 2, 4, 6, 8)

**Files:**
- Modify:
  - `src/context/SettingsContext.tsx`: `DEFAULT_SETTINGS` and the load-time migration
  - `src/types/index.ts`: add `defaultsVersion: number`
  - `src/services/intelligence/alertRules.ts`: `createBuiltInRules`
  - `src/services/intelligence/watchlist.ts`
  - the My Feed empty state (`src/pages/MyFeedPage.tsx`)
- Create: `src/services/settingsMigrations.ts` with `settingsMigrations.test.ts`

**Interfaces:**
- Produces:
  - `SETTINGS_DEFAULTS_VERSION = 1`
  - `migrateDefaults(saved: UserSettings, savedVersion: number): UserSettings`, pure and called from the load path
  - `WATCHLIST_DEFAULTS_VERSION = 3`

**New defaults:**
- `tvIntervalSeconds: 30`, `tvTileSize: 'xsmall'`, `tvAnimationSpeed: 'slow'`
- `sectionsEnabled: false`, `clusteringEnabled: false`
- built-ins `watchlist`, `stack-news`, `stack-vulns`, `watched-cves` start `enabled: false`; `npm-packages` stays enabled
- `DEFAULT_WATCHLIST_KEYWORDS`: exactly the 21 terms in spec Part 2, item 8. Re-mark the presets so these are the defaults. Keep the other terms available in presets.

**Migration** (only when `savedVersion < 1`):
- Each value equal to the old default (60 / `'medium'` / `'fast'` / `true` / `true`) moves to the new one.
- Built-ins with `updatedAt === createdAt` become `enabled: false`.
- A watchlist that equals the version-2 default set (compared case-insensitively, order-free) becomes the new default.
- A changed watchlist is kept, and `upgradeWatchlistKeywords` adds nothing for v3.

- [ ] **Step 1: Write the failing tests** in `settingsMigrations.test.ts`:
  - `untouched install moves to new defaults` (all five values and the built-ins)
  - `changed values are kept` (interval 120, size large, sectionsEnabled true with savedVersion 0 stay)
  - `edited built-in stays enabled`
  - `default watchlist is trimmed` and `custom watchlist is kept`
  - `already migrated is a no-op`

  In `alertRules.test.ts`: `new installs start with only npm-packages enabled`.
- [ ] **Step 2: Run** `npx vitest run src/services/settingsMigrations.test.ts src/services/intelligence`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - My Feed empty state: "Nothing here yet. Turn on a rule in Settings → Alert Rules", linking to `#/settings`. Plain text, existing empty-state style.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): new defaults (TV 30 s / X-Small / Slow, chronological front page, empty My Feed, trimmed watchlist) with untouched-only migration`.

### Task 2: vendor filter as a curated allow-list (spec Part 2, item 9)

**Files:**
- Modify:
  - `src/types/index.ts` (`shownVulnVendors: string[] | null`)
  - `SettingsContext.tsx` (default and cleaning)
  - `src/pages/VulnerabilitiesPage.tsx:61`
  - `src/pages/settings/VulnVendorSettings.tsx`
  - `src/components/VendorPanel.tsx:285-296`
  - the backup export/import and the Gist sync collection list (find them via `hiddenVulnVendors` / `SyncCollection`)
- Create: `src/services/intelligence/vendorFilter.ts` with its test

**Interfaces:**
- Produces:
  - `DEFAULT_SHOWN_VENDORS: string[]`, the 25 names in spec item 9 with KEV spelling. Verify each against `public/data/vulns.json` `kev[].vendor` and fix the spellings.
  - `vendorVisible(vendor: string, s: Pick<UserSettings,'shownVulnVendors'|'hiddenVulnVendors'>): boolean`
  - `migrateVendorFilter(saved): { shownVulnVendors }`: an empty hidden list gives `DEFAULT_SHOWN_VENDORS`, otherwise `null` (legacy mode)
- Sync: `SyncCollection` gains `'shownVulnVendors'`. If the sync code is a union-merge of string sets, store `null` as an absent collection.

- [ ] **Step 1: Write the failing tests:**
  - `vendorVisible` in allow-list and legacy modes
  - the migration in both cases
  - `backup without shownVulnVendors imports as legacy null`
  - `garbage shownVulnVendors is dropped`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The settings UI, in the existing chip style, has:
    - **Shown vendors**: removable chips
    - **Other vendors**: a collapsed list with an add (+)
    - a **Show all vendors** button, which sets the list to the legacy `null` with an empty hidden list
  - The vendor panel's hide/show toggle uses the active mode.
- [ ] **Step 4: Browser-check** Settings and `#/vulns/kev` at 1440 and 390 px, with screenshots. Run lint, tsc and the suite.
- [ ] **Step 5: Commit** `feat(vulns): vendor filter shows the important vendors by default`.

### Task 3: remove the Latest tab; the front page is the chronological stream (spec Part 2, items 4 and 5)

**Files:**
- Modify:
  - `src/components/Navigation/NavigationTabs.tsx`
  - `src/hooks/useHashRoute.ts`
  - `src/App.tsx:109-142,219-233`
  - `src/components/Header/ViewControls.tsx` (TV and TV+ on `newspaper`)
  - `src/components/tv/tvRoute.ts` (`AVAILABLE`)
  - `src/components/Common/KeyboardShortcutsModal.tsx` and any `'latest'` shortcut
  - `AlertMonitor`, `CveWatchMonitor`, `FeedContext` and `TvWall` where `'latest'` is a page id: map them to `newspaper`
- Test: `useHashRoute.test.ts`, `tvRoute.test.ts`

**Behaviour:**
- **Routing:**
  - The `latest` page id is gone. `parseHash('#/latest…')` returns page `newspaper` with the same query params.
  - The hook rewrites the URL with `history.replaceState`, so Back doesn't loop.
- **Front page:**
  - What the `newspaper` page renders comes from the chronological/sections modes, which now default to chronological (Task 1).
  - The "Earlier" divider and the newest-first sort apply whenever the front page is in chronological mode, the way `activeTab === 'latest'` gates them today.
- **TV:**
  - `tvAvailable('newspaper')` offers `tv` and `dash`, as the previous `latest` and `newspaper` entries did.
  - Mixed mode (`mix=1`) is accepted on `newspaper`.
  - The TV news wall for `newspaper` uses Latest's tile source.

- [ ] **Step 1: Write the failing tests:**
  - `#/latest?tv=1&mix=1&size=small` gives `{ page: 'newspaper', params: tv=1, mix=1, size=small }`
  - `#/latest` gives newspaper
  - `tvAvailable('newspaper')` includes `tv`
  - `mix=1` is honoured on newspaper
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Grep `'latest'` across `src` and handle every hit; list them in the report.
- [ ] **Step 4: Browser-check:**
  - `#/` shows the stream with the Earlier divider and no Latest tab, at 1440 and 390 px
  - `#/latest?tv=1&mix=1` opens mixed TV, and its URL becomes `#/?tv=1&mix=1`
  - Esc exits to the front page
- [ ] **Step 5: Run** lint, tsc and the suite. Commit `feat(nav): remove the Latest tab; the front page is the chronological stream; old links redirect`.

### Task 4: click a TV tile or dashboard panel to swap it (spec Part 2, item 1)

**Files:**
- Modify:
  - `src/components/tv/useLivingWall.ts` (expose a manual swap)
  - `src/components/tv/TvWall.tsx`, `DashboardWall.tsx`
  - the tile and panel wrappers: make each one a `<button type="button">`, or give it `role="button" tabIndex=0`
- Test: `useLivingWall.test.ts`

**Interfaces:**
- Produces: `useLivingWall(...)` additionally returns `swapNow(slotKey: string): void`.
  - It runs `planSwap` for that slot immediately, with the normal transition.
  - It resets that slot's timer.
  - It never flags breaking.
  - It is ignored while that slot is mid-transition.

- [ ] **Step 1: Write the failing tests:**
  - `swapNow replaces only that slot`
  - `swapNow resets the slot timer`
  - `swapNow during a transition is ignored`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Click, Enter or Space on a tile or panel calls `swapNow`.
  - The QR code keeps its role, and clicking a tile never opens the reader.
  - The cursor is a pointer, and the focus ring uses the existing focus style.
- [ ] **Step 4: Browser-check** `#/?tv=1` and `#/vulns?dash=1`: a click swaps that tile within the transition time, and the others don't move. Run lint, tsc and the suite.
- [ ] **Step 5: Commit** `feat(tv): click a tile or panel to swap it`.

### Task 5: greyscale icons instead of colour emoji (spec Part 2, item 7)

**Files:**
- Modify:
  - `src/components/Reader/ReaderModal.tsx:407` (🎯)
  - `src/pages/settings/RuleEditor.tsx:109`, `AlertRulesSettings.tsx:154` (🔔)
  - `src/pages/FeedHealthPage.tsx:579,1125` (⚡)
  - `src/pages/incidents/VictimsTab.tsx:126` (🌍)
  - `src/components/tv/vulnPanels.tsx:109` (★)
  - every `countryFlag` caller (`ActorPanel`, `GroupsTab`, `GroupPanel`, `PublicReportsTab`)
  - `src/utils/countries.ts`
  - `WatchingTab.tsx:72` (help text mentions 🔔: change it to "the bell")
- Create: `src/components/Common/CountryCode.tsx`

**Interfaces:**
- Produces: `<CountryCode code={string|undefined} />`, a monospace two-letter chip in the existing muted chip style, with `title={countryName(code)}`. It renders nothing for an invalid code.
- `countryFlag` is deleted once it has no callers.

**Icons:** lucide `Target`, `Bell`/`BellOff`, `Zap`, `Globe`, `Star`, at `w-3.5 h-3.5` (TV: the existing pill size) and `text-theme-text-muted` (on TV, the existing grey).

- [ ] **Step 1: Write the failing test:** a source scan in `src/noColorEmoji.test.ts`. It reads every `src/**/*.tsx` except tests and fails on any code point in `\u{1F300}-\u{1FAFF}`, `\u{2600}-\u{27BF}` (excluding ✓ U+2713 and ✕ U+2715) or `\u{1F1E6}-\u{1F1FF}`. Comments are allowed (strip `//` and `/* */` first). Expected: FAIL listing the files above.
- [ ] **Step 2: Implement** until it passes. Also add a render test for `CountryCode` (`SE` gives the text "SE" and the title "Sweden"; `x1` gives nothing).
- [ ] **Step 3: Browser-check** Ransomware → Groups and Public reports, an actor panel, Settings → Alert Rules and Feed Health. Run lint, tsc and the suite.
- [ ] **Step 4: Commit** `fix(ui): greyscale icons and country codes instead of colour emoji`.

### Task 6: package entries for all ecosystems, and their storage (spec Part 1, "Package entries")

**Files:**
- Create: `src/services/packages/ecosystems.ts` and `entries.ts`, each with a test
- Modify:
  - `src/types/index.ts` (`ecosystemPackages: string[]`)
  - `SettingsContext.tsx`
  - backup export/import, Gist sync (`SyncCollection` gains `'ecosystemPackages'`)
  - the Settings "My npm packages" input becomes "My packages"

**Interfaces:**
- Produces:
  - `type Ecosystem = 'npm' | 'pypi' | 'maven' | 'go' | 'nuget' | 'cargo'`
  - `ECOSYSTEMS: Record<Ecosystem, { label: string; ghsa: string; osv: string; prefixes: string[] }>` with labels npm, PyPI, Maven, Go, NuGet, crates.io and the GHSA/OSV names from Global Constraints
  - `interface EcoEntry { ecosystem: Ecosystem; name: string; version?: string }`
  - `parseEntry(s: string): EcoEntry | null`. No prefix delegates to the existing npm `parsePackageEntry`.
  - `formatEntry(e: EcoEntry): string` round-trips. npm has no prefix; the others use the canonical prefix.
  - `normalizeName(eco, name): string`: npm lowercase; PyPI PEP 503; NuGet lowercase; cargo maps `_` to `-`; Maven and Go unchanged.
  - `splitEntries(input: string[]): { npm: string[]; other: string[] }`
  - `cleanEcosystemList(raw: unknown): string[]`, which drops invalid, npm and duplicate entries and caps at 500
- Name rules:
  - Maven is `group:artifact`, exactly one colon after the prefix.
  - Go is a module path containing a `/` or a dot, with a version that starts with `v`.
  - NuGet and crates.io use their registry character sets.
  - The version check here is syntactic only (non-empty, no spaces). Task 7 parses it.

- [ ] **Step 1: Write the failing tests:**
  - A table of valid and invalid entries, including every example in the spec and Review Focus 3: `pip:requests` maps to pypi, `RUST:serde` to cargo, and `maven:g` (no artifact) is invalid.
  - `formatEntry(parseEntry(x))` round-trips.
  - `normalizeName('pypi','Foo_Bar.baz') === 'foo-bar-baz'`.
  - `cleanEcosystemList` drops npm entries and garbage.
  - `old backup without ecosystemPackages imports as []`.
  - **Older builds:** a test in the sync module showing that a Gist with an unknown `ecosystemPackages` collection, merged by the current code's merge function, keeps it. Read the merge code and record the outcome for older builds in the report. If an older build would delete the collection, rule on it in the report and stop.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Settings input accepts both kinds and stores them split. Chips show an ecosystem label for non-npm entries.
  - Help text: "`name@version` for npm; prefix others: `pypi:`, `maven:group:artifact`, `go:`, `nuget:`, `cargo:`".
- [ ] **Step 4: Run** lint, tsc and the suite. Commit `feat(packages): entries for PyPI, Maven, Go, NuGet and crates.io, stored and synced separately`.

### Task 7: version rules per ecosystem (spec Part 1, "Version rules")

**Files:**
- Create: `src/services/packages/versions/{pep440,maven,goVersion,nuget,index}.ts`, each with a test
- Reuse: `src/services/npm/semver.ts` for npm and cargo (cargo through the plain semver parse, no npm range sugar)

**Interfaces:**
- Produces: `interface VersionRules { parse(v: string): unknown | null; compare(a, b): -1|0|1; ghsaRange(range: string): ((v) => boolean) | null; osvAffected(v, events: OsvEvent[]): boolean | null }`
- `rulesFor(eco: Ecosystem): VersionRules`.
- `ghsaRange` accepts GHSA's comma-separated `>= x, < y`, `<= y`, `= x` and `< y` forms. Anything else gives `null` (unknown).

- [ ] **Step 1: Write the failing tests** (table-driven, ascending orderings):
  - **PEP 440:** `1.0.dev1 < 1.0a1 < 1.0b2 < 1.0rc1 < 1.0 < 1.0.post1 < 1.1`; `1!0.5 > 2.0`; `1.0+local == 1.0` for comparison; `1.0 == 1.0.0`
  - **Maven:** `1.0-alpha-1 < 1.0-beta < 1.0-milestone-1 < 1.0-rc1 < 1.0-SNAPSHOT < 1.0 < 1.0-sp1 < 1.0.1`; `1.0 == 1.0.0 == 1-0`; `2.14.1 < 2.15.0`; qualifiers are case-insensitive
  - **Go:** `v0.0.0-20230101000000-abcdef123456 < v0.1.0`; `v1.2.3+incompatible == v1.2.3`; `v1.10.0 > v1.9.0`; no `v` means null
  - **NuGet:** `1.0.0.0 == 1.0`; `1.0.0-beta < 1.0.0`; `4.0.0.1 > 4.0.0`
  - **cargo:** standard semver, `1.0.0-alpha < 1.0.0`
  - **`ghsaRange` on each:** `'>= 2.0.0, < 2.15.0'` contains 2.14.1 but not 2.15.0; `'garbage'` gives null
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite. Commit `feat(packages): version rules for PyPI, Maven, Go, NuGet and crates.io`.

### Task 8: snapshot: per-ecosystem advisories and popular names (spec Part 1, "Data")

**Files:**
- Modify: `scripts/build-snapshot.ts` (generalise `npmAdvisoryPages` and the reviewed-advisory builder over an `ecosystem` argument)
- Modify: `src/services/npm/advisories.ts`. Generalise `normalizeGhsaNpm` to `normalizeGhsa(raw, eco, cweNames)`, keeping the npm export as a wrapper.
- Modify: `.github/workflows/deploy.yml`, extending the "keep the previous published file" step to the new files
- Modify: `package.json` (devDependency `npm-high-impact`)
- Create: `src/services/packages/popular.ts` with a test (builder and decoder)

**Interfaces:**
- Produces:
  - `data/advisories-<eco>.json`, `NpmAdvisoryData`-shaped, decoded by the existing `decodeNpmData`
  - `buildPopular(npmLists, pypiRows): PopularData`
  - `decodePopular(raw: unknown): PopularData | null`, which validates (strings only, max 20,000 per list)
  - `PopularData = { npm: { allow: string[]; targets: string[] }; pypi: {...}; builtAt: string }`
- **npm lists:**
  - targets are `npmTopDownloads`, in order, max 5,000
  - allow is the union of `npmHighImpact`, `npmTopDependents` and `npmTopDownloads`, normalised
- **PyPI lists**, from `https://hugovk.dev/top-pypi-packages/top-pypi-packages.min.json` (`rows[].project`):
  - allow is all rows
  - targets are the first 5,000
- **Refresh and caps:**
  - Popular names refresh when the previous `builtAt` is more than 24 h old; otherwise the previous file is copied.
  - On a source failure, keep the previous list.
  - Per-ecosystem page cap is `ECO_REVIEWED_MAX_PAGES = 150`. Hitting it follows the existing npm behaviour (no previous file: not written and reported failed; previous file: kept).

- [ ] **Step 1: Write the failing tests:**
  - `normalizeGhsa` keeps only the requested ecosystem's vulnerabilities, using real GHSA JSON fixtures for pip and maven (one each, trimmed)
  - `buildPopular` ordering, caps and normalisation
  - `decodePopular` rejects garbage
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `npm run snapshot` locally once. It hits real APIs; GITHUB_TOKEN comes from `gh auth token` if available, else unauthenticated with low caps. Record each file's size raw and gzipped in the report.
- [ ] **Step 4: Run** lint, tsc and the suite. Commit `feat(snapshot): advisories for PyPI, Maven, Go, NuGet and crates.io; popular package names`. Do **not** commit the generated `public/data` files unless they are already tracked; check `git ls-files public/data`.

### Task 9: matching, lazy loading, OSV and alerts across ecosystems (spec Part 1, "Matching, OSV, alerts")

**Files:**
- Modify:
  - `src/services/npm/match.ts`: `matchPackages` takes `EcoEntry[]` and a `Partial<Record<Ecosystem, NpmAdvisoryData>>`; `PackageResult` gains `ecosystem`
  - `src/services/npm/osv.ts`: the OSV ecosystem per entry
  - `src/hooks/useNpmAdvisories.ts`: loads `advisories-<eco>.json` only for watched ecosystems or the selected tab filter; cached like npm
  - `src/hooks/useNpmMatches.ts`
  - the built-in `npm-packages` alert evaluation and `npmSeen` / known-entries code (find it via `npmSeen`); label "My packages"

**Interfaces:**
- Produces:
  - `useEcosystemAdvisories(ecos: Ecosystem[]): { data: Partial<Record<Ecosystem, NpmAdvisoryData>>; failed: Ecosystem[] }`
  - a failed ecosystem's entries get status `unknown` with the reason "no data"
- Alert keys: npm unchanged; others are `advisoryId|<eco>:<name>[@version]`, the same in the known-entries list.

- [ ] **Step 1: Write the failing tests:**
  - a PyPI entry is affected by a pip advisory and not by an npm advisory of the same name
  - a Maven entry with an unparseable version gives `unknown`
  - a failed ecosystem gives `unknown`, not `not-affected`
  - npm results are byte-identical to before for an npm-only list (snapshot an existing test's output)
  - adding a PyPI package with existing advisories sends no alert, and a new advisory after that alerts once
  - existing npm `npmSeen` keys are still recognised
  - OSV queries carry `PyPI` / `Maven` names
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** lint, tsc and the suite. Commit `feat(packages): match, alert and OSV across ecosystems`.

### Task 10: typosquat check (spec Part 1, "Typosquat check")

**Files:**
- Create: `src/services/packages/typosquat.ts` with a test; `src/hooks/usePopularPackages.ts`
- Modify:
  - `src/types/index.ts` (`typosquatDismissed: string[]`), plus settings, backup and sync like the other lists
  - the Settings package chips and the My packages view

**Interfaces:**
- Produces: `typosquatCandidate(eco: 'npm'|'pypi', name: string, popular: PopularData): string | null`.
  - It returns null if the name is on `allow` (after normalisation).
  - Otherwise it returns the most popular `targets` entry matching any of these rules:
    - Damerau-Levenshtein distance 1, when both names are 6 or more characters
    - equal after removing `-`, `_` and `.`
    - npm scope swap (`@a/b` against `a-b` or `b-a`)
    - the target plus one affix from `-js .js -py py- python-`
  - Otherwise it returns null.
  - `usePopularPackages()` loads `data/popular-packages.json` only when at least one npm or PyPI entry is watched.

- [ ] **Step 1: Write the failing tests:**
  - `reqeusts` (pypi) gives `requests`
  - `requests`, `request` and `preact` give null when on allow
  - `lodahs` gives `lodash`
  - `@types/node` against `types-node` gives `@types/node`
  - `colorama-py` gives `colorama`
  - short names (`rect`) give null
  - with no popular data, nothing warns
  - a dismissed name gives no chip; this is a render test
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Chip: "Did you mean `requests`?", in the existing amber warning chip style, with a dismiss ×.
  - No notification.
- [ ] **Step 4: Run** lint, tsc and the suite. Commit `feat(packages): typosquat warnings for npm and PyPI`.

### Task 11: the Packages tab, its charts and the TV (spec Part 1 "UI"; Part 2 item 3, as revised)

**Files:**
- Modify:
  - `src/pages/VulnerabilitiesPage.tsx:71` (label "Packages")
  - `src/pages/vulns/NpmTab.tsx` (ecosystem filter `eco=`, ecosystem label on rows, the chart grid, the My packages donut)
  - `src/services/charts/figures.ts`: `advisoriesByEcosystem(data, now)`
  - `src/services/tv/tiles.ts`, `TvTileCard.tsx`, `npmPanels.tsx`, `NpmDashboard.tsx` (all watched ecosystems; ecosystem label)
  - `src/pages/vulns/npmFilters.ts`

**Behaviour:**
- **Ecosystem select:** in the existing filter row: All, npm, PyPI, Maven, Go, NuGet, crates.io. The malware section shows only when the filter is All or npm.
- **Chart grid:** only the three existing cards stay, unchanged (`md:grid-cols-2 xl:grid-cols-3`): By severity, Vulnerabilities vs malware, Fix available.
- **Left `<aside>`** (`NpmTab.tsx` ~308), under "Most advisories (30 days)", in order:
  1. Top weaknesses (RankedBars, moved)
  2. **Advisories by ecosystem (30 d)** (donut over the loaded ecosystems)
  3. My packages status donut (when packages exist, moved)
  - Each block gets a `SectionTitle` heading and the aside's width, with no new card chrome.
  - On phones the aside stacks above the list, as today.
- **TV:** tiles and dashboard panels show a small ecosystem label (as text). The QR code is still the GitHub advisory URL.

- [ ] **Step 1: Write the failing tests:**
  - `advisoriesByEcosystem` sums to 100 and folds per the existing `foldSlices`
  - the filter's `eco` param round-trips
  - `tilesForNpm` includes a PyPI advisory affecting a watched PyPI package, with its label
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Browser-check:**
  - `#/vulns/npm` at 1440 px (one row of 3 charts on top; the side column holds Most advisories, Top weaknesses, By ecosystem and My packages), 800 and 390 px, light and dark, with a watched `pypi:` package
  - `#/vulns/npm?dash=1` and `?tv=1`
  - no horizontal scroll and no console errors
- [ ] **Step 5: Run** lint, tsc and the suite. Commit `feat(packages): Packages tab with ecosystem filter, side-column charts, and ecosystem-aware TV`.

### Task 12: docs

- [ ] **README:**
  - Packages (entry syntax, ecosystems, typosquat warnings, data sources with the hugovk and npm-high-impact credits)
  - new defaults
  - no Latest tab (old links redirect)
  - kiosk URLs as `#/?tv=1&mix=1`
  - click-to-swap
  - vendor allow-list
- [ ] **CHANGELOG:** Unreleased lines for each user-visible change.
- [ ] **CLAUDE.md:** the data-file list gains `advisories-<eco>.json` and `popular-packages.json`; `src/services/packages/` is described.
- [ ] **Commit** `docs: package ecosystems, typosquat warnings and the new defaults`.
