import type { ControlPlaneState } from '@skillink/shared';
import type { DesktopApi, DesktopSnapshot } from '../../shared.js';

export interface WorkspaceLoad {
  controlPlanes: ControlPlaneState;
  snapshot: DesktopSnapshot | null;
  error: string | null;
}

export async function loadWorkspace(
  api: Pick<DesktopApi, 'getControlPlanes' | 'getSnapshot'>,
): Promise<WorkspaceLoad> {
  const controlPlanes = await api.getControlPlanes();

  if (!controlPlanes.active) {
    return { controlPlanes, snapshot: null, error: null };
  }

  try {
    const snapshot = await api.getSnapshot();
    return { controlPlanes, snapshot, error: null };
  } catch (cause) {
    return {
      controlPlanes,
      snapshot: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
