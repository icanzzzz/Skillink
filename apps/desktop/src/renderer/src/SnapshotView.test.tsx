import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyRouteFile, createEmptySkillsFile } from '@skillink/shared';
import type { DesktopSnapshot } from '../../shared.js';
import { SnapshotView } from './SnapshotView.js';

const emptySnapshot: DesktopSnapshot = {
  home: 'C:/Users/<user>/.agents/skillink',
  library: createEmptySkillsFile(),
  route: createEmptyRouteFile(),
  status: { healthy: true, entries: [] },
  doctor: { ok: true, issues: [] },
};

describe('SnapshotView', () => {
  it('renders the empty state and health badge', () => {
    const html = renderToStaticMarkup(<SnapshotView snapshot={emptySnapshot} />);

    expect(html).toContain('Skillink');
    expect(html).toContain('0 packages');
    expect(html).toContain('0 targets');
    expect(html).toContain('healthy');
    expect(html).toContain('No targets yet');
    expect(html).toContain('No packages yet');
  });

  it('renders a package and a target', () => {
    const snapshot: DesktopSnapshot = {
      ...emptySnapshot,
      library: {
        schemaVersion: 1,
        packages: {
          demo: {
            kind: 'folder',
            versions: {
              '1.0.0': {
                integrity: 'sha512-abc',
                source: 'skills/demo/1.0.0',
                fileCount: 3,
                size: 2048,
                built: false,
              },
            },
          },
        },
      },
      route: {
        schemaVersion: 1,
        targets: [
          {
            id: 'project-a',
            label: 'Project A',
            path: 'C:/Projects/ProjectA/packages',
            mode: 'link',
            enabled: true,
            skills: {
              demo: {
                requested: '1.0.0',
                resolved: '1.0.0',
                integrity: 'sha512-abc',
                source: 'skills/demo/1.0.0',
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
            targetPath: 'C:/Projects/ProjectA/packages',
            name: 'demo',
            version: '1.0.0',
            state: 'ok',
            path: 'C:/Projects/ProjectA/packages/demo',
          },
        ],
      },
    };

    const html = renderToStaticMarkup(<SnapshotView snapshot={snapshot} />);

    expect(html).toContain('1 packages');
    expect(html).toContain('1 targets');
    expect(html).toContain('Project A');
    expect(html).toContain('demo');
    expect(html).toContain('2.0 KB');
  });
});
