import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptySkillFile } from '@skillink/shared';
import { renderWithMessages } from './i18n.test-utils.js';
import {
  SkillBatchCard,
  SkillImportDialog,
  SkillsView,
  resolveSkillBatchName,
} from './SkillsView.js';

describe('SkillsView', () => {
  it('renders the empty state', () => {
    const html = renderToStaticMarkup(
      <SkillsView skills={createEmptySkillFile()} />,
    );

    expect(html).toContain('No skills yet');
    expect(html).toContain('SKILL.md');
    expect(html).toContain('Import skills');
  });

  it('renders the scan workflow inside the import dialog', () => {
    const html = renderToStaticMarkup(
      <SkillImportDialog open onClose={() => undefined} />,
    );

    expect(html).toContain('Install skill packages');
    expect(html).toContain('Scan folder');
    expect(html).toContain('Source folder to scan for SKILL.md');
  });

  it('renders skill names, versions, tags, and the scan controls', () => {
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
    expect(html).toContain('Import skills');
  });

  it('groups installed versions into one card with a single action panel', () => {
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

    expect(html.match(/class="package-card skill-card"/g)).toHaveLength(1);
    expect(
      html.match(/class="version-tab(?: is-active)?"/g),
    ).toHaveLength(2);
    expect(html.match(/placeholder="Required"/g)).toHaveLength(1);
    expect(html).toContain('aria-pressed="true"');
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
                  fileCount: 2,
                  size: 128,
                  built: false,
                },
                '1.1.0': {
                  integrity: 'sha512-def',
                  fileCount: 1,
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

    expect(html).toContain('2 files');
    expect(html).toContain('2 candidates');
  });

  it('renders a pending install panel for each scanned package', () => {
    const html = renderWithMessages(
      <SkillBatchCard
        item={{
          sourceDir: 'C:/Skills/linked@1.0.0',
          name: 'linked',
          version: '1.0.0',
          description: 'Linked skill',
          directoryLinks: [],
          status: 'pending',
        }}
      />,
      {},
    );

    expect(html).toContain('linked');
    expect(html).toContain('1.0.0');
    expect(html).toContain('C:/Skills/linked@1.0.0');
    expect(html).toContain('Linked skill');
    expect(html).toContain('Confirm install');
  });

  it('shows scanned defaults as placeholders without filling the fields', () => {
    const html = renderWithMessages(
      <SkillBatchCard
        item={{
          sourceDir: 'C:/Skills/linked@1.0.0',
          name: '',
          autoName: 'linked',
          version: '',
          defaultVersion: '1.0.0',
          directoryLinks: [],
          status: 'pending',
        }}
        onConfirm={() => undefined}
      />,
      {},
    );

    expect(html).toContain('placeholder="linked"');
    expect(html).not.toContain('value="linked"');
    expect(html).toContain('placeholder="1.0.0"');
    expect(html).not.toContain('placeholder="Version"');
    expect(html).not.toContain('1.0.0+');
    expect(html).toContain('<strong>linked</strong>');
    expect(html).not.toContain('disabled');
  });

  it('shows required placeholders when scanning finds no defaults', () => {
    const html = renderWithMessages(
      <SkillBatchCard
        item={{
          sourceDir: 'C:/Skills/untitled',
          name: '',
          autoName: '',
          version: '',
          directoryLinks: [],
          status: 'pending',
        }}
        onConfirm={() => undefined}
      />,
      {},
    );

    expect(html.match(/placeholder="Required"/g)).toHaveLength(1);
    expect(html).toContain('placeholder="1.0.0"');
  });

  it('falls back to the scanned name when the name field is empty', () => {
    const item = {
      sourceDir: 'C:/Skills/linked@1.0.0',
      name: '  ',
      autoName: 'linked',
      version: '',
      directoryLinks: [],
      status: 'pending' as const,
    };

    expect(resolveSkillBatchName(item)).toBe('linked');
    expect(
      resolveSkillBatchName({ ...item, name: 'custom' }),
    ).toBe('custom');
    expect(resolveSkillBatchName({ ...item, autoName: '' })).toBe('');
  });

  it('shows the directory link path and cancels that package install', () => {
    const html = renderWithMessages(
      <SkillBatchCard
        item={{
          sourceDir: 'C:/Skills/linked@1.0.0',
          name: 'linked',
          version: '1.0.0',
          directoryLinks: ['C:/Skills/linked@1.0.0/assets'],
          status: 'blocked',
        }}
      />,
      {},
    );

    expect(html).toContain('Directory link detected');
    expect(html).toContain('C:/Skills/linked@1.0.0/assets');
    expect(html).toContain('Installation cancelled');
    expect(html).not.toContain('Confirm install');
  });
});
