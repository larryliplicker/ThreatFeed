# Package watch for more ecosystems, and typosquat warnings — design

Date: 2026-11-05. Builds on the npm vulnerability watch (Part B, `docs/superpowers/specs/2026-11-04-npm-watch-and-audit-batch-design.md`) and the charts/TV work (Part C).

The user asked for "item 6" of the npm improvement list: watch packages from other ecosystems and warn about typosquats. They skipped the questions, so every choice below marked **(call)** is the assistant's, open to correction at approval.

## Intent

Today ThreatFeed can only watch npm packages. Most people also ship Python, Java, Go, .NET or Rust code. They want the same watch for those packages: highlights, notifications, TV "Yours" tiles. They also want to be told when a watched name looks like a misspelling of a popular package, because a typosquat is often how malware gets in.

## Goals

1. **Five more ecosystems** **(call)**: PyPI, Maven, Go, NuGet and crates.io (Rust).
   - Matching runs on your device against reviewed GitHub advisories, like npm today.
   - It produces the same statuses (affected, not affected, no version, unknown), a minimum safe version, alerts and TV tiles.
2. **Typosquat warnings for npm and PyPI** **(call)**, the two ecosystems where typosquatting is common and a good popular-package list exists.
   - A watched name that isn't itself popular, but is very close to a popular name, gets a warning: "Did you mean `requests`?"
3. **Everything that exists for npm keeps working unchanged**, including:
   - the files and links: `npm-advisories.json`, `npm-malware.json`, `npm.xml`, `#/vulns/npm`, `?advisory=`
   - the settings field, sync and backups

## Non-goals

- Other ecosystems: RubyGems, Composer/Packagist, Pub, Swift, Erlang and GitHub Actions. The design must make adding one a small change (a new version-rules module and a list entry), but they aren't built now.
- Malware lists for the new ecosystems. GitHub's `type=malware` advisories are essentially npm-only, and other sources would be a new data feed. npm malware stays as is.
- Lockfile or manifest import. That is item 1, a separate project.
- New RSS feeds for the new ecosystems.
- Typosquat checks for Maven, Go, NuGet and crates.io. There's no good popular-name list (Maven, Go), or typosquatting is rare there.

## Anti-goals

- **No UI redesign** (standing rule): no new top-level page.
  - The Vulns tab keeps its place and becomes **"Packages"**; the route stays `#/vulns/npm`.
  - An ecosystem filter joins the existing filter row.
- **No noisy warnings.** A typosquat warning on a popular, legitimate package (e.g. `react` vs `preact`, `request` vs `requests`) is a failure. The popular list is the allow-list: a watched name that is itself popular never warns.
- **No privacy regression.** Nothing about your packages leaves the device unless you have turned on the OSV lookup, which stays opt-in and off by default.
- **Don't make npm-only users pay.** Files for an ecosystem load only when you watch a package in it or filter the tab to it.

## How it works

### Package entries **(call)**

- An entry is `name`, `name@version`, or the same with an ecosystem prefix: `pypi:requests@2.31.0`, `maven:org.apache.logging.log4j:log4j-core@2.14.1`, `go:golang.org/x/net@v0.17.0`, `nuget:Newtonsoft.Json@13.0.1`, `cargo:serde@1.0.188`.
- No prefix means npm, so every existing list keeps its meaning.
- Prefixes are case-insensitive. `pip:` is accepted as an alias for `pypi:`, and `rust:` / `crates:` for `cargo:`.
- The version is the part after the **last** `@`. Watch out for the existing npm scoped-name rule (`@scope/name@1.0.0`); Maven names contain colons, so only the first `prefix:` is the prefix, and only when it is a known prefix.
- **Storage (call, revised after the builder check):** the input box takes the whole list, but storage splits it.
  - npm entries stay in `npmPackages` exactly as today.
  - Entries for the other ecosystems go in a **new setting, `ecosystemPackages: string[]`**, holding prefixed entries. It is its own sync collection (`ecosystemPackages`) and its own backup field, cleaned and validated by a new `cleanEcosystemList`.
  - Why: the existing `cleanPackageList` (run on settings load, backup import and sync) rejects colons. An older build on another device would strip prefixed entries from `npmPackages` and sync the shorter list back, deleting them everywhere.
  - The plan must check that an older build leaves an unknown setting field and an unknown sync collection untouched. If it doesn't, the new collection must be written so an older build can't delete it.
  - Old backups (without the field) import as an empty list. The UI calls the whole thing "My packages".
