import { describe, expect, it } from 'vitest';

/** UI source must not contain colour emoji: use lucide icons or text. Comment-only lines are exempt. */
const COLOUR_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{23E9}-\u{23FF}]/u;
const ALLOWED = new Set(['✓', '✕']); // check mark and multiplication x are plain text glyphs

// Files that only parse untrusted feed text and never render the character (none currently: the ransomware.live
// title pattern in services/intelligence/ransomware.ts appears only in a comment). Add `path` here with a reason if needed.
const PARSING_ALLOW_LIST: string[] = [];

/** Emoji found outside comment-only lines. Deliberately not a tokenizer: a line is exempt only when it starts with //, * or
 *  /*, so string contents such as "a // 🔔" or "/*" can never hide anything (trailing comments are scanned too). */
export function findColourEmoji(src: string): { line: number; ch: string }[] {
  const found: { line: number; ch: string }[] = [];
  src.split('\n').forEach((text, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) return;
    for (const ch of text) if ((COLOUR_EMOJI.test(ch) || ch === '\uFE0F') && !ALLOWED.has(ch)) { found.push({ line: i + 1, ch }); break; }
  });
  return found;
}

const SOURCES = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('findColourEmoji', () => {
  it('catches an emoji after // inside a string', () => {
    expect(findColourEmoji(`const a = "Alert // \u{1F514}";`)).toHaveLength(1);
    expect(findColourEmoji(`const a = 'x // y'; const b = '⚡';`)).toHaveLength(1);
  });
  it('ignores an emoji in a real comment line', () => {
    expect(findColourEmoji(`// \u{1F3AF} target\n/* \u{1F514}\n * ⚡ */\nconst a = 1;`)).toEqual([]);
  });
  it('does not let /* in a string swallow later code', () => {
    expect(findColourEmoji(`const a = "/*";\nconst b = '\u{1F514}';\nconst c = "*/";`)).toEqual([{ line: 2, ch: '\u{1F514}' }]);
  });
  it('flags the wider emoji code points and allows plain glyphs', () => {
    for (const ch of ['⭐', '⭕', '⌚', '⏩', '\u{1F004}', '️']) expect(findColourEmoji(`x('${ch}')`)).toHaveLength(1);
    expect(findColourEmoji(`x('✓ ✕ ▲ ▼ → ←')`)).toEqual([]);
  });
});

describe('no colour emoji in UI source', () => {
  it('uses icons or text instead', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (PARSING_ALLOW_LIST.includes(file)) continue;
      for (const { line, ch } of findColourEmoji(src)) bad.push(`${file}:${line} ${ch}`);
    }
    expect(bad).toEqual([]);
  });
});
