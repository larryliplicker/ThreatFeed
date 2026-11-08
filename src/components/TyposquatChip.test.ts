import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PopularData } from '../services/packages/popular';
import { typosquatKey } from '../services/packages/typosquat';
import { TyposquatChip } from './TyposquatChip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const popular: PopularData = {
  npm: { allow: ['lodash'], targets: ['lodash'] },
  pypi: { allow: ['requests'], targets: ['requests'] },
  builtAt: '2026-11-08T00:00:00.000Z',
};

type Props = Parameters<typeof TyposquatChip>[0];
const props = (over: Partial<Props> = {}): Props => ({ eco: 'pypi', name: 'reqeusts', popular, dismissed: [], onDismiss: () => {}, ...over });
const html = (over: Partial<Props>) => renderToStaticMarkup(createElement(TyposquatChip, props(over)));

describe('TyposquatChip', () => {
  it('asks "Did you mean" and dismisses with the package key', () => {
    const onDismiss = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(TyposquatChip, props({ onDismiss }))));
    expect(host.textContent).toContain('Did you mean');
    expect(host.querySelector('code')?.textContent).toBe('requests');
    act(() => host.querySelector('button')!.click());
    expect(onDismiss).toHaveBeenCalledWith('pypi:reqeusts');
    act(() => root.unmount());
  });

  it('renders nothing for a dismissed name, an allow-listed name, another ecosystem or without data', () => {
    expect(html({ dismissed: [typosquatKey('pypi', 'reqeusts')] })).toBe('');
    expect(html({ name: 'requests' })).toBe('');
    expect(html({ eco: 'maven' })).toBe('');
    expect(html({ popular: null })).toBe('');
  });
});
