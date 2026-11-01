import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Modal,
  isTopmostModal,
  popModal,
  pushModal,
} from './Modal.js';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <Modal open={false} title="Add target" onClose={() => undefined}>
        <p>Body</p>
      </Modal>,
    );

    expect(html).toBe('');
  });

  it('renders a labelled dialog with a title, body, and footer', () => {
    const html = renderToStaticMarkup(
      <Modal
        open
        title="Add target"
        eyebrow="TARGET"
        size="lg"
        onClose={() => undefined}
        footer={<button type="button">Save</button>}
      >
        <p>Body</p>
      </Modal>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Add target');
    expect(html).toContain('TARGET');
    expect(html).toContain('Body');
    expect(html).toContain('Save');
    expect(html).toContain('data-size="lg"');
  });

  it('renders a dismiss control with the provided label', () => {
    const html = renderToStaticMarkup(
      <Modal
        open
        title="Confirm"
        closeLabel="Close dialog"
        onClose={() => undefined}
      >
        <p>Body</p>
      </Modal>,
    );

    expect(html).toContain('aria-label="Close dialog"');
  });

  it('only treats the most recently opened dialog as topmost', () => {
    const parent = Symbol('parent');
    const child = Symbol('child');

    pushModal(parent);
    expect(isTopmostModal(parent)).toBe(true);

    pushModal(child);
    expect(isTopmostModal(child)).toBe(true);
    expect(isTopmostModal(parent)).toBe(false);

    popModal(child);
    expect(isTopmostModal(parent)).toBe(true);

    popModal(parent);
    expect(isTopmostModal(parent)).toBe(false);
  });
});