- Name normalisation for matching:
  - npm: lowercase (as today)
  - PyPI: PEP 503 (lowercase; runs of `-_.` become `-`)
  - NuGet: case-insensitive
  - Maven, Go and crates.io: case-sensitive as published (crates.io treats `-` and `_` as equal; normalise that)

### Version rules (per ecosystem)

Each ecosystem gets a module with the same small interface as `src/services/npm/semver.ts`: parse a version, compare two versions, and test a GHSA range string (`>= 1.0, < 1.2.3`) and OSV events.

| Ecosystem | Rules |
|---|---|
| PyPI | PEP 440: epochs, pre/post/dev releases, local versions ignored for comparison |
| Maven | Maven's ComparableVersion ordering: qualifiers alpha < beta < milestone < rc/cr < snapshot < "" (release) < sp, numeric segments compared numerically |
| Go | semver with a leading `v`; `+incompatible` stripped; pseudo-versions (`v0.0.0-2023…-abcdef`) compare as pre-releases |
| NuGet | NuGet SemVer 2 (4-part versions allowed, trailing `.0` equal) |
| crates.io | semver (the existing npm parser, without npm's range syntax) |

- **Unparseable means "unknown", never "safe"**, as today.
- The existing widest-reading rule for partial bounds applies everywhere.

### Data **(call)**

- The snapshot job fetches each ecosystem from `GET https://api.github.com/advisories?type=reviewed&ecosystem=<pip|maven|go|nuget|rust>`. It reuses the npm builder: the same incremental update by `updated` time, the same backfill page cap, and the same "keep the previously published file on failure" behaviour.
- Output: one file per ecosystem, `data/advisories-<ecosystem>.json`, in the same shape as `npm-advisories.json`. That's a compact index of every reviewed advisory for matching, plus full detail for 90 days. npm keeps its file name.
- **Politeness:**
  - **No partial files (call):** each ecosystem gets a page cap high enough to finish its first backfill in one run (Maven is the largest, a few thousand advisories, so tens of pages).
    - If the cap is hit with no previous file, nothing is written and the job reports a failure, as the npm builder does today. The UI then shows that ecosystem as "no data", never "not affected".
    - If it is hit with a previous file, the previous file is kept.
    - No resumable backfill.
  - Incremental runs fetch only what changed.
  - The job already uses the Actions `GITHUB_TOKEN`.
- **Popular-name lists for typosquat checks**, refreshed at most once a day and kept from the previous deploy otherwise, written to `data/popular-packages.json` (`{ npm: string[], pypi: string[] }`, about 5,000 names each):
  - **npm (call):** the `npm-high-impact` package (MIT, a JS module exporting arrays), added as a **devDependency** so Dependabot and audit cover it. No CDN fetch.
    - Popularity rank comes from `npmTopDownloads`.
    - The allow-list is the union of `npmHighImpact`, `npmTopDependents` and `npmTopDownloads`.
  - **PyPI (call):** hugovk's "Top PyPI Packages" monthly JSON at `https://hugovk.dev/top-pypi-packages/top-pypi-packages.min.json`. It has 15,000 rows of `project` / `download_count`.
    - All 15,000 form the allow-list; the top 5,000 are the targets a warning can point to.
    - The repo states no license. The file is a list of package names and download counts, i.e. facts, and only the derived name list is published. The README credits the source.
  - **File shape:** `{ npm: { allow: string[], targets: string[] }, pypi: { … } }`, with targets in popularity order.
  - If either source fails, keep the previous list. If there has never been one, skip the typosquat check for that ecosystem.

### Matching, OSV, alerts

- `matchPackages` takes entries of any ecosystem and the loaded per-ecosystem data, and returns the same `PackageResult` with an `ecosystem` field.
- The OSV opt-in lookup sends each entry with its OSV ecosystem name (`npm`, `PyPI`, `Maven`, `Go`, `NuGet`, `crates.io`).
- The built-in alert rule (`npm-packages` id kept) covers every ecosystem.
  - The npmSeen baseline applies per advisory id, so adding a PyPI package doesn't alert on that package's existing advisories, same as npm.
  - **Keys (call):** npm keys stay exactly as today (`advisoryId|package[@version]`), so there's no alert storm on upgrade. Other ecosystems use `eco:` prefixed package names in both the seen keys and the known-entries list, e.g. `GHSA-…|pypi:requests@2.31.0`.
  - Its label becomes "My packages".

### Typosquat check (on device)

- **Tolerance (call):** a dismissible heuristic with some noise is acceptable, but kept strict.
- A watched npm or PyPI name **warns** when it is not on that ecosystem's allow-list and some target name is "close". Close means any one of:
  - Damerau-Levenshtein distance 1, for names of 6 or more characters
  - the same name after removing `-`, `_` and `.`
  - a swapped scope (npm: `@types/node` vs `types-node` or `node-types`)
  - a common suffix added to a popular name: `-js`, `.js`, `-py`, `py-`, `python-`
- When there are several candidates, it shows the most popular one.
- The warning is a chip on the package ("Did you mean `requests`?") in Settings and in the My packages view. It does not notify.
- It can be dismissed per package. The dismissal is stored in a new synced, backed-up list (`typosquatDismissed: string[]`), validated on import like the other lists.

### UI (no redesign)

- **Vulns tab:**
  - "npm packages" becomes **"Packages"**, same route.
  - The filter row gains an ecosystem select: All (default), npm, PyPI, Maven, Go, NuGet, crates.io. It's in the URL as `eco=`.
  - Rows show a small ecosystem label.
  - The malware section only applies to npm and is hidden when another ecosystem is selected.
- **Settings → My packages:** the same input, with help text showing the prefixes. Chips show the ecosystem and any typosquat warning.
- **Charts:** a new "Advisories by ecosystem" donut, 30 days, for your watched ecosystems or all of them. Existing npm charts follow the ecosystem filter.
- **TV:**
  - The npm wall and dashboard (`#/vulns/npm?tv=1`, `?dash=1`) show all watched ecosystems.
  - Tiles carry an ecosystem label.
  - The QR code still opens the GitHub advisory.

## Constraints

- Project rules (CLAUDE.md):
  - client-side only and static-hostable
  - advisory text is untrusted, rendered as text
  - CSP unchanged
  - validate imports, backward-compatible backups
  - polite to APIs
  - tests next to the code
- Data loads lazily per ecosystem. An npm-only user downloads nothing new except the small popular-names file, which loads whenever any npm or PyPI package is watched, npm-only users included.
- Version-rule modules each get table-driven tests that include each ecosystem's known tricky orderings (e.g. PEP 440 `1.0.dev1 < 1.0a1 < 1.0 < 1.0.post1`; Maven `1.0-alpha < 1.0 < 1.0-sp`; Go pseudo-versions).

## Left to the builder

- Module layout. A `src/services/packages/` home with the npm code staying where it is or moving is the builder's choice, as long as imports and the published file names stay stable.
- How the per-ecosystem files are loaded and cached, following `useNpmAdvisories`.
- Backfill page caps per ecosystem.
- The exact wording of the help text and chips.

---

# Part 2: UI and defaults list (user request, 2026-11-08)

The user approved the design above ("looks good") and added the list below to the same round. Interpretations marked **(call)** are the assistant's.

## Shared rule for changed defaults **(call)**

New defaults apply to new installs. For an existing install, a one-time migration only moves a setting that is still **untouched** (exactly the old default) to the new default. Anything the user changed is kept, and every migration is a settings-version bump, as `watchlistDefaultsVersion` already does.

## Items

1. **Click a panel to swap it (TV and dashboard).**
   - Clicking or tapping a tile or panel swaps that slot to the next one from the pool at once, with the normal transition.
   - Keyboard: tiles are focusable buttons, and Enter/Space do the same.
   - The slot's timer restarts after a manual swap.
   - It doesn't count as "breaking", and it never opens the reader. The QR code stays the way to open a story.
2. **TV/dashboard defaults.**
   - Interval 30 s, tile size X-Small, animation speed Slow.
   - Untouched existing settings migrate (60 s / Medium / Fast are the old defaults).
   - Link params still override per screen.
3. **npm (Packages) tab charts** (user, revised 2026-11-08):
   - **Top grid:** only the three existing cards, By severity, Vulnerabilities vs malware and Fix available, in one row of 3 at `xl`. They stay unchanged.
   - **Left column**, under "Most advisories (30 days)" and in the same compact size as that list, in this order:
     1. Top weaknesses (moved from the grid)
     2. **new:** Advisories by ecosystem (donut, 30 d, from Part 1)
     3. My packages status donut (only when packages exist; moved from the grid)
   - No separate "Most affected packages" chart: "Most advisories (30 days)" already is one.
4. **Newspaper mode is chronological by default** **(call)**, i.e. the front page becomes what Latest is today:
   - newest-first stream with the "Earlier" divider
   - sections and clustering off by default, still switchable in the view
   - In settings, `sectionsEnabled` and `clusteringEnabled` default to false; untouched true values migrate.
5. **Remove the Latest tab.**
   - The nav tab is removed. `#/latest` (with any params, including `?tv=1&mix=1`) redirects to the front page with the same params, so kiosk links keep working.
   - TV and TV+ (mixed mode) move to the front page. Keyboard shortcuts and the help modal drop Latest.
   - Docs and kiosk URLs are updated to `#/?tv=1&mix=1`, noting that the old ones still work.
6. **My Feed is empty by default.**
   - The built-in rules Watchlist, My Stack (news), My Stack (vulns) and Watched CVEs start **disabled**.
   - "My npm packages" stays enabled; it is empty until packages exist.
   - Untouched built-ins (never edited, `updatedAt === createdAt`) migrate to disabled.
   - The My Feed empty state says how to turn rules on.
7. **Greyscale icons.**
   - Every colour emoji in the UI becomes a lucide icon in the existing muted grey icon style: 🎯 🔔 ⚡ 🌍 🏴‍☠️ ★ and the country flags.
   - Flags become a monospace two-letter country code chip, with the full name as a title tooltip.
   - Text glyphs like ✕ ✓ are not emoji and stay.
   - Emoji inside feed or advisory text is untrusted content and is left alone.
8. **Watchlist defaults trimmed** to the most important companies and watch words, about 20 terms instead of about 60:
   - Words: zero-day, actively exploited, exploited in the wild, CISA KEV, remote code execution, authentication bypass, supply chain attack, ransomware attack, data breach
   - Companies: Microsoft, Cisco, Fortinet, Ivanti, Palo Alto, Citrix, VMware, SonicWall, Juniper, CrowdStrike, Apple, Google
   - The presets stay available to add back.
   - Migration: a list that still equals the current default exactly becomes the new default. Otherwise it is kept, and the defaults-version bump adds nothing.
9. **Vulnerability vendor filter: show only the important vendors by default.**
   - The filter becomes an allow-list by default: a curated set of about 25 vendors is shown and every other KEV vendor is hidden:
     - Microsoft, Apple, Google, Cisco, Fortinet, Ivanti, Palo Alto Networks, VMware, Citrix, Adobe, Oracle, Apache, Linux, Mozilla, SAP, Atlassian, Juniper, F5, SonicWall, Progress, Zyxel, Samsung, Broadcom, Check Point, Veeam
     - Names match the KEV `vendorProject` spelling; the plan verifies them against vulns.json.
   - Storage: a new `shownVulnVendors: string[] | null` (null = the legacy "everything except hidden" mode), synced and backed up like `hiddenVulnVendors`.
   - The settings UI shows "Shown" (removable) and "Other vendors" (addable), plus a "Show all vendors" reset.
   - Untouched installs (`hiddenVulnVendors` empty) migrate to the curated allow-list.
   - KEV figures elsewhere (trends, TV numbers) are unaffected, the same as today's hidden list.
