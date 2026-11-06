import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN_MESSAGES, type ControlPlaneState } from '@skillink/shared';
import { ControlPlaneDialog } from './ControlPlaneDialog.js';
import { renderWithMessages } from './i18n.test-utils.js';

const state: ControlPlaneState = {
  active: 'C:/planes/a',
  activeSource: 'registry',
  controlPlanes: ['C:/planes/a', 'C:/planes/b'],
};

describe('ControlPlaneDialog', () => {
  it('lists every control plane and marks the current one', () => {
    const html = renderWithMessages(
      <ControlPlaneDialog
        open
        state={state}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('C:/planes/a');
    expect(html).toContain('C:/planes/b');
    expect(html).toContain(EN_MESSAGES['controlPlane.current']);
    expect(html).toContain(EN_MESSAGES['controlPlane.add']);
  });

  it('explains the env override and disables switching', () => {
    const html = renderWithMessages(
      <ControlPlaneDialog
        open
        state={{ ...state, active: 'C:/env', activeSource: 'env' }}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain(EN_MESSAGES['controlPlane.envOverride']);
    expect(html).toContain('disabled');
  });

  it('makes non-current rows clickable and leaves active or env rows inert', () => {
    const registryHtml = renderWithMessages(
      <ControlPlaneDialog
        open
        state={state}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    // C:/planes/b is not active, so its row exposes the clickable affordance.
    expect(registryHtml).toContain('role="button"');
    expect(registryHtml).toContain('tabindex="0"');

    // The active control plane alone must not be switchable again.
    const activeOnlyHtml = renderWithMessages(
      <ControlPlaneDialog
        open
        state={{ ...state, controlPlanes: ['C:/planes/a'] }}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    expect(activeOnlyHtml).not.toContain('role="button"');
    expect(activeOnlyHtml).toContain('tabindex="-1"');

    // SKILLINK_HOME fixes the active control plane, so rows stay inert.
    const envHtml = renderWithMessages(
      <ControlPlaneDialog
        open
        state={{ ...state, active: 'C:/env', activeSource: 'env' }}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    expect(envHtml).not.toContain('role="button"');
    expect(envHtml).not.toContain('tabindex="0"');
  });
});
