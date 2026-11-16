import { REPORT_GROUPS, StackReport, StackReportEntry } from './stackReport';

/** Downloadable forms of the stack report. All text is untrusted (NVD/CISA data), so the HTML escapes every value. */

const CVE_ID = /^CVE-\d{4}-\d{4,}$/;
const nvdUrl = (cve: string) => (CVE_ID.test(cve) ? `https://nvd.nist.gov/vuln/detail/${cve}` : undefined);

const escapeHtml = (text: unknown) =>
  String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const shorten = (s: string, max = 280) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const percent = (epss: number) => `${(epss * 100).toFixed(epss >= 0.1 ? 0 : 1)}%`;

/** The short facts line for one entry, shared by both formats */
function facts(e: StackReportEntry): string[] {
  const out: string[] = [];
  if (e.kevAdded) out.push(`KEV added ${e.kevAdded}${e.dueDate ? `, due ${e.dueDate}` : ''}`);
  if (e.ransomware) out.push('used in ransomware');
  if (e.epss !== undefined) out.push(`EPSS ${percent(e.epss)}`);
  if (e.exploit) {
    const parts = [e.exploit.msf ? `Metasploit${e.exploit.msf > 1 ? ` ×${e.exploit.msf}` : ''}` : '', e.exploit.nuclei ? 'Nuclei' : '', e.exploit.pocs ? `PoC${e.exploit.pocs > 1 ? ` ×${e.exploit.pocs}` : ''}` : ''].filter(Boolean);
    out.push(`public exploit: ${parts.join(', ')}`);
  }
  if (e.published) out.push(`published ${e.published}`);
  return out;
}

const REASON: Record<StackReportEntry['reasons'][number], string> = { published: 'new CVE', kev: 'added to KEV' };
const why = (e: StackReportEntry) => e.reasons.map((r) => REASON[r]).join(' + ');

function coverageNote(r: StackReport): string | undefined {
  if (!r.partialNvd) return undefined;
  return r.nvdCoverage
    ? `High and critical NVD data is held for ${r.nvdCoverage.from} to ${r.nvdCoverage.to}. Days before that show Known Exploited (KEV) entries only.`
    : 'No NVD data is loaded, so this report shows Known Exploited (KEV) entries only.';
}

export function stackReportFilename(r: StackReport, ext: 'md' | 'html'): string {
  return `threatfeed-stack-report-${r.from}-to-${r.to}.${ext}`;
}

export function stackReportToMarkdown(r: StackReport): string {
  const lines: string[] = [
    `# My Stack: relevant CVEs, ${r.from} to ${r.to}`,
    '',
    `${r.total} ${r.total === 1 ? 'CVE' : 'CVEs'} · dates are UTC · generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
  ];
  const note = coverageNote(r);
  if (note) lines.push('', `> ${note}`);
  if (r.total === 0) lines.push('', 'No CVEs matched your stack in this period.');

  for (const g of REPORT_GROUPS) {
    const entries = r.groups[g.id];
    if (entries.length === 0) continue;
    lines.push('', `## ${g.title} (${entries.length})`, '');
    for (const e of entries) {
      const url = nvdUrl(e.cve);
      const id = url ? `[${e.cve}](${url})` : e.cve;
      lines.push(`- **${id}**${e.score !== undefined ? ` · CVSS ${e.score.toFixed(1)}` : ''} · ${e.product} · matched: ${e.matched.join(', ')} · ${why(e)}`);
      const f = facts(e);
      if (f.length) lines.push(`  ${f.join(' · ')}`);
      const text = e.description ?? e.title;
      if (text) lines.push(`  ${shorten(text)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const STYLE = `
  body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:860px;margin:32px auto;padding:0 20px}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:28px 0 8px;padding-bottom:4px;border-bottom:2px solid #111;text-transform:uppercase;letter-spacing:.04em}
  .meta{color:#555;font-size:12px}
  .note{margin:14px 0;padding:8px 12px;background:#fff7e6;border-left:3px solid #d97706;font-size:13px}
  .cve{margin:0 0 12px;padding:0 0 12px;border-bottom:1px solid #ddd;break-inside:avoid}
  .head{font-weight:600}
  .id{font-family:ui-monospace,Menlo,Consolas,monospace}
  .score{font-family:ui-monospace,Menlo,Consolas,monospace}
  .facts{color:#444;font-size:12px;margin-top:2px}
  .desc{margin-top:4px;font-size:13px}
  a{color:#1d4ed8}
  @media print{body{margin:0;max-width:none}.note{background:none}a{color:#000;text-decoration:none}}
`;

export function stackReportToHtml(r: StackReport): string {
  const e = escapeHtml;
  const note = coverageNote(r);
  const sections = REPORT_GROUPS.filter((g) => r.groups[g.id].length > 0).map((g) => {
    const items = r.groups[g.id].map((x) => {
      const url = nvdUrl(x.cve);
      const id = url ? `<a class="id" href="${e(url)}">${e(x.cve)}</a>` : `<span class="id">${e(x.cve)}</span>`;
      const f = facts(x);
      const text = x.description ?? x.title;
      return `<div class="cve">
<div class="head">${id}${x.score !== undefined ? ` · <span class="score">CVSS ${x.score.toFixed(1)}</span>` : ''} · ${e(x.product)}</div>
<div class="facts">Matched: ${e(x.matched.join(', '))} · ${e(why(x))}</div>
${f.length ? `<div class="facts">${e(f.join(' · '))}</div>\n` : ''}${text ? `<div class="desc">${e(shorten(text))}</div>\n` : ''}</div>`;
    });
    return `<h2>${e(g.title)} (${items.length})</h2>\n${items.join('\n')}`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(`My Stack: relevant CVEs, ${r.from} to ${r.to}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>My Stack: relevant CVEs, ${e(r.from)} to ${e(r.to)}</h1>
<div class="meta">${r.total} ${r.total === 1 ? 'CVE' : 'CVEs'} · dates are UTC · generated ${e(r.generatedAt.slice(0, 16).replace('T', ' '))} UTC</div>
${note ? `<div class="note">${e(note)}</div>` : ''}
${r.total === 0 ? '<p>No CVEs matched your stack in this period.</p>' : sections.join('\n')}
</body>
</html>
`;
}
