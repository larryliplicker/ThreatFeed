// NuGet versions (SemVer 2 plus a fourth "revision" number): 1, 1.0, 1.0.0 and 1.0.0.0 are equal, a prerelease
// sorts below its release, prerelease labels compare case-insensitively, build metadata is ignored.
import { compareVersions, type Version } from '../../npm/semver';

export interface NugetVersion {
  /** major, minor, patch, revision. */
  nums: [number, number, number, number];
  /** Prerelease labels (lower-cased) reusing the semver precedence rules. */
  pre: Version;
}

const ID = '[0-9A-Za-z-]+';
const RE = new RegExp(`^(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:\\.(\\d+))?(?:-(${ID}(?:\\.${ID})*))?(?:\\+${ID}(?:\\.${ID})*)?$`);

function safeInt(s: string | undefined): number | null {
  if (s === undefined) return 0;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseNuget(input: string): NugetVersion | null {
  const m = RE.exec(input.trim());
  if (!m) return null;
  const nums = [m[1], m[2], m[3], m[4]].map(safeInt);
  if (nums.some((n) => n === null)) return null;
  const pre: (string | number)[] = [];
  if (m[5] !== undefined) {
    for (const id of m[5].toLowerCase().split('.')) {
      if (/^\d+$/.test(id)) {
        const n = safeInt(id);
        if (n === null) return null;
        pre.push(n);
      } else {
        pre.push(id);
      }
    }
  }
  return {
    nums: nums as [number, number, number, number],
    pre: { major: 0, minor: 0, patch: 0, pre },
  };
}

export function compareNuget(a: NugetVersion, b: NugetVersion): -1 | 0 | 1 {
  for (let i = 0; i < 4; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
  }
  return compareVersions(a.pre, b.pre);
}
