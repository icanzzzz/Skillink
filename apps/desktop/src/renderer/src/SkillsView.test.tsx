import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptySkillFile } from '@skillink/shared';
import { renderWithMessages } from './i18n.test-utils.js';
import { SkillsView } from './SkillsView.js';

describe('SkillsView', () => {
  it('renders the empty state', () => {
    const html = renderToStaticMarkup(
      <SkillsView skills={createEmptySkillFile()} />,
    );

    expect(html).toContain('No skills yet');
    expect(html).toContain('SKILL.md');
  });

  it('renders skill names, versions, tags, and the import button', () => {
    const html = renderToStaticMarkup(
      <SkillsView
        skills={{
          schemaVersion: 2,
          skills: {
            demo: {
              tags: { stable: '1.0.0', latest: '1.1.0' },
              versions: {
                '1.0.0': {
                  integrity: 'sha512-abc',
                  fileCount: 2,
                  size: 128,
                  built: false,
                },
                '1.1.0': {
                  integrity: 'sha512-def',
                  fileCount: 3,
                  size: 256,
                  built: false,
                },
              },
            },
          },
        }}
      />,
    );

    expect(html).toContain('demo');
    expect(html).toContain('1.0.0');
    expect(html).toContain('1.1.0');
    expect(html).toContain('stable');
    expect(html).toContain('latest');
    expect(html).toContain('Import skill');
  });

  it('renders translated skill headings and empty state', () => {
    const html = renderWithMessages(
      <SkillsView skills={createEmptySkillFile()} />,
      {
        'skills.heading': '已安装技能',
        'skills.empty': '还没有技能。',
      },
    );

    expect(html).toContain('已安装技能');
    expect(html).toContain('还没有技能。');
  });

  it('pluralizes file and gc candidate counts', () => {
    const html = renderToStaticMarkup(
      <SkillsView
        skills={{
          schemaVersion: 2,
          skills: {
            demo: {
              versions: {
                '1.0.0': {
                  integrity: 'sha512-abc',
                  fileCount: 1,
                  size: 128,
                  built: false,
                },
                '1.1.0': {
                  integrity: 'sha512-def',
                  fileCount: 2,
                  size: 256,
                  built: false,
                },
              },
            },
          },
        }}
        gcReport={{
          dryRun: true,
          candidates: [
            {
              name: 'demo',
              version: '0.9.0',
              path: 'C:/home/skills/demo/0.9.0',
              size: 10,
              modifiedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              name: 'demo',
              version: '0.8.0',
              path: 'C:/home/skills/demo/0.8.0',
              size: 20,
              modifiedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          freedBytes: 30,
          removed: [],
        }}
      />,
    );

    expect(html).toContain('1 file');
    expect(html).toContain('2 files');
    expect(html).toContain('2 candidates');
  });
});
