import { describe, expect, it } from 'vitest';
import { isDevToolsShortcut } from './devtools.js';

function input(
  overrides: Partial<Parameters<typeof isDevToolsShortcut>[0]> = {},
): Parameters<typeof isDevToolsShortcut>[0] {
  return {
    type: 'keyDown',
    key: 'F12',
    control: false,
    shift: false,
    alt: false,
    meta: false,
    ...overrides,
  };
}

describe('isDevToolsShortcut', () => {
  it('accepts F12 on every platform', () => {
    expect(isDevToolsShortcut(input(), 'win32')).toBe(true);
    expect(isDevToolsShortcut(input(), 'darwin')).toBe(true);
  });

  it('accepts Ctrl+Shift+I on Windows and Linux', () => {
    const shortcut = input({ key: 'i', control: true, shift: true });

    expect(isDevToolsShortcut(shortcut, 'win32')).toBe(true);
    expect(isDevToolsShortcut(shortcut, 'linux')).toBe(true);
  });

  it('accepts Cmd+Option+I on macOS', () => {
    expect(
      isDevToolsShortcut(
        input({ key: 'I', alt: true, meta: true }),
        'darwin',
      ),
    ).toBe(true);
  });

  it('ignores key-up events and incomplete modifiers', () => {
    expect(isDevToolsShortcut(input({ type: 'keyUp' }), 'win32')).toBe(false);
    expect(
      isDevToolsShortcut(input({ key: 'i', control: true }), 'win32'),
    ).toBe(false);
    expect(
      isDevToolsShortcut(input({ key: 'i', shift: true }), 'win32'),
    ).toBe(false);
    expect(isDevToolsShortcut(input({ key: 'F11' }), 'win32')).toBe(false);
  });

  it('does not use the Windows shortcut on macOS', () => {
    expect(
      isDevToolsShortcut(
        input({ key: 'i', control: true, shift: true }),
        'darwin',
      ),
    ).toBe(false);
  });
});
