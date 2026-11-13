import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '@skillink/shared';
import type { VersionChoice } from '../library.js';
import { renderWithMessages } from '../i18n.test-utils.js';
import { VersionSelect } from './VersionSelect.js';

const options: VersionChoice[] = [
  { value: 'latest', label: 'latest → 1.0.0', kind: 'tag' },
  { value: '1.0.0', label: '1.0.0', kind: 'version' },
];

describe('VersionSelect', () => {
  it('renders tag and exact version labels', () => {
    const html = renderWithMessages(
      <VersionSelect
        label="Version"
        name="frontend"
        options={options}
        value="1.0.0"
        onChange={() => {}}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('latest → 1.0.0');
    expect(html).toMatch(/value="1\.0\.0"[^>]*>1\.0\.0<\/option>/);
    expect(html).toContain('aria-label="Version: frontend"');
  });

  it('adds an option for a value outside the list', () => {
    const html = renderWithMessages(
      <VersionSelect
        label="Version"
        name="frontend"
        options={options}
        value="9.9.9"
        onChange={() => {}}
      />,
      EN_MESSAGES,
    );

    expect(html).toMatch(/value="9\.9\.9"[^>]*>9\.9\.9<\/option>/);
  });
});
