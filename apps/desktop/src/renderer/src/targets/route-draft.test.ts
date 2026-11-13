import { describe, expect, it } from 'vitest';
import type { PackageFile, PackageVersion } from '@skillink/shared';
import { packageOptions } from '../library.js';
import {
  EMPTY_ROUTE_DRAFT,
  createRouteDraft,
  routeDraftIssue,
  selectRoutePackage,
  setRouteRequested,
  toRouteAddInput,
} from './route-draft.js';

function version(skills: Record<string, string>): PackageVersion {
  return { skills, packages: {} };
}

const packages: PackageFile = {
  schemaVersion: 2,
  packages: {
    backend: {
      versions: {
        '0.1.0': version({ api: '1.0.0' }),
      },
    },
    frontend: {
      tags: { latest: '1.2.0' },
      versions: {
        '1.0.0': version({ pdf: '1.0.0' }),
        '1.2.0': version({ pdf: '1.0.0', review: '1.0.0' }),
      },
    },
    tools: {
      versions: {
        '2.0.0': version({ lint: '1.0.0' }),
      },
    },
  },
};

describe('route drafts', () => {
  it('starts with the first package that is not assigned yet', () => {
    const options = packageOptions(packages);
    const draft = createRouteDraft('project-a', options, ['backend']);

    expect(draft).toEqual({
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.2.0',
    });
  });

  it('leaves the package empty when everything is assigned', () => {
    const options = packageOptions(packages);
    const draft = createRouteDraft('project-a', options, [
      'backend',
      'frontend',
      'tools',
    ]);

    expect(draft).toEqual({ targetId: 'project-a', name: '', requested: '' });
  });

  it('resets the requested version when the package changes', () => {
    const options = packageOptions(packages);
    const frontend = options.find((option) => option.name === 'frontend')!;
    const tools = options.find((option) => option.name === 'tools')!;
    const draft = createRouteDraft('project-a', options, []);
    const next = selectRoutePackage(
      { ...draft, name: frontend.name, requested: '1.0.0' },
      tools,
    );

    expect(next.name).toBe('tools');
    expect(next.requested).toBe('2.0.0');
  });

  it('updates the requested version without touching the package', () => {
    const draft = createRouteDraft('project-a', packageOptions(packages), []);
    const next = setRouteRequested(draft, 'latest');

    expect(next).toEqual({ ...draft, requested: 'latest' });
    expect(next).not.toBe(draft);
  });

  it('reports missing package, missing version and duplicate assignment', () => {
    const options = packageOptions(packages);
    const draft = createRouteDraft('project-a', options, []);

    expect(routeDraftIssue({ ...draft, name: '' }, [])).toBe(
      'package-missing',
    );
    expect(routeDraftIssue({ ...draft, requested: '  ' }, [])).toBe(
      'requested-missing',
    );
    expect(routeDraftIssue(draft, ['backend'])).toBe('already-assigned');
    expect(routeDraftIssue(draft, ['frontend'])).toBeNull();
  });

  it('builds a trimmed route-add input only when a package is selected', () => {
    const empty = createRouteDraft('project-a', [], []);
    expect(toRouteAddInput(empty)).toBeNull();

    expect(
      toRouteAddInput({
        targetId: 'project-a',
        name: ' frontend ',
        requested: ' latest ',
      }),
    ).toEqual({
      targetId: 'project-a',
      name: 'frontend',
      requested: 'latest',
    });
  });

  it('never exposes the shared empty draft to mutation', () => {
    const draft = createRouteDraft('project-a', [], []);
    draft.name = 'mutated';

    expect(EMPTY_ROUTE_DRAFT.name).toBe('');
    expect(draft).not.toBe(EMPTY_ROUTE_DRAFT);
  });
});
