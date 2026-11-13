import { describe, expect, it } from 'vitest';
import { parseCsvRows, parseStackCsv, STACK_IMPORT_MAX_ROWS, STACK_TERM_MAX_LENGTH } from './stackImport';

describe('parseCsvRows', () => {
  it('splits rows and cells, handling CRLF and a BOM', () => {
    expect(parseCsvRows('\uFEFFa,b\r\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('keeps commas, doubled quotes and newlines inside quoted cells', () => {
    expect(parseCsvRows('"Acme, Inc.","say ""hi""","l1\nl2"')).toEqual([['Acme, Inc.', 'say "hi"', 'l1\nl2']]);
  });
});

describe('parseStackCsv', () => {
  it('joins vendor and product into one search term', () => {
    expect(parseStackCsv('Adobe, Acrobat\nMicrosoft,Exchange Server').terms).toEqual(['Adobe Acrobat', 'Microsoft Exchange Server']);
  });
  it('uses a header row to find the columns, in any order, and ignores other columns', () => {
    const csv = 'Owner,Product,Vendor,Version\nIT,Acrobat,Adobe,24.1\nIT,FortiGate,Fortinet,7.4';
    expect(parseStackCsv(csv).terms).toEqual(['Adobe Acrobat', 'Fortinet FortiGate']);
  });
  it('treats a first row without a recognised header as data', () => {
    expect(parseStackCsv('Adobe,Acrobat').terms).toEqual(['Adobe Acrobat']);
  });
  it('accepts a vendor-only or product-only row and a single-column file', () => {
    expect(parseStackCsv('Vendor,Product\nOkta,\n,Kubernetes').terms).toEqual(['Okta', 'Kubernetes']);
    expect(parseStackCsv('Okta\nKubernetes').terms).toEqual(['Okta', 'Kubernetes']);
  });
  it('does not repeat the vendor when the product already starts with it', () => {
    expect(parseStackCsv('Vendor,Product\nAdobe,Adobe Acrobat').terms).toEqual(['Adobe Acrobat']);
    expect(parseStackCsv('Vendor,Product\nAdobe,Adobeish').terms).toEqual(['Adobe Adobeish']);
  });
  it('drops duplicates within the file and against the existing list, ignoring case and spacing', () => {
    const r = parseStackCsv('Adobe,Acrobat\nadobe,  acrobat\nCisco,ASA', ['cisco asa']);
    expect(r.terms).toEqual(['Adobe Acrobat']);
    expect(r.duplicates).toBe(2);
  });
  it('skips blank lines silently and counts unusable rows', () => {
    const r = parseStackCsv(`Adobe,Acrobat\n\n,\nVendor,${'x'.repeat(STACK_TERM_MAX_LENGTH + 1)}`);
    expect(r.terms).toEqual(['Adobe Acrobat']);
    expect(r.skipped).toBe(1);
  });
  it('caps the number of rows read', () => {
    const csv = Array.from({ length: STACK_IMPORT_MAX_ROWS + 5 }, (_, i) => `V${i},P`).join('\n');
    const r = parseStackCsv(csv);
    expect(r.terms).toHaveLength(STACK_IMPORT_MAX_ROWS);
    expect(r.truncated).toBe(true);
  });
  it('returns nothing for an empty file', () => {
    expect(parseStackCsv('').terms).toEqual([]);
  });
});
