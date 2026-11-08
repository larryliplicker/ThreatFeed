// PEP 440 versions (PyPI): epochs, pre / post / dev releases; the local segment is ignored for comparison.
// Anything that is not a valid PEP 440 version gives null (unknown), never a guess.

export interface Pep440 {
  epoch: number;
  /** Release numbers with trailing zeros removed, so 1.0 and 1.0.0 are equal. */
  release: number[];
  /** [a=0 | b=1 | rc=2, number]; null when absent. */
  pre: [number, number] | null;
  post: number | null;
  dev: number | null;
}

const RE = new RegExp(
  '^v?' +
    '(?:(\\d+)!)?' + // 1: epoch
    '(\\d+(?:\\.\\d+)*)' + // 2: release
    '(?:[-_.]?(alpha|beta|preview|pre|rc|a|b|c)[-_.]?(\\d+)?)?' + // 3, 4: pre-release
    '(?:-(\\d+)|[-_.]?(post|rev|r)[-_.]?(\\d+)?)?' + // 5: implicit post ("1.0-1"), 6, 7: post-release
    '(?:[-_.]?(dev)[-_.]?(\\d+)?)?' + // 8, 9: development release
    '(?:\\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$', // local version, ignored
  'i',
);
const PRE_RANK: Record<string, number> = { a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 };

/** A missing number means 0 ("1.0a" is "1.0a0"); null when it does not fit a safe integer. */
function int(s: string | undefined): number | null {
  if (s === undefined) return 0;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function parsePep440(input: string): Pep440 | null {
  const m = RE.exec(input.trim());
  if (!m) return null;
  const epoch = int(m[1]);
  const parts = m[2].split('.').map((p) => int(p));
  if (epoch === null || parts.some((n) => n === null)) return null;
  const release = parts as number[];
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();

  let pre: [number, number] | null = null;
  if (m[3] !== undefined) {
    const n = int(m[4]);
    if (n === null) return null;
    pre = [PRE_RANK[m[3].toLowerCase()], n];
  }
  let post: number | null = null;
  if (m[5] !== undefined) post = int(m[5]);
  else if (m[6] !== undefined) post = int(m[7]);
  if ((m[5] !== undefined || m[6] !== undefined) && post === null) return null;
  let dev: number | null = null;
  if (m[8] !== undefined) {
    dev = int(m[9]);
    if (dev === null) return null;
  }
  return { epoch, release, pre, post, dev };
}

const cmpNum = (a: number, b: number): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);

// Sort keys as in `packaging`: a dev release of a plain release sorts before its pre-releases, a missing
// pre-release sorts after any pre-release, a missing post-release before any, a missing dev after any.
function preKey(v: Pep440): [number, number] {
  if (v.pre) return v.pre;
  if (v.post === null && v.dev !== null) return [-1, 0];
  return [3, 0];
}

export function comparePep440(a: Pep440, b: Pep440): -1 | 0 | 1 {
  const epoch = cmpNum(a.epoch, b.epoch);
  if (epoch) return epoch;
  const n = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < n; i++) {
    const c = cmpNum(a.release[i] ?? 0, b.release[i] ?? 0);
    if (c) return c;
  }
  const pa = preKey(a);
  const pb = preKey(b);
  return (
    cmpNum(pa[0], pb[0]) ||
    cmpNum(pa[1], pb[1]) ||
    cmpNum(a.post ?? -1, b.post ?? -1) ||
    cmpNum(a.dev ?? Infinity, b.dev ?? Infinity)
  );
}
