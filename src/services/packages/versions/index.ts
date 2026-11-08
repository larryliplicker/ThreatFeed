// One interface over the version rules of every ecosystem, so matching code does not care which one it is
// looking at. Everything here is pure. Unparseable input means null (unknown), never a quiet "not affected".
import {
  compareVersions,
  ghsaRangeWith,
  osvAffectedWith,
  parseBound,
  parseVersion,
  semverEvent,
  type EventVersion,
  type OsvEvent,
  type RangeBound,
} from '../../npm/semver';
import type { Ecosystem } from '../ecosystems';
import { compareGo, parseGo, stripGoV } from './goVersion';
import { compareMaven, parseMaven } from './maven';
import { compareNuget, parseNuget } from './nuget';
import { comparePep440, parsePep440 } from './pep440';

/**
 * Version rules of one ecosystem. Parsed values are opaque: pass `compare`, `ghsaRange` and `osvAffected` only
 * values that the same ecosystem's `parse` returned.
 */
export interface VersionRules {
  /** The parsed version, or null when the text is not a valid version in this ecosystem. */
  parse(v: string): unknown | null;
  compare(a: unknown, b: unknown): -1 | 0 | 1;
  /**
   * Test for a GHSA `vulnerable_version_range` (">= 1.0, < 1.2.3", "<= 2", "= 1.5", "< 3"); null when the range is
   * not understood. A partial bound is read the way that widens the range where the ecosystem has no native
   * ordering for it (semver ecosystems).
   */
  ghsaRange(range: string): ((v: unknown) => boolean) | null;
  /** OSV event walk (introduced / fixed / last_affected); null when the events are unusable. */
  osvAffected(v: unknown, events: OsvEvent[]): boolean | null;
}

interface Spec<V> {
  parse(v: string): V | null;
  compare(a: V, b: V): -1 | 0 | 1;
  bound(text: string): RangeBound<V> | null;
  event(text: string): EventVersion<V> | null;
}

function build<V>(s: Spec<V>): VersionRules {
  return {
    parse: s.parse,
    compare: (a, b) => s.compare(a as V, b as V),
    ghsaRange: (range) => {
      const t = ghsaRangeWith(range, s.bound, s.compare);
      return t && ((v) => t(v as V));
    },
    osvAffected: (v, events) => osvAffectedWith(v as V, events, s.event, s.compare),
  };
}

const ZERO_TEXT = /^v?0(\.0)*$/;

/** Bound and event readers for ecosystems whose compare already treats 2.15 and 2.15.0 alike. */
function native<V>(parse: (text: string) => V | null) {
  return {
    bound: (text: string): RangeBound<V> | null => {
      const version = parse(text);
      return version === null ? null : { version, ceiling: null, zero: ZERO_TEXT.test(text) };
    },
    event: (text: string): EventVersion<V> | null => {
      const ver = parse(text);
      return ver === null ? null : { ver, zero: ZERO_TEXT.test(text) };
    },
  };
}

const npmSpec: Spec<ReturnType<typeof parseVersion> & object> = {
  parse: parseVersion,
  compare: compareVersions,
  bound: parseBound,
  event: semverEvent,
};

// crates.io: strict semver, no "v" prefix; ranges and events are the shared semver ones.
const cargoSpec: Spec<ReturnType<typeof parseVersion> & object> = {
  ...npmSpec,
  parse: (s) => (s.startsWith('v') ? null : parseVersion(s)),
};

// Go: GHSA and OSV drop the "v" in ranges and events; versions themselves need it.
const goSpec: Spec<ReturnType<typeof parseVersion> & object> = {
  parse: parseGo,
  compare: compareGo,
  bound: (text) => parseBound(stripGoV(text)),
  event: (text) => semverEvent(stripGoV(text)),
};

const RULES: Record<Ecosystem, VersionRules> = {
  npm: build(npmSpec),
  pypi: build({ parse: parsePep440, compare: comparePep440, ...native(parsePep440) }),
  maven: build({ parse: parseMaven, compare: compareMaven, ...native(parseMaven) }),
  go: build(goSpec),
  nuget: build({ parse: parseNuget, compare: compareNuget, ...native(parseNuget) }),
  cargo: build(cargoSpec),
};

export function rulesFor(eco: Ecosystem): VersionRules {
  return RULES[eco];
}
