// Go module versions: semver with a mandatory leading "v". "+incompatible" (build metadata) is ignored, and
// pseudo-versions (v0.0.0-20230101000000-abcdef123456) are ordinary prereleases, so they compare by timestamp
// and sort below the release they precede. Plain semver comparison does all of that.
import { compareVersions, parseVersion, type Version } from '../../npm/semver';

export type GoVersion = Version;

export function parseGo(input: string): GoVersion | null {
  if (!input.startsWith('v') || input.startsWith('vv')) return null;
  return parseVersion(input);
}

export const compareGo = compareVersions;

/** GHSA and OSV write Go versions without the "v" ("< 0.17.0"); accept both spellings. */
export function stripGoV(text: string): string {
  return text.startsWith('v') && !text.startsWith('vv') ? text.slice(1) : text;
}
