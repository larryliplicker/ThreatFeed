// Maven versions, ordered like Maven's own ComparableVersion: numeric segments compare numerically,
// qualifiers alpha < beta < milestone < rc < snapshot < "" (release) < sp < any unknown qualifier, "-" opens
// a nested list, trailing zeros and release qualifiers are dropped. Text with characters that cannot occur
// in a Maven version, or does not start with a digit, gives null (unknown).

type Item =
  | { t: 'int'; v: bigint }
  | { t: 'str'; v: string }
  | { t: 'list'; items: Item[] };

export type MavenVersion = Extract<Item, { t: 'list' }>;

const QUALIFIERS = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const ALIASES: Record<string, string> = { ga: '', final: '', release: '', cr: 'rc' };
const RELEASE_INDEX = String(QUALIFIERS.indexOf(''));
// A version starts with a digit; text such as "garbage" would otherwise parse as a lone qualifier.
const VALID_RE = /^[0-9][0-9a-z._-]*$/;

function strItem(text: string, followedByDigit: boolean): Item {
  let v = text;
  if (followedByDigit && v.length === 1) {
    if (v === 'a') v = 'alpha';
    else if (v === 'b') v = 'beta';
    else if (v === 'm') v = 'milestone';
  }
  return { t: 'str', v: ALIASES[v] ?? v };
}

const isNull = (i: Item): boolean =>
  i.t === 'int' ? i.v === 0n : i.t === 'str' ? i.v === '' : i.items.length === 0;

/** Strip trailing null items (1.0.0 == 1), stopping at the first nested list. */
function normalize(list: MavenVersion): void {
  for (let i = list.items.length - 1; i >= 0; i--) {
    const last = list.items[i];
    if (isNull(last)) list.items.splice(i, 1);
    else if (last.t !== 'list') break;
  }
}

export function parseMaven(input: string): MavenVersion | null {
  const version = input.toLowerCase();
  if (!VALID_RE.test(version)) return null;
  const root: MavenVersion = { t: 'list', items: [] };
  const stack: MavenVersion[] = [root];
  let list = root;
  let isDigit = false;
  let start = 0;

  const item = (digit: boolean, text: string): Item =>
    digit ? { t: 'int', v: BigInt(text) } : strItem(text, false);
  const openList = () => {
    const sub: MavenVersion = { t: 'list', items: [] };
    list.items.push(sub);
    list = sub;
    stack.push(sub);
  };

  for (let i = 0; i < version.length; i++) {
    const c = version[i];
    if (c === '.') {
      list.items.push(i === start ? { t: 'int', v: 0n } : item(isDigit, version.slice(start, i)));
      start = i + 1;
    } else if (c === '-') {
      list.items.push(i === start ? { t: 'int', v: 0n } : item(isDigit, version.slice(start, i)));
      start = i + 1;
      openList();
    } else if (c >= '0' && c <= '9') {
      if (!isDigit && i > start) {
        list.items.push(strItem(version.slice(start, i), true));
        start = i;
        openList();
      }
      isDigit = true;
    } else {
      if (isDigit && i > start) {
        list.items.push(item(true, version.slice(start, i)));
        start = i;
        openList();
      }
      isDigit = false;
    }
  }
  if (version.length > start) list.items.push(item(isDigit, version.slice(start)));
  while (stack.length) normalize(stack.pop()!);
  return root;
}

function comparableQualifier(q: string): string {
  const i = QUALIFIERS.indexOf(q);
  return i === -1 ? `${QUALIFIERS.length}-${q}` : String(i);
}

const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);
const cmpStr = (a: string, b: string) => sign(a < b ? -1 : a > b ? 1 : 0);

/** Item.compareTo of Maven: `other` null stands for a missing item (an implicit zero / release). */
function compareItem(a: Item, b: Item | null): -1 | 0 | 1 {
  if (a.t === 'int') {
    if (!b) return a.v === 0n ? 0 : 1;
    if (b.t === 'int') return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    return 1; // a number outranks a qualifier and a nested list
  }
  if (a.t === 'str') {
    if (!b) return cmpStr(comparableQualifier(a.v), RELEASE_INDEX);
    if (b.t === 'int') return -1;
    if (b.t === 'str') return cmpStr(comparableQualifier(a.v), comparableQualifier(b.v));
    return -1;
  }
  if (!b) return a.items.length === 0 ? 0 : compareItem(a.items[0], null);
  if (b.t === 'int') return -1;
  if (b.t === 'str') return 1;
  const n = Math.max(a.items.length, b.items.length);
  for (let i = 0; i < n; i++) {
    const l = a.items[i] ?? null;
    const r = b.items[i] ?? null;
    const c = l === null ? (r === null ? 0 : (-compareItem(r, l) as -1 | 0 | 1)) : compareItem(l, r);
    if (c) return c;
  }
  return 0;
}

export function compareMaven(a: MavenVersion, b: MavenVersion): -1 | 0 | 1 {
  return compareItem(a, b);
}
