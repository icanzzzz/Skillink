import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TargetRoute } from '@skillink/shared';
import { renderWithMessages } from './i18n.test-utils.js';
import {
  AddTargetDialog,
  TargetsView,
  invokeTargetsAction,
} from './TargetsView.js';

const target: TargetRoute = {
  id: 'project-a',
  label: 'Project A',
  path: 'C:/Projects/ProjectA/skills',
  mode: 'link',
  enabled: true,
  packages: {
    frontend: {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-abc',
      enabled: true,
    },
  },
};

const secondTarget: TargetRoute = {
  id: 'project-b',
  label: 'Project B',
  path: 'C:/Projects/ProjectB/skills',
  mode: 'link',
  enabled: true,
  packages: {},
};

function targetBlock(html: string, targetId: string): string {
  const marker = `data-target-id="${targetId}"`;
  const start = html.indexOf(marker);
  const next = html.indexOf('data-target-id="', start + marker.length);
  return html.slice(start, next === -1 ? undefined : next);
}

describe('TargetsView', () => {
  it('renders the empty state', () => {
    const html = renderToStaticMarkup(<TargetsView targets={[]} />);

    expect(html).toContain('No targets yet');
    expect(html).toContain('skill folders');
    expect(html).toContain('Add target');
  });

  it('keeps the add-target form in a dialog instead of the page body', () => {
    const page = renderToStaticMarkup(<TargetsView targets={[]} />);
    const dialog = renderToStaticMarkup(
      <AddTargetDialog open onClose={() => undefined} />,
    );

    expect(page).not.toContain('<select');
    expect(dialog).toMatch(/<option value="copy"[^>]*disabled/);
    expect(dialog).toContain('Directory path');
  });

  it('renders package and resolved skill counts', () => {
    const html = renderToStaticMarkup(
      <TargetsView
        targets={[target]}
        targetSkills={[
          {
            targetId: 'project-a',
            skills: [{ name: 'pdf', version: '1.0.0' }],
          },
        ]}
      />,
    );

    expect(html).toContain('1 package');
    expect(html).toContain('1 skill');
  });

  it('renders packages inside their target and one assign action per target', () => {
    const html = renderToStaticMarkup(
      <TargetsView targets={[target, secondTarget]} />,
    );
    const projectA = targetBlock(html, 'project-a');
    const projectB = targetBlock(html, 'project-b');

    expect(projectA).toContain('frontend');
    expect(projectA).not.toContain('No packages assigned yet.');
    expect(projectA.match(/Assign package/g)).toHaveLength(1);
    expect(projectB).toContain('No packages assigned yet.');
    expect(projectB).not.toContain('frontend');
    expect(projectB.match(/Assign package/g)).toHaveLength(1);
    expect(html).not.toContain('Package assignments');
  });

  it('renders targets as cards in a responsive grid', () => {
    const html = renderToStaticMarkup(
      <TargetsView targets={[target, secondTarget]} />,
    );

    expect(html).toContain('class="target-grid"');
    expect(html.match(/class="target-card"/g)).toHaveLength(2);
    expect(html).not.toContain('targets-table');
    expect(html).not.toContain('table-head');
  });

  it('keeps disabled packages manageable from the target row', () => {
    const disabledTarget: TargetRoute = {
      ...target,
      packages: {
        frontend: {
          requested: '1.0.0',
          resolved: '1.0.0',
          integrity: 'sha256-abc',
          enabled: false,
        },
      },
    };
    const html = renderToStaticMarkup(
      <TargetsView
        targets={[disabledTarget]}
        onRouteEnable={() => {}}
        onRemoveRoute={() => {}}
      />,
    );

    expect(html).toContain('Enable route');
    expect(html).toContain('Remove route');
  });

  it('invokes apply and preview actions without options', () => {
    const action = vi.fn();

    invokeTargetsAction(action);

    expect(action).toHaveBeenCalledWith();
  });

  it('renders lifecycle controls and apply reports', () => {
    const html = renderToStaticMarkup(
      <TargetsView
        targets={[target]}
        applyReport={{
          dryRun: true,
          ok: true,
          operations: [
            {
              kind: 'create-link',
              targetId: 'project-a',
              targetPath: 'C:/Projects/ProjectA/skills',
              name: 'pdf',
              version: '1.0.0',
              path: 'C:/Projects/ProjectA/skills/pdf',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('Remove target');
    expect(html).toContain('Disable target');
    expect(html).toContain('Preview apply');
    expect(html).not.toContain('Prune');
    expect(html).toContain('frontend');
    expect(html).toContain('Remove route');
    expect(html).toContain('dry-run');
    expect(html).toContain('Assign package');
    expect(html).not.toContain('Package assignments');
  });

  it('renders target paths and package counts', () => {
    const html = renderToStaticMarkup(<TargetsView targets={[target]} />);

    expect(html).toContain('C:/Projects/ProjectA/skills');
    expect(html).toContain('Project A');
    expect(html).toContain('1 package');
    expect(html).toContain('Add target');
    expect(html).toContain('Assign package');
    expect(html).toContain('Apply routes');
  });

  it('renders translated headings', () => {
    const html = renderWithMessages(<TargetsView targets={[]} />, {
      'targets.routes.title': '目标目录',
      'targets.form.addTarget': '添加目标',
    });

    expect(html).toContain('目标目录');
    expect(html).toContain('添加目标');
  });

  it('pluralizes package and skill counts', () => {
    const html = renderToStaticMarkup(
      <TargetsView
        targets={[target]}
        targetSkills={[
          {
            targetId: 'project-a',
            skills: [
              { name: 'pdf', version: '1.0.0' },
              { name: 'review', version: '1.0.0' },
              { name: 'slides', version: '1.0.0' },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain('1 package');
    expect(html).toContain('3 skills');
  });
});
