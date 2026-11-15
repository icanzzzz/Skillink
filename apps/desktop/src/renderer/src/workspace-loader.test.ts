import { describe, expect, it, vi } from 'vitest';
import type { ControlPlaneState } from '@skillink/shared';
import type { DesktopSnapshot } from '../../shared.js';
import { loadWorkspace } from './workspace-loader.js';

const activeState: ControlPlaneState = {
  active: 'C:/planes/a',
  activeSource: 'registry',
  controlPlanes: ['C:/planes/a'],
};

const emptyState: ControlPlaneState = {
  active: null,
  activeSource: null,
  controlPlanes: [],
};

describe('loadWorkspace', () => {
  it('returns no snapshot and skips getSnapshot when there is no active control plane', async () => {
    const getSnapshot = vi.fn();
    const result = await loadWorkspace({
      getControlPlanes: async () => emptyState,
      getSnapshot,
    });

    expect(result).toEqual({
      controlPlanes: emptyState,
      snapshot: null,
      error: null,
    });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('returns the snapshot when an active control plane loads successfully', async () => {
    const snapshot = { marker: 'snapshot' } as unknown as DesktopSnapshot;
    const result = await loadWorkspace({
      getControlPlanes: async () => activeState,
      getSnapshot: async () => snapshot,
    });

    expect(result).toEqual({
      controlPlanes: activeState,
      snapshot,
      error: null,
    });
  });

  it('returns a null snapshot and the error message when the snapshot fails', async () => {
    const result = await loadWorkspace({
      getControlPlanes: async () => activeState,
      getSnapshot: async () => {
        throw new Error('snapshot exploded');
      },
    });

    expect(result).toEqual({
      controlPlanes: activeState,
      snapshot: null,
      error: 'snapshot exploded',
    });
  });
});
