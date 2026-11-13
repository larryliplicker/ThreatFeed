/**
 * "Import from CSV" for My Stack. Each row is `vendor, product`; the two are joined into one search term
 * ("Adobe, Acrobat" becomes "Adobe Acrobat"). A row with a single value is used as is. The input is an
 * untrusted file: it is parsed defensively and capped.
 */

export const STACK_IMPORT_MAX_ROWS = 2000;
export const STACK_TERM_MAX_LENGTH = 100;

export interface StackImportResult {
  /** New, de-duplicated search terms, in file order */
  terms: string[];
  /** Rows that produced a term that was already in the list (or earlier in the file) */
  duplicates: number;
  /** Non-empty rows that produced no usable term (blank cells, over-long values) */
  skipped: number;
  /** True when the file had more rows than STACK_IMPORT_MAX_ROWS and the rest were ignored */
  truncated: boolean;
}

/** Splits CSV text into rows of cells. Handles quoted cells ("a, b"), doubled quotes and newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  const src = text.replace(/^\uFEFF/, ''); // Excel's byte-order mark
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      endCell();
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

const HEADER_VENDOR = new Set(['vendor', 'publisher', 'manufacturer', 'company', 'supplier', 'maker']);
const HEADER_PRODUCT = new Set(['product', 'product name', 'name', 'software', 'application', 'app', 'title']);

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Where the vendor and product columns are: found from a header row if there is one, otherwise the first two columns. */
function columnsFor(first: string[] | undefined): { vendor: number; product: number; hasHeader: boolean } {
  if (first) {
    const names = first.map((c) => clean(c).toLowerCase());
    const vendor = names.findIndex((n) => HEADER_VENDOR.has(n));
    const product = names.findIndex((n) => HEADER_PRODUCT.has(n));
    if (vendor !== -1 || product !== -1) return { vendor, product, hasHeader: true };
  }
  return { vendor: 0, product: 1, hasHeader: false };
}

/** The new My Stack terms in a CSV, given the terms already in the list (compared case-insensitively). */
export function parseStackCsv(text: string, existing: string[] = []): StackImportResult {
  const all = parseCsvRows(text).filter((r) => r.some((c) => c.trim() !== ''));
  const { vendor, product, hasHeader } = columnsFor(all[0]);
  const dataRows = hasHeader ? all.slice(1) : all;
  const truncated = dataRows.length > STACK_IMPORT_MAX_ROWS;

  const seen = new Set(existing.map((k) => k.toLowerCase()));
  const terms: string[] = [];
  let duplicates = 0;
  let skipped = 0;

  for (const row of dataRows.slice(0, STACK_IMPORT_MAX_ROWS)) {
    const parts = [vendor, product].filter((i) => i >= 0).map((i) => clean(row[i] ?? '')).filter(Boolean);
    // "Adobe" + "Adobe Acrobat" should not become "Adobe Adobe Acrobat"
    if (parts.length === 2 && parts[1].toLowerCase().startsWith(parts[0].toLowerCase() + ' ')) parts.shift();
    const term = parts.join(' ');
    if (!term || term.length > STACK_TERM_MAX_LENGTH) { skipped++; continue; }
    const key = term.toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    terms.push(term);
  }
  return { terms, duplicates, skipped, truncated };
}
