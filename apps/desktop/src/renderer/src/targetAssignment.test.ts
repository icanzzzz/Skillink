import { describe, expect, it } from 'vitest';
import {
  EMPTY_ASSIGNMENT_DRAFT,
  createRouteAddInput,
  createRouteEnableInput,
  createRouteRemoveInput,
  setAssignmentName,
  setAssignmentVersion,
  toggleAssignmentTarget,
} from './targetAssignment.js';

describe('target assignment helpers', () => {
  it('opens another target and clears the previous input', () => {
    const draft = toggleAssignmentTarget(
      { targetId: 'project-a', name: 'frontend', version: '1.0.0' },
      'project-b',
    );

    expect(draft).toEqual({
      targetId: 'project-b',
      name: '',
      version: '',
    });
  });

  it('closes the active target without carrying input', () => {
    const draft = toggleAssignmentTarget(
      { targetId: 'project-a', name: 'frontend', version: '1.0.0' },
      'project-a',
    );

    expect(draft).toEqual(EMPTY_ASSIGNMENT_DRAFT);
  });

  it('builds a trimmed payload only for the form owning the target', () => {
    const named = setAssignmentName(
      { targetId: 'project-b', name: '', version: '' },
      '  frontend  ',
    );
    const draft = setAssignmentVersion(named, ' 1.0.0 ');

    expect(createRouteAddInput(draft, 'project-b')).toEqual({
      targetId: 'project-b',
      name: 'frontend',
      requested: '1.0.0',
    });
    expect(createRouteAddInput(draft, 'project-a')).toBeNull();
  });

  it('rejects incomplete assignment input', () => {
    expect(
      createRouteAddInput(
        { targetId: 'project-a', name: '  ', version: '1.0.0' },
        'project-a',
      ),
    ).toBeNull();
    expect(
      createRouteAddInput(
        { targetId: 'project-a', name: 'frontend', version: ' ' },
        'project-a',
      ),
    ).toBeNull();
  });

  it('builds package enable and remove payloads for the owning target', () => {
    const lock = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-abc',
      enabled: false,
    };

    expect(createRouteEnableInput('project-a', 'frontend', lock)).toEqual({
      targetId: 'project-a',
      name: 'frontend',
      enabled: true,
    });
    expect(
      createRouteEnableInput('project-a', 'frontend', {
        ...lock,
        enabled: true,
      }),
    ).toEqual({ targetId: 'project-a', name: 'frontend', enabled: false });
    expect(createRouteRemoveInput('project-a', 'frontend')).toEqual({
      targetId: 'project-a',
      name: 'frontend',
    });
  });
});
