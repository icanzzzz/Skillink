import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TargetRoute } from '@skillink/shared';
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

  it('renders target paths and package counts', () => {
    const html = renderToStaticMarkup(<TargetsView targets={[target]} />);

    expect(html).toContain('C:/Projects/ProjectA/skills');
    expect(html).toContain('Project A');
    expect(html).toContain('1 package');
    expect(html).toContain('Add target');
    expect(html).toContain('Assign package');
    expect(html).toContain('Apply routes');
  });
});
