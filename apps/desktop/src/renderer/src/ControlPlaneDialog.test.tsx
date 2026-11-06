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
});
