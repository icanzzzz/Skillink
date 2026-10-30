import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptySkillFile } from '@skillink/shared';
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
});
