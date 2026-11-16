import { describe, expect, it } from 'vitest';
import type { CveRecord, KevEntry, VulnData } from '../../types';
import { buildStackReport, lastDays, parseDay, stackTermsIn } from './stackReport';
import { stackReportFilename, stackReportToHtml, stackReportToMarkdown } from './stackReportExport';

const kev = (o: Partial<KevEntry> & { cve: string }): KevEntry => ({
  vendor: 'Vendor', product: 'Product', name: 'A flaw', dateAdded: '2026-01-01', ransomware: false, cwes: [], ...o,
});
const rec = (o: Partial<CveRecord> & { id: string }): CveRecord => ({ published: '2026-11-06T10:00:00.000', ...o });
const vulns = (o: Partial<VulnData>): VulnData => ({
  updatedAt: '2026-11-13T00:00:00Z', kev: [], nvd: { from: '2026-10-30', to: '2026-11-13', total: 0, daily: [], cwes: [], assigners: [] },
  notable: [], advisories: [], epssTop: [], ...o,
});
const NOW = new Date('2026-11-13T12:00:00Z');

describe('stackTermsIn', () => {
  it('matches a vendor + product term only against that product, not the rest of the vendor line', () => {
    expect(stackTermsIn('Adobe Acrobat and Reader', ['Adobe Acrobat'])).toEqual(['Adobe Acrobat']);
    expect(stackTermsIn('Adobe Lightroom', ['Adobe Acrobat'])).toEqual([]);
  });
  it('lets a vendor-only term match every product of that vendor', () => {
    expect(stackTermsIn('Adobe Lightroom', ['Adobe'])).toEqual(['Adobe']);
  });
  it('reads underscores and hyphens as spaces on both sides', () => {
    expect(stackTermsIn('adobe | acrobat_reader', ['Adobe Acrobat'])).toEqual([]); // separate entries do not join across the pipe
    expect(stackTermsIn('adobe acrobat_reader', ['Adobe Acrobat Reader'])).toEqual(['Adobe Acrobat Reader']);
    expect(stackTermsIn('Palo Alto PAN-OS', ['PAN OS', 'pan-os'])).toEqual(['PAN OS', 'pan-os']);
  });
  it('matches whole words only', () => {
    expect(stackTermsIn('Okta Verify', ['Ok'])).toEqual([]);
  });
});

describe('parseDay and lastDays', () => {
  it('accepts real days only', () => {
    expect(parseDay('2026-11-04')).toBe('2026-11-04');
    expect(parseDay('2026-02-31')).toBeNull();
    expect(parseDay('11/4/2026')).toBeNull();
  });
  it('counts today as the last day of the period', () => {
    expect(lastDays(7, NOW)).toEqual({ from: '2026-11-07', to: '2026-11-13' });
  });
});

