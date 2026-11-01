import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UiProvider, useConfirm, useToast } from './Feedback.js';

function Probe() {
  const toast = useToast();
  const confirm = useConfirm();

  return (
    <span>
      {typeof toast.pushToast}/{typeof confirm}
    </span>
  );
}

describe('UiProvider', () => {
  it('renders children and an empty polite live region', () => {
    const html = renderToStaticMarkup(
      <UiProvider>
        <p>App body</p>
      </UiProvider>,
    );

    expect(html).toContain('App body');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('toast-message');
  });

  it('exposes no-op feedback hooks without a provider', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('function/function');
  });
});
