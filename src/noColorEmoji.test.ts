import { describe, expect, it } from 'vitest';

/** UI source must not contain colour emoji: use lucide icons or text. Comments and the listed parsing patterns are exempt. */
const COLOUR_EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}]/u;
const ALLOWED = new Set(['✓', '✕']); // check mark and multiplication x are plain text glyphs

// Files that only parse untrusted feed text and never render the character (none currently: the ransomware.live
// title pattern in services/intelligence/ransomware.ts is matched without the emoji). Add `path` here with a reason if one is needed.
const PARSING_ALLOW_LIST: string[] = [];

const SOURCES = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('no colour emoji in UI source', () => {
  it('uses icons or text instead', () => {
    const bad: string[] = [];
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    for (const [file, src] of Object.entries(SOURCES)) {
      if (PARSING_ALLOW_LIST.includes(file)) continue;
      stripComments(src).split('\n').forEach((line, i) => {
        for (const ch of line) if (COLOUR_EMOJI.test(ch) && !ALLOWED.has(ch)) { bad.push(`${file}:${i + 1} ${ch}`); break; }
      });
    }
    expect(bad).toEqual([]);
  });
});