describe('buildStackReport', () => {
  const data = vulns({
    kev: [
      kev({ cve: 'CVE-2026-0001', vendor: 'Adobe', product: 'Acrobat and Reader', dateAdded: '2026-11-05', dueDate: '2026-11-26', cvss: 8.8, ransomware: true, epss: 0.4, description: 'Acrobat flaw' }),
      kev({ cve: 'CVE-2026-0002', vendor: 'Adobe', product: 'Lightroom', dateAdded: '2026-11-05', cvss: 9.8 }),
      kev({ cve: 'CVE-2026-0003', vendor: 'Cisco', product: 'ASA', dateAdded: '2026-11-08', cvss: 5.5 }),
      kev({ cve: 'CVE-2026-0004', vendor: 'Cisco', product: 'ASA', dateAdded: '2026-10-01', cvss: 9.0 }), // before the period
      kev({ cve: 'CVE-2026-0005', vendor: 'Cisco', product: 'ASA', dateAdded: '2026-11-09' }), // unscored
    ],
    notable: [rec({ id: 'CVE-2026-0100', score: 9.6, products: ['okta verify'], description: 'Okta <b>flaw</b>', epss: 0.02 })],
    watchable: [
      rec({ id: 'CVE-2026-0101', score: 7.5, products: ['fortinet fortigate'] }),
      rec({ id: 'CVE-2026-0102', score: 7.5, products: ['fortinet fortigate'], published: '2026-11-12T10:00:00.000' }), // after the period
      rec({ id: 'CVE-2026-0103', score: 8.0 }), // no products listed
    ],
    exploits: { 'CVE-2026-0101': { msf: ['exploit/x'], pocs: 2 } },
  });
  const stack = ['Adobe Acrobat', 'Cisco ASA', 'Okta', 'FortiGate'];
  const report = buildStackReport(data, stack, '2026-11-04', '2026-11-11', NOW);
  const all = Object.values(report.groups).flat();

  it('keeps only CVEs with activity in the period that match a stack product', () => {
    expect(all.map((e) => e.cve).sort()).toEqual(['CVE-2026-0001', 'CVE-2026-0003', 'CVE-2026-0005', 'CVE-2026-0100', 'CVE-2026-0101']);
    expect(report.total).toBe(5);
  });
  it('does not match another product of the same vendor, nor CVEs listing no products', () => {
    expect(all.find((e) => e.cve === 'CVE-2026-0002')).toBeUndefined();
    expect(all.find((e) => e.cve === 'CVE-2026-0103')).toBeUndefined();
  });
  it('groups by severity, with exploited entries under 7.0 or unscored in their own group', () => {
    expect(report.groups.critical.map((e) => e.cve)).toEqual(['CVE-2026-0100']);
    expect(report.groups.high.map((e) => e.cve)).toEqual(['CVE-2026-0001', 'CVE-2026-0101']);
    expect(report.groups['kev-other'].map((e) => e.cve)).toEqual(['CVE-2026-0005', 'CVE-2026-0003']);
  });
  it('puts known-exploited entries first, then highest EPSS', () => {
    expect(report.groups.high[0].cve).toBe('CVE-2026-0001');
  });
  it('records why each CVE is included and what matched', () => {
    const acrobat = all.find((e) => e.cve === 'CVE-2026-0001')!;
    expect(acrobat).toMatchObject({ reasons: ['kev'], matched: ['Adobe Acrobat'], kevAdded: '2026-11-05', dueDate: '2026-11-26', ransomware: true });
    expect(all.find((e) => e.cve === 'CVE-2026-0100')!.reasons).toEqual(['published']);
  });
  it('flags public exploit code', () => {
    expect(all.find((e) => e.cve === 'CVE-2026-0101')!.exploit).toEqual({ msf: 1, nuclei: false, pocs: 2 });
  });
  it('merges a CVE that is both published and added to KEV in the period into one entry', () => {
    const merged = buildStackReport(
      vulns({ kev: [kev({ cve: 'CVE-2026-0200', vendor: 'Cisco', product: 'ASA', dateAdded: '2026-11-07', cvss: 9.1 })], notable: [rec({ id: 'CVE-2026-0200', score: 9.1, products: ['cisco asa'] })] }),
      ['Cisco ASA'], '2026-11-04', '2026-11-11', NOW);
    expect(merged.total).toBe(1);
    expect(merged.groups.critical[0].reasons).toEqual(['published', 'kev']);
  });
  it('includes both end days and swaps a reversed range', () => {
    expect(buildStackReport(data, ['Cisco ASA'], '2026-11-08', '2026-11-08', NOW).total).toBe(1);
    expect(buildStackReport(data, ['Cisco ASA'], '2026-11-11', '2026-11-08', NOW)).toMatchObject({ from: '2026-11-08', to: '2026-11-11' });
  });
  it('says when the period starts before the NVD data does', () => {
    expect(report.partialNvd).toBe(false);
    expect(buildStackReport(data, stack, '2026-10-01', '2026-11-11', NOW)).toMatchObject({ partialNvd: true, nvdCoverage: { from: '2026-10-30', to: '2026-11-13' } });
    expect(buildStackReport(vulns({ nvd: null }), stack, '2026-11-04', '2026-11-11', NOW).partialNvd).toBe(true);
  });
  it('returns an empty report for an empty stack', () => {
    expect(buildStackReport(data, [], '2026-11-04', '2026-11-11', NOW).total).toBe(0);
  });
});

describe('stack report export', () => {
  const data = vulns({ notable: [rec({ id: 'CVE-2026-0100', score: 9.6, products: ['okta verify'], description: 'Okta <script>alert(1)</script> flaw' })] });
  const report = buildStackReport(data, ['Okta'], '2026-11-04', '2026-11-11', NOW);

  it('writes Markdown with the period, group and an NVD link', () => {
    const md = stackReportToMarkdown(report);
    expect(md).toContain('# My Stack: relevant CVEs, 2026-11-04 to 2026-11-11');
    expect(md).toContain('## Critical (CVSS 9.0+) (1)');
    expect(md).toContain('[CVE-2026-0100](https://nvd.nist.gov/vuln/detail/CVE-2026-0100)');
    expect(md).toContain('CVSS 9.6');
  });
  it('escapes everything in the HTML and links only valid CVE ids', () => {
    const html = stackReportToHtml(report);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://nvd.nist.gov/vuln/detail/CVE-2026-0100"');
    const bad = stackReportToHtml({ ...report, groups: { ...report.groups, critical: [{ ...report.groups.critical[0], cve: '"><img src=x>' }] } });
    expect(bad).not.toContain('<img');
    expect(bad).not.toContain('href="https://nvd.nist.gov/vuln/detail/"');
  });
  it('says so when nothing matched and names the files by period', () => {
    const empty = buildStackReport(data, ['Nothing'], '2026-11-04', '2026-11-11', NOW);
    expect(stackReportToMarkdown(empty)).toContain('No CVEs matched your stack in this period.');
    expect(stackReportToHtml(empty)).toContain('No CVEs matched your stack in this period.');
    expect(stackReportFilename(report, 'html')).toBe('threatfeed-stack-report-2026-11-04-to-2026-11-11.html');
  });
  it('explains partial NVD coverage', () => {
    const early = buildStackReport(data, ['Okta'], '2026-10-01', '2026-11-11', NOW);
    expect(stackReportToMarkdown(early)).toContain('Days before that show Known Exploited (KEV) entries only.');
  });
});
