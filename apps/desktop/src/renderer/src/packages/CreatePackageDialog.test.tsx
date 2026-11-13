import { describe, expect, it } from 'vitest';
import { EN_MESSAGES, type PackageFile, type SkillFile } from '@skillink/shared';
import { renderWithMessages } from '../i18n.test-utils.js';
import { CreatePackageDialog } from './CreatePackageDialog.js';

const packages: PackageFile = {
  schemaVersion: 2,
  packages: {
    frontend: {
      description: 'Frontend baseline',
      tags: { latest: '1.0.0' },
      versions: {
        '1.0.0': { skills: { pdf: '1.0.0' }, packages: {} },
      },
    },
  },
};

const skills: SkillFile = {
  schemaVersion: 2,
  skills: {
    pdf: {
      description: 'PDF toolkit',
      versions: {
        '1.0.0': { integrity: 'sha512-a', fileCount: 1, size: 1, built: false },
      },
    },
  },
};

const emptyPackages: PackageFile = { schemaVersion: 2, packages: {} };
const emptySkills: SkillFile = { schemaVersion: 2, skills: {} };

describe('CreatePackageDialog', () => {
  it('renders pickers and the explicit name mode instead of dependency textareas', () => {
    const html = renderWithMessages(
      <CreatePackageDialog
        open
        packages={packages}
        skills={skills}
        onClose={() => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).not.toContain('<textarea');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Existing package');
    expect(html).toContain('New package');
    expect(html).toContain('value="1.0.0"');
    expect(html).toContain('data-size="lg"');
  });

  it('prefills the version when copying an existing package version', () => {
    const html = renderWithMessages(
      <CreatePackageDialog
        open
        packages={packages}
        skills={skills}
        preset={{ name: 'frontend', version: '1.0.0' }}
        onClose={() => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('Copied from frontend@1.0.0.');
    expect(html).toContain('value="1.0.1"');
  });

  it('renders guidance instead of crashing when the library is empty', () => {
    const html = renderWithMessages(
      <CreatePackageDialog
        open
        packages={emptyPackages}
        skills={emptySkills}
        onClose={() => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('No skills installed yet.');
    expect(html).toContain('No other packages yet.');
    expect(html).not.toContain('<textarea');
  });

  it('renders nothing when closed', () => {
    const html = renderWithMessages(
      <CreatePackageDialog
        open={false}
        packages={packages}
        skills={skills}
        onClose={() => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).not.toContain('modal-backdrop');
  });
});
