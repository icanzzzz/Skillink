import { describe, expect, it } from 'vitest';
import {
  assertTrustedSender,
  isTrustedSenderUrl,
} from './sender-policy.js';

const appUrl = 'file:///C:/Skillink/out/renderer/index.html';

describe('isTrustedSenderUrl', () => {
  it('accepts the packaged renderer URL', () => {
    expect(
      isTrustedSenderUrl(appUrl, {
        isPackaged: true,
        appUrl,
      }),
    ).toBe(true);
  });

  it('rejects other file URLs', () => {
    expect(
      isTrustedSenderUrl('file:///C:/Skillink/out/renderer/other.html', {
        isPackaged: true,
        appUrl,
      }),
    ).toBe(false);
  });

  it('rejects remote HTTP URLs in packaged mode', () => {
    expect(
      isTrustedSenderUrl('https://evil.example/', {
        isPackaged: true,
        appUrl,
      }),
    ).toBe(false);
  });

  it('accepts the configured dev server origin', () => {
    const policy = {
      isPackaged: false,
      appUrl,
      devServerUrl: 'http://localhost:5173',
    };

    expect(isTrustedSenderUrl('http://localhost:5173/', policy)).toBe(true);
  });

  it('rejects a different dev server port', () => {
    const policy = {
      isPackaged: false,
      appUrl,
      devServerUrl: 'http://localhost:5173',
    };

    expect(isTrustedSenderUrl('http://localhost:5174/', policy)).toBe(false);
  });

  it('ignores the dev server URL in a packaged app', () => {
    const policy = {
      isPackaged: true,
      appUrl,
      devServerUrl: 'http://localhost:5173',
    };

    expect(isTrustedSenderUrl('http://localhost:5173/', policy)).toBe(false);
  });

  it('rejects opaque dev server URLs', () => {
    const policy = {
      isPackaged: false,
      appUrl,
      devServerUrl: 'file:///C:/tmp/renderer.html',
    };

    expect(
      isTrustedSenderUrl('file:///C:/tmp/renderer.html', policy),
    ).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(
      isTrustedSenderUrl('not a url', {
        isPackaged: true,
        appUrl,
      }),
    ).toBe(false);
  });
});

describe('assertTrustedSender', () => {
  const policy = { isPackaged: true, appUrl };
  const webContents = {};
  const event = {
    sender: webContents,
    senderFrame: { url: appUrl, parent: null },
  };

  it('accepts the main window top frame', () => {
    expect(() =>
      assertTrustedSender(event, { webContents }, policy),
    ).not.toThrow();
  });

  it('rejects a different webContents', () => {
    expect(() =>
      assertTrustedSender(event, { webContents: {} }, policy),
    ).toThrowError(/sender/i);
  });

  it('rejects a subframe', () => {
    expect(() =>
      assertTrustedSender(
        {
          ...event,
          senderFrame: { url: appUrl, parent: {} },
        },
        { webContents },
        policy,
      ),
    ).toThrowError(/sender/i);
  });
});
