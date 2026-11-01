import { isNodeError } from './node-error.js';

export interface FsRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  retryCodes?: string[];
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_RETRY_CODES = ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'];

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function withFsRetry<T>(
  action: () => Promise<T>,
  options: FsRetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const retryCodes = new Set(options.retryCodes ?? DEFAULT_RETRY_CODES);
  const wait = options.sleep ?? sleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const code = isNodeError(error) ? error.code : undefined;
      if (
        attempt >= retries ||
        code === undefined ||
        !retryCodes.has(code)
      ) {
        throw error;
      }

      await wait(baseDelayMs * 2 ** attempt);
    }
  }
}
