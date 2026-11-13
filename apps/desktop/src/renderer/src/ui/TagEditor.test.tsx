import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '@skillink/shared';
import { renderWithMessages } from '../i18n.test-utils.js';
import { TagEditor } from './TagEditor.js';

describe('TagEditor', () => {
  it('renders the current tag as static text and other tags as buttons', () => {
    const html = renderWithMessages(
      <TagEditor
        label="Tags"
        tags={{ latest: '1.0.0', stable: '2.0.0' }}
        currentVersion="1.0.0"
        onApplyTag={() => {}}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('class="tag is-active"');
    expect(html).not.toMatch(
      /class="tag tag-button"[^>]*>\s*<code>latest<\/code>/,
    );
    expect(html).toContain('class="tag tag-button"');
    expect(html).toContain('<code>stable</code>');
    expect(html).toContain(EN_MESSAGES['packages.tag.new']);
  });
});
