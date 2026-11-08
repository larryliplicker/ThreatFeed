export type Ecosystem = 'npm' | 'pypi' | 'maven' | 'go' | 'nuget' | 'cargo';

/**
 * The package ecosystems ThreatFeed knows. `ghsa` is the GitHub advisories API `ecosystem` value, `osv` the OSV.dev
 * name. `prefixes` are the accepted entry prefixes, case-insensitive; the first is canonical. npm has none: an entry
 * without a prefix is npm.
 */
export const ECOSYSTEMS: Record<Ecosystem, { label: string; ghsa: string; osv: string; prefixes: string[] }> = {
  npm: { label: 'npm', ghsa: 'npm', osv: 'npm', prefixes: [] },
  pypi: { label: 'PyPI', ghsa: 'pip', osv: 'PyPI', prefixes: ['pypi', 'pip'] },
  maven: { label: 'Maven', ghsa: 'maven', osv: 'Maven', prefixes: ['maven'] },
  go: { label: 'Go', ghsa: 'go', osv: 'Go', prefixes: ['go'] },
  nuget: { label: 'NuGet', ghsa: 'nuget', osv: 'NuGet', prefixes: ['nuget'] },
  cargo: { label: 'crates.io', ghsa: 'rust', osv: 'crates.io', prefixes: ['cargo', 'rust', 'crates'] },
};
