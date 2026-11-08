// One interface over the version rules of every ecosystem, so matching code does not care which one it is
// looking at. Everything here is pure. Unparseable input means null (unknown), never a quiet "not affected".
import {
  compareVersions,
  ghsaRangeWith,
  osvAffectedWith,
  parseBound,
  parseVersion,
  semverEvent,
  type Version,
  type EventVersion,
  type OsvEvent,
  type RangeBound,
} from '../../npm/semver';
import type { Ecosystem } from '../ecosystems';
import { compareGo, parseGo, stripGoV } from './goVersion';
import { compareMaven, mavenNumericPrefix, parseMaven } from './maven';
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
   * not understood. Partial bounds follow the widest-reading rule in every ecosystem: "<= 3.1" covers all of 3.1.x
   * (and, for PyPI and Maven, the post-release and qualifier variants of a plain numeric bound: "<= 31.1" covers
   * 31.1-jre).
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

// Longer text is not a version (and parsers walk it); every entry point refuses it as unknown.
const MAX_LENGTH = 256;
const capped = <T>(f: (text: string) => T | null) => (text: string): T | null =>
  text.length > MAX_LENGTH ? null : f(text);

function build<V>(s: Spec<V>): VersionRules {
  const bound = capped(s.bound);
  const event = capped(s.event);
  return {
    parse: capped(s.parse),
    compare: (a, b) => s.compare(a as V, b as V),
    ghsaRange: (range) => {
      const t = ghsaRangeWith(range, bound, s.compare);
      return t && ((v) => t(v as V));
    },
    osvAffected: (v, events) => osvAffectedWith(v as V, events, event, s.compare),
  };
}

const ZERO_TEXT = /^v?0(\.0)*$/;

interface NativeOptions<V> {
  /** Text of the lowest version above everything a partial numeric bound covers: [3, 1] -> "3.2" and below. */
  ceilingText(next: number[]): string;
  /** For a plain numeric bound: which higher versions are still "the same release" (2.0.post1, 31.1-jre). */
  covers?(base: V): (v: V) => boolean;
}

const PLAIN_NUMERIC = /^\d+(\.\d+)*$/;

/**
 * Bound and event readers for ecosystems whose compare already treats 2.15 and 2.15.0 alike. The widest-reading
 * rule is applied on top: a plain numeric bound with fewer than 3 segments ("3", "3.1") covers up to the next
 * segment, and a plain numeric bound also covers its post-release / qualifier variants.
 */
function native<V>(parse: (text: string) => V | null, opts: NativeOptions<V>) {
  return {
    bound: (text: string): RangeBound<V> | null => {
      const version = parse(text);
      if (version === null) return null;
      const zero = ZERO_TEXT.test(text);
      if (!PLAIN_NUMERIC.test(text)) return { version, ceiling: null, zero };
      const parts = text.split('.').map(Number);
      let ceiling: V | null = null;
      if (parts.length < 3) {
        // The bound cannot be widened if its last segment has no successor: unknown, not a narrow reading.
        if (!Number.isSafeInteger(parts[parts.length - 1] + 1)) return null;
        const next = [...parts.slice(0, -1), parts[parts.length - 1] + 1];
        ceiling = parse(opts.ceilingText(next));
        if (ceiling === null) return null;
      }
      return { version, ceiling, zero, covers: opts.covers?.(version) };
    },
    event: (text: string): EventVersion<V> | null => {
      const ver = parse(text);
      return ver === null ? null : { ver, zero: ZERO_TEXT.test(text) };
    },
  };
}

const npmSpec: Spec<Version> = {
  parse: parseVersion,
  compare: compareVersions,
  bound: parseBound,
  event: semverEvent,
};

// crates.io: strict semver, no "v" prefix; ranges and events are the shared semver ones.
const cargoSpec: Spec<Version> = {
  ...npmSpec,
  parse: (s) => (s.startsWith('v') ? null : parseVersion(s)),
  bound: (text) => (text.startsWith('v') ? null : parseBound(text)),
  event: (text) => (text.startsWith('v') ? null : semverEvent(text)),
};

// Go: GHSA and OSV drop the "v" in ranges and events; versions themselves need it.
const goSpec: Spec<Version> = {
  parse: parseGo,
  compare: compareGo,
  bound: (text) => parseBound(stripGoV(text)),
  event: (text) => semverEvent(stripGoV(text)),
};

const RULES: Record<Ecosystem, VersionRules> = {
  npm: build(npmSpec),
  pypi: build({
    parse: parsePep440,
    compare: comparePep440,
    ...native(parsePep440, {
      ceilingText: (next) => `${next.join('.')}.dev0`,
      // Same epoch and release: everything above the bound that stays on it is a post-release (local is ignored).
      covers: (base) => (v) =>
        v.epoch === base.epoch && v.release.length === base.release.length && v.release.every((n, i) => n === base.release[i]),
    }),
  }),
  maven: build({
    parse: parseMaven,
    compare: compareMaven,
    ...native(parseMaven, {
      ceilingText: (next) => `${next.join('.')}-alpha`,
      // Same numeric prefix: the rest is a qualifier (-jre, -sp1, ...); a pre-release is below the bound anyway.
      covers: (base) => {
        const want = mavenNumericPrefix(base);
        return (v) => {
          const got = mavenNumericPrefix(v);
          return got.length === want.length && got.every((n, i) => n === want[i]);
        };
      },
    }),
  }),
  go: build(goSpec),
  nuget: build({
    parse: parseNuget,
    compare: compareNuget,
    ...native(parseNuget, { ceilingText: (next) => `${next.join('.')}-0` }),
  }),
  cargo: build(cargoSpec),
};

export function rulesFor(eco: Ecosystem): VersionRules {
  return RULES[eco];
}
