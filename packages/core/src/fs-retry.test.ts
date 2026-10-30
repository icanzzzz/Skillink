import { describe, expect, it } from 'vitest';
import { withFsRetry } from './fs-retry.js';

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

describe('withFsRetry', () => {
  it('retries transient filesystem errors', async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withFsRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw nodeError('EBUSY');
        }
        return 'ok';
      },
      {
        retries: 5,
        baseDelayMs: 10,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it('throws the last error after exhausting retries', async () => {
    let attempts = 0;

    await expect(
      withFsRetry(
        async () => {
          attempts += 1;
          throw nodeError('EPERM');
        },
        { retries: 2, baseDelayMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(attempts).toBe(3);
  });

  it('does not retry non-transient errors', async () => {
    let attempts = 0;

    await expect(
      withFsRetry(
        async () => {
          attempts += 1;
          throw nodeError('ENOENT');
        },
        { retries: 5, baseDelayMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(attempts).toBe(1);
  });
});
