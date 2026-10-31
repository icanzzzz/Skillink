import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TargetRoute } from '@skillink/shared';
import { renderWithMessages } from './i18n.test-utils.js';
import { TargetsView } from './TargetsView.js';

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

describe('TargetsView', () => {
  it('renders the empty state', () => {
    const html = renderToStaticMarkup(<TargetsView targets={[]} />);

    expect(html).toContain('No targets yet');
    expect(html).toContain('skill folders');
  });

  it('disables the unimplemented copy mode option', () => {
    const html = renderToStaticMarkup(<TargetsView targets={[]} />);

    expect(html).toMatch(/<option value="copy"[^>]*disabled/);
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
          conflicts: [],
        }}
      />,
    );

    expect(html).toContain('Remove target');
    expect(html).toContain('Disable target');
    expect(html).toContain('Preview apply');
    expect(html).toContain('frontend');
    expect(html).toContain('Remove route');
    expect(html).toContain('dry-run');
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
