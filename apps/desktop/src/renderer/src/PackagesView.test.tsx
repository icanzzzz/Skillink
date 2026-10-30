import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyPackageFile, createEmptySkillFile } from '@skillink/shared';
import { PackagesView } from './PackagesView.js';

describe('PackagesView', () => {
  it('renders the empty state and both forms', () => {
    const html = renderToStaticMarkup(
      <PackagesView
        packages={createEmptyPackageFile()}
        skills={createEmptySkillFile()}
      />,
    );

    expect(html).toContain('No packages yet');
    expect(html).toContain('Create package');
    expect(html).toContain('Copy package');
  });

  it('renders package compositions', () => {
    const html = renderToStaticMarkup(
      <PackagesView
        packages={{
          schemaVersion: 2,
          packages: {
            frontend: {
              tags: { latest: '1.0.0' },
              versions: {
                '1.0.0': {
                  skills: { pdf: '1.0.0' },
                  packages: { base: '2.0.0' },
                },
              },
            },
          },
        }}
        skills={{
          schemaVersion: 2,
          skills: {
            pdf: {
              versions: {
                '1.0.0': {
                  integrity: 'sha512-pdf',
                  fileCount: 1,
                  size: 1,
                  built: false,
                },
              },
            },
          },
        }}
      />,
    );

    expect(html).toContain('frontend');
    expect(html).toContain('1.0.0');
    expect(html).toContain('pdf@1.0.0');
    expect(html).toContain('base@2.0.0');
    expect(html).toContain('Available skills');
  });
});
