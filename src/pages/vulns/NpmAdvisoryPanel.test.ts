import { describe, expect, it } from 'vitest';
import type { NpmAdvisory, NpmAdvisoryData } from '../../services/npm/advisories';
import { findAdvisoryIn } from './NpmAdvisoryPanel';

const adv = (id: string, pkg: string): NpmAdvisory => ({
  id, cves: [], summary: id, description: '', severity: 'high', cvss: [], cwes: [], ranges: [{ package: pkg, vulnerable: '< 2', patched: '2' }],
  published: '2026-11-01T00:00:00Z', updated: '2026-11-01T00:00:00Z', references: [], credits: [], url: `https://github.com/advisories/${id}`,
});
const file = (recent: NpmAdvisory[]): NpmAdvisoryData => ({ version: 1, generatedAt: '', updatedAt: '', recent, index: [] });

describe('findAdvisoryIn', () => {
  const files = { npm: file([adv('GHSA-aaaa-aaaa-aaaa', 'lodash')]), pypi: file([adv('GHSA-pypy-pypy-pypy', 'django')]) };
  it('finds an id in whichever loaded ecosystem has it', () => {
    expect(findAdvisoryIn('GHSA-aaaa-aaaa-aaaa', files, null)?.kind).toBe('detail');
    const found = findAdvisoryIn('GHSA-pypy-pypy-pypy', files, null);
    expect(found?.kind === 'detail' && found.advisory.ranges[0].package).toBe('django');
  });
  it('is null when no loaded ecosystem has it', () => {
    expect(findAdvisoryIn('GHSA-zzzz-zzzz-zzzz', files, null)).toBeNull();
    expect(findAdvisoryIn('GHSA-pypy-pypy-pypy', { npm: files.npm }, null)).toBeNull();
  });
});
