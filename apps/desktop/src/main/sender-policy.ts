import { SkillinkError } from '@skillink/shared';

export interface SenderPolicy {
  isPackaged: boolean;
  appUrl: string;
  devServerUrl?: string;
}

export interface SenderFrameLike {
  url: string;
  parent: unknown;
}

export interface SenderEventLike {
  sender: unknown;
  senderFrame: SenderFrameLike | null;
}

export interface SenderWindowLike {
  webContents: unknown;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function isTrustedSenderUrl(
  url: string,
  policy: SenderPolicy,
): boolean {
  const candidate = parseUrl(url);
  if (!candidate) {
    return false;
  }

  if (!policy.isPackaged && policy.devServerUrl) {
    const devServer = parseUrl(policy.devServerUrl);
    if (
      devServer &&
      (devServer.protocol === 'http:' || devServer.protocol === 'https:') &&
      candidate.origin === devServer.origin
    ) {
      return true;
    }
  }

  const app = parseUrl(policy.appUrl);
  if (!app || candidate.protocol !== 'file:' || app.protocol !== 'file:') {
    return false;
  }

  return candidate.href.split('#')[0] === app.href.split('#')[0];
}

export function assertTrustedSender(
  event: SenderEventLike,
  window: SenderWindowLike | null,
  policy: SenderPolicy,
): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    !event.senderFrame ||
    event.senderFrame.parent !== null ||
    !isTrustedSenderUrl(event.senderFrame.url, policy)
  ) {
    throw new SkillinkError(
      'IPC_FORBIDDEN',
      'IPC request was rejected because its sender is not trusted.',
    );
  }
}
