import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptySkillsFile } from '@skillink/shared';
import { LibraryView } from './LibraryView.js';

describe('LibraryView', () => {
  it('renders the empty state', () => {
    const html = renderToStaticMarkup(
      <LibraryView library={createEmptySkillsFile()} />,
    );

    expect(html).toContain('No packages yet');
  });

  it('renders package names, versions, and tags', () => {
    const html = renderToStaticMarkup(
      <LibraryView
        library={{
          schemaVersion: 1,
          packages: {
            demo: {
              kind: 'folder',
              tags: { stable: '1.0.0', latest: '1.1.0' },
              versions: {
                '1.0.0': {
                  integrity: 'sha512-abc',
                  source: 'skills/demo/1.0.0',
                  fileCount: 2,
                  size: 128,
                  built: false,
                },
                '1.1.0': {
                  integrity: 'sha512-def',
                  source: 'skills/demo/1.1.0',
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
    expect(html).toContain('Import folder');
  });
});
