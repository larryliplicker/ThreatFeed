import { countryName } from '../../utils/countries';

/** Two-letter country code in the muted monospace chip style (replaces flag emoji); nothing for an invalid code. */
export function CountryCode({ code }: { code?: string }) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  const upper = code.toUpperCase();
  return (
    <span title={countryName(upper)} className="inline-block px-1 rounded border border-theme-border bg-theme-surface text-[10px] font-mono font-bold leading-4 text-theme-text-muted align-middle">
      {upper}
    </span>
  );
}
