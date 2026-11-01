import type { PackageLock } from '@skillink/shared';

export interface RouteAddFormInput {
  targetId: string;
  name: string;
  requested: string;
}

export interface RouteRemoveFormInput {
  targetId: string;
  name: string;
}

export interface RouteEnableFormInput {
  targetId: string;
  name: string;
  enabled: boolean;
}

export interface AssignmentDraft {
  targetId: string | null;
  name: string;
  version: string;
}

export const EMPTY_ASSIGNMENT_DRAFT: AssignmentDraft = {
  targetId: null,
  name: '',
  version: '',
};

export function toggleAssignmentTarget(
  draft: AssignmentDraft,
  targetId: string,
): AssignmentDraft {
  if (draft.targetId === targetId) {
    return EMPTY_ASSIGNMENT_DRAFT;
  }

  return { targetId, name: '', version: '' };
}

export function setAssignmentName(
  draft: AssignmentDraft,
  name: string,
): AssignmentDraft {
  return { ...draft, name };
}

export function setAssignmentVersion(
  draft: AssignmentDraft,
  version: string,
): AssignmentDraft {
  return { ...draft, version };
}

export function createRouteAddInput(
  draft: AssignmentDraft,
  targetId: string,
): RouteAddFormInput | null {
  if (draft.targetId !== targetId) {
    return null;
  }

  const name = draft.name.trim();
  const requested = draft.version.trim();
  if (name === '' || requested === '') {
    return null;
  }

  return { targetId, name, requested };
}

export function createRouteEnableInput(
  targetId: string,
  name: string,
  lock: PackageLock,
): RouteEnableFormInput {
  return { targetId, name, enabled: lock.enabled === false };
}

export function createRouteRemoveInput(
  targetId: string,
  name: string,
): RouteRemoveFormInput {
  return { targetId, name };
}
