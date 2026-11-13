import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyPackageFile, createEmptySkillFile } from '@skillink/shared';
import { renderWithMessages } from '../i18n.test-utils.js';
import { PackagesView } from './PackagesView.js';

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
        '1.1.0': {
          integrity: 'sha512-pdf-11',
          fileCount: 1,
          size: 1,
          built: false,
        },
      },
    },
  },
};

const packages = {
  schemaVersion: 2 as const,
  packages: {
    frontend: {
      description: 'Frontend baseline',
      tags: { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          skills: { pdf: '1.0.0' },
          packages: { base: '2.0.0' },
        },
      },
    },
    base: {
      versions: {
        '2.0.0': { skills: {}, packages: {} },
      },
    },
  },
};

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

  it('renders one card per package with its composition', () => {
    const html = renderToStaticMarkup(
      <PackagesView packages={packages} skills={skills} />,
    );

    expect(html).toContain('frontend');
    expect(html).toContain('Frontend baseline');
    expect(html).toContain('1.0.0');
    expect(html).toContain('pdf@1.0.0');
    expect(html).toContain('base@2.0.0');
    expect(html).toContain('Copy');
    expect(html).toContain('base');
    expect(html).toContain('version-tab');
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain('Available skills');
    expect(html).not.toContain('<textarea');
  });

  it('disables creation when no handler is provided', () => {
    const html = renderToStaticMarkup(
      <PackagesView
        packages={createEmptyPackageFile()}
        skills={createEmptySkillFile()}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled[^>]*>Create package<\/button>/);
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
