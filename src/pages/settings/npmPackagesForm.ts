import { entryKey, formatEntry, parseEntry } from '../../services/packages/entries';

export interface PackageInputResult {
  added: string[]; // new, valid entries in typed order (npm unprefixed, other ecosystems prefixed)
  invalid: string[]; // tokens that are not a valid package entry
}

/** Splits pasted text on commas and whitespace and checks each token; entries already in `existing` (or repeated) are skipped silently */
export function parsePackageInput(input: string, existing: string[]): PackageInputResult {
  const seen = new Set<string>();
  for (const e of existing) {
    const entry = parseEntry(e);
    if (entry) seen.add(entryKey(entry));
  }
  const added: string[] = [];
  const invalid: string[] = [];
  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    const entry = parseEntry(token);
    if (!entry) { invalid.push(token); continue; }
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(formatEntry(entry));
  }
  return { added, invalid };
}
