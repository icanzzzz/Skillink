import type {
  RouteAddRequest,
  RouteEnableRequest,
  RouteRemoveRequest,
  TargetEnableRequest,
  TargetModeRequest,
  TargetRemoveRequest,
} from '../../../ipc-schemas.js';
import { defaultRequested, type PackageOption } from '../library.js';

export type RouteAddFormInput = RouteAddRequest;
export type RouteRemoveFormInput = RouteRemoveRequest;
export type RouteEnableFormInput = RouteEnableRequest;
export type TargetEnableFormInput = TargetEnableRequest;
export type TargetModeFormInput = TargetModeRequest;
export type TargetRemoveFormInput = TargetRemoveRequest;

export interface RouteDraft {
  targetId: string | null;
  name: string;
  requested: string;
}

export const EMPTY_ROUTE_DRAFT: RouteDraft = {
  targetId: null,
  name: '',
  requested: '',
};

export type RouteDraftIssue =
  | 'package-missing'
  | 'requested-missing'
  | 'already-assigned';

function isEmptyDraft(targetId: string | null): RouteDraft {
  return { targetId, name: '', requested: '' };
}

/**
 * Starts a draft on the first package this target has not been assigned yet.
 * The requested version is the package's visible default so the picker never
 * opens on a blank version field.
 */
export function createRouteDraft(
  targetId: string,
  options: PackageOption[],
  assigned: readonly string[],
): RouteDraft {
  const available = options.find((option) => !assigned.includes(option.name));
  if (!available) {
    return isEmptyDraft(targetId);
  }

  return {
    targetId,
    name: available.name,
    requested: defaultRequested(available),
  };
}

export function selectRoutePackage(
  draft: RouteDraft,
  option: PackageOption,
): RouteDraft {
  return {
    ...draft,
    name: option.name,
    requested: defaultRequested(option),
  };
}

export function setRouteRequested(
  draft: RouteDraft,
  requested: string,
): RouteDraft {
  return { ...draft, requested };
}

export function routeDraftIssue(
  draft: RouteDraft,
  assigned: readonly string[],
): RouteDraftIssue | null {
  const name = draft.name.trim();
  if (name === '') {
    return 'package-missing';
  }
  if (draft.requested.trim() === '') {
    return 'requested-missing';
  }
  if (assigned.includes(name)) {
    return 'already-assigned';
  }
  return null;
}

export function toRouteAddInput(
  draft: RouteDraft,
): RouteAddFormInput | null {
  if (draft.targetId === null) {
    return null;
  }

  const name = draft.name.trim();
  const requested = draft.requested.trim();
  if (name === '' || requested === '') {
    return null;
  }

  return { targetId: draft.targetId, name, requested };
}
