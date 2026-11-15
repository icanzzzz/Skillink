import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptySkillFile } from '@skillink/shared';
import { renderWithMessages } from '../i18n.test-utils.js';
import { SkillsView } from './SkillsView.js';

describe('SkillsView', () => {
  it('renders the empty state, import action, and GC panel', () => {
    const html = renderToStaticMarkup(
      <SkillsView skills={createEmptySkillFile()} />,
    );

    expect(html).toContain('No skills yet. Import a folder that contains SKILL.md.');
    expect(html).toContain('Import skills');
    expect(html).toContain('Garbage collection');
    expect(html).toContain('GC dry run');
    expect(html).toContain('Apply GC');
  });

  it('does not render the import modal while it is closed', () => {
    const html = renderToStaticMarkup(
      <SkillsView skills={createEmptySkillFile()} />,
    );

    expect(html).not.toContain('modal-backdrop');
    expect(html).not.toContain('Drop a folder here');
  });

  it('renders installed skills with version tabs and translated headings', () => {
    const html = renderWithMessages(
      <SkillsView
        skills={{
          schemaVersion: 2,
          skills: {
            demo: {
              tags: { stable: '1.0.0' },
              versions: {
                '1.0.0': {
                  integrity: 'sha512-abc',
                  fileCount: 2,
                  size: 128,
                  built: false,
                },
              },
            },
          },
        }}
      />,
      {
        'skills.heading': '已安装技能',
        'skills.empty': '还没有技能。',
      },
    );

    expect(html).toContain('已安装技能');
    expect(html).toContain('demo');
    expect(html).toContain('1.0.0');
    expect(html).toContain('stable');
    expect(html).toContain('class="tag is-active"');
  });
});
