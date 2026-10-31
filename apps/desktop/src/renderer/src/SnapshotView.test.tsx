import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
} from '@skillink/shared';
import type { DesktopSnapshot } from '../../shared.js';
import { renderWithMessages } from './i18n.test-utils.js';
import { SnapshotView } from './SnapshotView.js';

const emptySnapshot: DesktopSnapshot = {
  home: 'C:/Users/<user>/.agents/skillink',
  skills: createEmptySkillFile(),
  packages: createEmptyPackageFile(),
  route: createEmptyRouteFile(),
  status: { healthy: true, entries: [] },
  doctor: { ok: true, issues: [] },
  targetSkills: [],
  history: [],
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

    expect(html).toContain('1 skill');
    expect(html).toContain('1 package');
    expect(html).toContain('1 target');
    expect(html).toContain('Project A');
    expect(html).toContain('demo-pack');
    expect(html).toContain('demo');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('<span>Skills</span>');
    expect(html).toContain('<span>1</span>');
  });

  it('renders translated overview text and issue counts', () => {
    const issueSnapshot: DesktopSnapshot = {
      ...emptySnapshot,
      doctor: {
        ok: false,
        issues: [
          {
            code: 'MISSING_CONTENT',
            message: 'Skill content is missing: demo@1.0.0',
            name: 'demo',
            version: '1.0.0',
          },
          {
            code: 'LINK_ISSUE',
            message: 'target/other: wrong-version',
            targetId: 'target',
            name: 'other',
            version: '2.0.0',
          },
        ],
      },
    };

    const html = renderWithMessages(<SnapshotView snapshot={issueSnapshot} />, {
      'overview.routes.title': '目标目录',
      'overview.health.issues': '{count} 个问题',
    });

    expect(html).toContain('目标目录');
    expect(html).toContain('2 个问题');
  });

  it('uses plural messages for skill counts', () => {
    const snapshot: DesktopSnapshot = {
      ...emptySnapshot,
      skills: {
        schemaVersion: 2,
        skills: {
          one: {
            versions: {
              '1.0.0': { integrity: 'a', fileCount: 1, size: 1, built: false },
            },
          },
          two: {
            versions: {
              '1.0.0': { integrity: 'b', fileCount: 1, size: 1, built: false },
            },
          },
          three: {
            versions: {
              '1.0.0': { integrity: 'c', fileCount: 1, size: 1, built: false },
            },
          },
        },
      },
    };

    const html = renderToStaticMarkup(<SnapshotView snapshot={snapshot} />);

    expect(html).toContain('3 skills');
  });
});
