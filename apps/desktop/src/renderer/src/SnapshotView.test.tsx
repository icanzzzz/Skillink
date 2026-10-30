import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
} from '@skillink/shared';
import type { DesktopSnapshot } from '../../shared.js';
import { SnapshotView } from './SnapshotView.js';

const emptySnapshot: DesktopSnapshot = {
  home: 'C:/Users/<user>/.agents/skillink',
  skills: createEmptySkillFile(),
  packages: createEmptyPackageFile(),
  route: createEmptyRouteFile(),
  status: { healthy: true, entries: [] },
  doctor: { ok: true, issues: [] },
};

describe('SnapshotView', () => {
  it('renders the empty state and health badge', () => {
    const html = renderToStaticMarkup(
      <SnapshotView snapshot={emptySnapshot} />,
    );

    expect(html).toContain('Skillink');
    expect(html).toContain('0 skills');
    expect(html).toContain('0 packages');
    expect(html).toContain('0 targets');
    expect(html).toContain('healthy');
    expect(html).toContain('No targets yet');
    expect(html).toContain('No packages yet');
    expect(html).toContain('No skills yet');
  });

  it('renders a skill, a package, and a target', () => {
    const snapshot: DesktopSnapshot = {
      ...emptySnapshot,
      skills: {
        schemaVersion: 2,
        skills: {
          demo: {
            versions: {
              '1.0.0': {
                integrity: 'sha512-abc',
                fileCount: 3,
                size: 2048,
                built: false,
              },
            },
          },
        },
      },
      packages: {
        schemaVersion: 2,
        packages: {
          'demo-pack': {
            versions: {
              '1.0.0': {
                skills: { demo: '1.0.0' },
                packages: {},
              },
            },
          },
        },
      },
      route: {
        schemaVersion: 2,
        targets: [
          {
            id: 'project-a',
            label: 'Project A',
            path: 'C:/Projects/ProjectA/skills',
            mode: 'link',
            enabled: true,
            packages: {
              'demo-pack': {
                requested: '1.0.0',
                resolved: '1.0.0',
                integrity: 'sha256-abc',
                enabled: true,
              },
            },
          },
        ],
      },
      status: {
        healthy: true,
        entries: [
          {
            targetId: 'project-a',
            targetPath: 'C:/Projects/ProjectA/skills',
            name: 'demo',
            version: '1.0.0',
            state: 'ok',
            path: 'C:/Projects/ProjectA/skills/demo',
          },
        ],
      },
      targetSkills: [
        {
          targetId: 'project-a',
          skills: [{ name: 'demo', version: '1.0.0' }],
        },
      ],
    };

    const html = renderToStaticMarkup(<SnapshotView snapshot={snapshot} />);

    expect(html).toContain('1 skills');
    expect(html).toContain('1 packages');
    expect(html).toContain('1 targets');
    expect(html).toContain('Project A');
    expect(html).toContain('demo-pack');
    expect(html).toContain('demo');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('<span>Skills</span>');
    expect(html).toContain('<span>1</span>');
  });
});
