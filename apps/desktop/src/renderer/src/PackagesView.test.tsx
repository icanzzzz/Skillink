import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyPackageFile, createEmptySkillFile } from '@skillink/shared';
import { renderWithMessages } from './i18n.test-utils.js';
import { CreatePackageDialog, PackagesView } from './PackagesView.js';

describe('PackagesView', () => {
  it('renders the empty state and the create action', () => {
    const html = renderToStaticMarkup(
      <PackagesView
        packages={createEmptyPackageFile()}
        skills={createEmptySkillFile()}
      />,
    );

    expect(html).toContain('No packages yet');
    expect(html).toContain('Create package');
    expect(html).not.toContain('Copy package');
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
    expect(html).toContain('Copy');
    expect(html).not.toContain('Available skills');
  });

  it('renders the create form and prefills it from a copied version', () => {
    const skills = {
      schemaVersion: 2 as const,
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
    };
    const create = renderToStaticMarkup(
      <CreatePackageDialog open skills={skills} onClose={() => undefined} />,
    );
    const copied = renderToStaticMarkup(
      <CreatePackageDialog
        open
        skills={skills}
        preset={{
          name: 'frontend',
          version: '1.0.0',
          description: 'Frontend baseline',
          skills: { pdf: '1.0.0' },
          packages: { base: '2.0.0' },
        }}
        onClose={() => undefined}
      />,
    );

    expect(create).toContain('Package name');
    expect(create).toContain('Available skills:');
    expect(copied).toContain(
      'Prefilled from frontend@1.0.0. Change the version and dependencies to create a new version.',
    );
    expect(copied).toContain('value="frontend"');
    expect(copied).toContain('pdf@1.0.0');
    expect(copied).toContain('base@2.0.0');
    expect(copied).toContain('Frontend baseline');
  });

  it('renders translated package headings and actions', () => {
    const html = renderWithMessages(
      <PackagesView
        packages={createEmptyPackageFile()}
        skills={createEmptySkillFile()}
      />,
      {
        'packages.heading': '包组合',
        'packages.create': '创建包',
      },
    );

    expect(html).toContain('包组合');
    expect(html).toContain('创建包');
  });
});
