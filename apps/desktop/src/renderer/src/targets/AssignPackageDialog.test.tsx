import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PackageFile, TargetRoute } from '@skillink/shared';
import {
  AssignPackageDialog,
  type AssignPackageDialogProps,
} from './AssignPackageDialog.js';

const packages: PackageFile = {
  schemaVersion: 2,
  packages: {
    backend: {
      versions: {
        '0.1.0': { skills: { api: '1.0.0' }, packages: {} },
      },
    },
    frontend: {
      tags: { latest: '1.2.0' },
      versions: {
        '1.0.0': { skills: { pdf: '1.0.0' }, packages: {} },
        '1.2.0': {
          skills: { pdf: '1.0.0', review: '1.0.0' },
          packages: {},
        },
      },
    },
  },
};

const target: TargetRoute = {
  id: 'project-a',
  label: 'Project A',
  path: 'C:/Projects/ProjectA/skills',
  mode: 'link',
  enabled: true,
  packages: {},
};

function renderAssign(
  overrides: Partial<AssignPackageDialogProps> = {},
): string {
  return renderToStaticMarkup(
    <AssignPackageDialog
      open
      target={target}
      packages={packages}
      onClose={() => undefined}
      {...overrides}
    />,
  );
}

describe('AssignPackageDialog', () => {
  it('explains an empty package library and disables assigning', () => {
    const html = renderAssign({
      packages: { schemaVersion: 2, packages: {} },
    });

    expect(html).toContain('No packages to assign. Create a package first.');
    expect(html).toMatch(/<button class="primary" type="submit" disabled="">Assign<\/button>/);
  });

  it('marks packages already assigned to the target', () => {
    const html = renderAssign({
      target: {
        ...target,
        packages: {
          frontend: {
            requested: '1.0.0',
            resolved: '1.0.0',
            integrity: 'sha256-abc',
            enabled: true,
          },
        },
      },
    });

    expect(html).toContain('already assigned');
    expect(html).toMatch(/<option[^>]*value="frontend"[^>]*disabled="">/);
  });

  it('previews the direct skill count of the selected version', () => {
    const html = renderAssign({
      target: {
        ...target,
        packages: {
          backend: {
            requested: '0.1.0',
            resolved: '0.1.0',
            integrity: 'sha256-abc',
            enabled: true,
          },
        },
      },
    });

    expect(html).toContain('class="assign-preview"');
    expect(html).toContain('2 skills directly');
    expect(html).toContain('latest → 1.2.0');
  });

  it('uses selectors instead of a free-text package field', () => {
    const html = renderAssign();

    expect(html).not.toContain('<datalist');
    expect(html).not.toContain('class="target-package-form"');
    expect(html).not.toContain('<input');
    expect(html.match(/<select/g)).toHaveLength(2);
  });

  it('renders nothing while closed', () => {
    const html = renderAssign({ open: false });

    expect(html).not.toContain('modal-backdrop');
  });
});
