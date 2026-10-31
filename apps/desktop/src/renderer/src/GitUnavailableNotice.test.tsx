import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '@skillink/shared';
import { GitUnavailableNotice } from './GitUnavailableNotice.js';
import { renderWithMessages } from './i18n.test-utils.js';

describe('GitUnavailableNotice', () => {
  it('warns that git-backed features are unavailable', () => {
    const html = renderWithMessages(
      <GitUnavailableNotice visible />,
      EN_MESSAGES,
    );

    expect(html).toContain('sidebar-warning');
    expect(html).toContain(EN_MESSAGES['app.git.missing']);
  });

  it('renders nothing when git is available', () => {
    const html = renderWithMessages(
      <GitUnavailableNotice visible={false} />,
      EN_MESSAGES,
    );

    expect(html).toBe('');
  });
});
