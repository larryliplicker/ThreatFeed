import React, { useMemo, useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useFeeds } from '../../context/FeedContext';
import { KeywordListEditor } from './KeywordListEditor';
import { parseStackCsv } from '../../services/intelligence/stackImport';
import { Database, Server, EyeOff, Layers, Upload } from 'lucide-react';

const sectionClass = 'bg-theme-surface p-6 rounded-xl border border-theme-border space-y-6';
const heading = (icon: React.ReactNode, title: string, text: string) => (
  <div className="flex items-center gap-2 pb-2 border-b border-theme-border">
    {icon}
    <div>
      <h2 className="font-serif text-xl font-bold text-theme-text">{title}</h2>
      <p className="font-serif text-xs text-theme-text-muted">{text}</p>
    </div>
  </div>
);
const MAX_CSV_BYTES = 1024 * 1024;
const toggleClass = (on: boolean) =>
  `press px-3 py-1.5 rounded border text-xs font-mono transition-colors ${on ? 'bg-theme-accent text-white border-theme-accent font-bold' : 'bg-theme-card border-theme-border text-theme-text-muted hover:text-theme-text'}`;

export const IntelligenceSettings: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { feeds, cveIntel } = useFeeds();
  const categories = useMemo(() => Array.from(new Set(feeds.map((f) => f.category))).filter(Boolean).sort(), [feeds]);

  const [importNote, setImportNote] = useState('');

  // "Vendor, Product" rows become one search term each ("Adobe, Acrobat" -> "Adobe Acrobat")
  const importStackCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) { setImportNote('That file is too large (limit 1 MB).'); return; }
    try {
      const result = parseStackCsv(await file.text(), settings.stackKeywords);
      if (result.terms.length > 0) updateSettings({ stackKeywords: [...settings.stackKeywords, ...result.terms] });
      const extras = [
        result.duplicates > 0 && `${result.duplicates} already in your stack`,
        result.skipped > 0 && `${result.skipped} skipped`,
        result.truncated && 'only the first 2,000 rows were read',
      ].filter(Boolean);
      setImportNote(`${result.terms.length === 0 ? 'Nothing new to add' : `Added ${result.terms.length} ${result.terms.length === 1 ? 'product' : 'products'}`}${extras.length ? ` (${extras.join(', ')})` : ''}.`);
    } catch {
      setImportNote('Could not read that file.');
    }
  };

  const inUse = categories.filter((c) => !settings.disabledCategories.includes(c));

  const toggleInUse = (category: string) => {
    const off = settings.disabledCategories;
    updateSettings({ disabledCategories: off.includes(category) ? off.filter((c) => c !== category) : [...off, category] });
  };

  const toggleCategory = (category: string) => {
    const hidden = settings.frontPageHiddenCategories;
    updateSettings({ frontPageHiddenCategories: hidden.includes(category) ? hidden.filter((c) => c !== category) : [...hidden, category] });
  };

  return (
    <>
      <section className={sectionClass}>
        {heading(<Database className="w-5 h-5 text-theme-accent" />, 'Data Source', 'Where articles come from.')}
        <div className="flex flex-wrap gap-2">
          <button className={toggleClass(settings.dataSource !== 'live')} onClick={() => updateSettings({ dataSource: 'snapshot' })}>
            Server snapshot + live (recommended)
          </button>
          <button className={toggleClass(settings.dataSource === 'live')} onClick={() => updateSettings({ dataSource: 'live' })}>
            Live only (through the CORS gateway)
          </button>
        </div>
        <p className="text-xs font-serif text-theme-text-muted">
          The published site carries a snapshot of every default feed, rebuilt every 30 minutes on GitHub, plus CISA KEV and EPSS data for
          the CVEs mentioned. With the snapshot, only feeds you added yourself are fetched live. {Object.keys(cveIntel).length > 0
            ? `Exploitation data is loaded for ${Object.keys(cveIntel).length} CVEs.`
            : 'No snapshot has been loaded yet (local development builds have none unless you run "npm run snapshot").'}
        </p>
      </section>

      <section id="stack-settings" className={sectionClass}>
        {heading(<Server className="w-5 h-5 text-sky-500" />, 'My Stack', 'Products and vendors you actually run. Matching stories get a "Your stack" badge, rank higher, and get their own briefing section.')}
        <KeywordListEditor
          label="Products in your stack"
          keywords={settings.stackKeywords}
          onChange={(stackKeywords) => updateSettings({ stackKeywords })}
          placeholder="e.g. FortiGate, Okta, Exchange, Kubernetes…"
          emptyText="No products yet."
          chipClassName="bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30"
        />
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          <label className="px-3 py-2 rounded bg-theme-card border border-theme-border text-theme-text hover:border-theme-accent transition-colors flex items-center gap-1.5 cursor-pointer" title="One product per row: vendor, product (e.g. Adobe, Acrobat). Each row is added as one search term, e.g. &quot;Adobe Acrobat&quot;.">
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={importStackCsv} className="hidden" />
          </label>
          <span className="text-theme-text-muted" role="status">{importNote || 'Columns: vendor, product. A header row is optional.'}</span>
        </div>
      </section>

      <section className={sectionClass}>
        {heading(<Layers className="w-5 h-5 text-theme-text-muted" />, 'Categories in use', 'Turned-off categories disappear from the whole app: tabs, search, Briefing, trends, alerts and TV mode. Bookmarks are kept.')}
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => {
            const on = !settings.disabledCategories.includes(category);
            const last = on && inUse.length <= 1;
            return (
              <button key={category} onClick={() => toggleInUse(category)} disabled={last} className={`${toggleClass(on)} disabled:opacity-60 disabled:cursor-not-allowed`} title={last ? 'At least one category stays on' : on ? 'Click to turn off' : 'Click to turn on'}>
                {category}
              </button>
            );
          })}
        </div>
      </section>

      <section className={sectionClass}>
        {heading(<EyeOff className="w-5 h-5 text-theme-text-muted" />, 'Mute Rules', 'Cut the noise: muted terms hide articles everywhere (bookmarks excepted); hidden categories only leave the newspaper front page.')}
        <KeywordListEditor
          label="Muted keywords"
          keywords={settings.mutedKeywords}
          onChange={(mutedKeywords) => updateSettings({ mutedKeywords })}
          placeholder="e.g. deal, giveaway, sponsored…"
          emptyText="Nothing muted."
          chipClassName="bg-theme-surface text-theme-text-muted border-theme-border"
        />
        <div className="space-y-2">
          <label className="block text-xs font-mono uppercase tracking-wider text-theme-text-muted">Categories on the front page</label>
          <div className="flex flex-wrap gap-2">
            {inUse.map((category) => {
              const shown = !settings.frontPageHiddenCategories.includes(category);
              return (
                <button key={category} onClick={() => toggleCategory(category)} className={toggleClass(shown)} title={shown ? 'Click to hide from the front page' : 'Click to show on the front page'}>
                  {category}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
};
