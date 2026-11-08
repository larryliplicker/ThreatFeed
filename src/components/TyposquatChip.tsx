import React from 'react';
import { X } from 'lucide-react';
import type { PopularData } from '../services/packages/popular';
import { typosquatKey, typosquatWarning, type TyposquatEcosystem } from '../services/packages/typosquat';

interface Props {
  eco: string; // npm and pypi are checked; any other ecosystem shows nothing
  name: string;
  popular: PopularData | null;
  dismissed: readonly string[];
  onDismiss: (key: string) => void;
}

/** "Did you mean `requests`?" for a watched name that looks like a misspelling of a popular package; dismissible, never notifies */
export const TyposquatChip: React.FC<Props> = ({ eco, name, popular, dismissed, onDismiss }) => {
  if (eco !== 'npm' && eco !== 'pypi') return null;
  const e: TyposquatEcosystem = eco;
  const candidate = typosquatWarning(e, name, popular, dismissed);
  if (!candidate) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
      title={`${name} is not a popular package but is very close to ${candidate}. A look-alike name is a common way for malware to get in; check the spelling.`}
    >
      <span>Did you mean <code>{candidate}</code>?</span>
      <button type="button" onClick={() => onDismiss(typosquatKey(e, name))} className="hover:text-theme-text rounded p-0.5" aria-label={`Dismiss the warning about ${name}`} title="Dismiss">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
};
