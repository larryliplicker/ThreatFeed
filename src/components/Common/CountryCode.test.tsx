import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CountryCode } from './CountryCode';

describe('CountryCode', () => {
  it('shows the code with the country name as title', () => {
    const html = renderToStaticMarkup(<CountryCode code="se" />);
    expect(html).toContain('>SE<');
    expect(html).toContain('title="Sweden"');
  });
  it('renders nothing for an invalid or missing code', () => {
    expect(renderToStaticMarkup(<CountryCode code="x1" />)).toBe('');
    expect(renderToStaticMarkup(<CountryCode />)).toBe('');
  });
});
