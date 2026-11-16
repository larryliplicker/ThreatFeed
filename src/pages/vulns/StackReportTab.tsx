import React, { useMemo, useState } from 'react';
import type { VulnData } from '../../types';
import { buildStackReport, lastDays, parseDay, REPORT_GROUPS, StackReportEntry } from '../../services/intelligence/stackReport';
import { stackReportFilename, stackReportToHtml, stackReportToMarkdown } from '../../services/intelligence/stackReportExport';
import { downloadText } from '../../services/intelligence/iocExport';
import { severityFromScore } from '../../services/intelligence/vulns';
import { SectionTitle } from '../incidents/shared';
import { CveButton, EpssValue, ExploitBadges, SeverityPill } from './shared';
import { Download, FileText } from 'lucide-react';

interface StackReportTabProps {
  vulns: VulnData;
  stackKeywords: string[];
  onOpenCve: (cve: string) => void;
}

const REASON: Record<StackReportEntry['reasons'][number], string> = { published: 'New CVE', kev: 'Added to KEV' };
const inputClass = 'bg-theme-card border border-theme-border rounded px-2 py-1.5 text-xs font-mono text-theme-text focus:outline-none focus:border-theme-accent';
const buttonClass = 'px-3 py-1.5 rounded border border-theme-border bg-theme-card text-xs font-mono text-theme-text hover:border-theme-accent flex items-center gap-1.5 disabled:opacity-50';

/** The CVEs in a date range that affect a product in My Stack, with downloads. Built from CVE data only, never from articles. */
export const StackReportTab: React.FC<StackReportTabProps> = ({ vulns, stackKeywords, onOpenCve }) => {
  const [range, setRange] = useState(() => lastDays(7));
  const today = new Date().toISOString().slice(0, 10);

  const report = useMemo(() => buildStackReport(vulns, stackKeywords, range.from, range.to), [vulns, stackKeywords, range]);

  // A half-typed date reads as empty: keep the last valid one until a real day is entered
  const setEnd = (end: 'from' | 'to') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const day = parseDay(e.target.value);
    if (day) setRange((r) => ({ ...r, [end]: day }));
  };

  if (stackKeywords.length === 0) {
    return <p className="text-sm font-serif text-theme-text-muted">Add the products you run in Settings → Intelligence → My Stack, then come back: this report lists the CVEs that affect them.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[10px] font-mono uppercase tracking-wider text-theme-text-muted flex flex-col gap-1">
          From
          <input type="date" value={report.from} max={today} onChange={setEnd('from')} className={inputClass} />
        </label>
        <label className="text-[10px] font-mono uppercase tracking-wider text-theme-text-muted flex flex-col gap-1">
          To
          <input type="date" value={report.to} max={today} onChange={setEnd('to')} className={inputClass} />
        </label>
        <button className={buttonClass} onClick={() => setRange(lastDays(7))}>Last 7 days</button>
        <button className={buttonClass} onClick={() => setRange(lastDays(14))}>Last 14 days</button>
        <span className="flex-grow" />
        <button className={buttonClass} disabled={report.total === 0} onClick={() => downloadText(stackReportFilename(report, 'html'), stackReportToHtml(report), 'text/html')}>
          <Download className="w-3.5 h-3.5" /> HTML
        </button>
        <button className={buttonClass} disabled={report.total === 0} onClick={() => downloadText(stackReportFilename(report, 'md'), stackReportToMarkdown(report), 'text/markdown')}>
          <FileText className="w-3.5 h-3.5" /> Markdown
        </button>
      </div>

      <p className="text-xs font-serif text-theme-text-muted">
        {report.total} {report.total === 1 ? 'CVE' : 'CVEs'} in your stack with activity from {report.from} to {report.to} (UTC): published, or added to CISA KEV.
        Matched on vendor and product only, so a stack entry like "Adobe Acrobat" does not pull in other Adobe products.
      </p>
      {report.partialNvd && (
        <p className="text-xs font-mono px-3 py-2 rounded border-l-2 border-amber-500 bg-amber-500/10 text-theme-text">
          {report.nvdCoverage
            ? `High and critical NVD data is held for ${report.nvdCoverage.from} to ${report.nvdCoverage.to}. Days before that show Known Exploited (KEV) entries only.`
            : 'No NVD data is loaded, so only Known Exploited (KEV) entries show.'}
        </p>
      )}

      {report.total === 0 && <p className="text-sm font-serif text-theme-text-muted">No CVEs matched your stack in this period.</p>}

      {REPORT_GROUPS.filter((g) => report.groups[g.id].length > 0).map((g) => (
        <section key={g.id}>
          <SectionTitle>{g.title} ({report.groups[g.id].length})</SectionTitle>
          <ul className="divide-y divide-theme-border/60">
            {report.groups[g.id].map((e) => (
              <li key={e.cve} className="py-2.5 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
                  <CveButton cve={e.cve} onOpen={onOpenCve} />
                  <SeverityPill severity={e.score !== undefined ? severityFromScore(e.score) : undefined} score={e.score} />
                  <span className="text-theme-text font-bold">{e.product}</span>
                  {e.kevAdded && <span className="px-1 rounded bg-rose-600 text-white text-[9px] font-bold uppercase">KEV {e.kevAdded}</span>}
                  {e.ransomware && <span className="px-1 rounded bg-theme-text text-theme-bg text-[9px] font-bold uppercase">Ransomware</span>}
                  <ExploitBadges info={vulns.exploits?.[e.cve]} />
                  <span className="text-theme-text-muted">EPSS <EpssValue epss={e.epss} /></span>
                </div>
                <div className="text-[11px] font-mono text-theme-text-muted">
                  Matched: {e.matched.join(', ')} · {e.reasons.map((r) => REASON[r]).join(' + ')}
                  {e.dueDate && ` · KEV due ${e.dueDate}`}
                  {e.published && ` · published ${e.published}`}
                </div>
                {(e.description ?? e.title) && <p className="text-xs font-serif text-theme-text-muted line-clamp-2">{e.description ?? e.title}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
