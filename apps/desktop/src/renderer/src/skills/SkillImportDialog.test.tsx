import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '@skillink/shared';
import { renderWithMessages } from '../i18n.test-utils.js';
import { SkillBatchCard } from './SkillBatchCard.js';
import { SkillImportDialog } from './SkillImportDialog.js';

describe('SkillImportDialog', () => {
  it('renders the drop zone and the folder chooser', () => {
    const html = renderWithMessages(
      <SkillImportDialog open onClose={() => undefined} />,
      EN_MESSAGES,
    );

    expect(html).toContain('Drop a folder here');
    expect(html).toContain('Choose folder');
    expect(html).toContain('class="drop-zone"');
  });

  it('keeps the manual path input inside a collapsed details element', () => {
    const html = renderWithMessages(
      <SkillImportDialog open onClose={() => undefined} />,
      EN_MESSAGES,
    );

    const detailsIndex = html.indexOf('<details');
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(html).toContain('class="manual-path"');
    expect(html.indexOf('Choose folder')).toBeLessThan(detailsIndex);
    expect(html).toContain('Enter path manually');
  });

  it('accepts a dropped-path resolver without crashing', () => {
    const html = renderWithMessages(
      <SkillImportDialog
        open
        onClose={() => undefined}
        onResolveDroppedPath={() => 'C:/Skills/demo'}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('Drop a folder here');
  });

  it('shows already installed packages with their visible prefilled values', () => {
    const html = renderWithMessages(
      <SkillBatchCard
        item={{
          sourceDir: 'C:/Skills/demo@1.0.0',
          name: 'demo',
          version: '1.0.0',
          defaultVersion: '1.0.0',
          directoryLinks: [],
          status: 'pending',
        }}
        alreadyInstalled
        onConfirm={() => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('Already installed');
    expect(html).toContain('value="demo"');
    expect(html).toContain('value="1.0.0"');
  });
});
