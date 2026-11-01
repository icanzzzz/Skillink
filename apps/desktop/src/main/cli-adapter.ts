import { runCli, type CliContext } from '@skillink/cli/run';
import type { CliErrorEnvelope, SnapshotReport } from '@skillink/shared';
import type { RuntimeStatus } from '../shared.js';

export type CliRunner = (
  argv: string[],
  context: CliContext,
) => Promise<number>;

export class CliCommandError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly exitCode: number;

  constructor(input: {
    code: string;
    message: string;
    details?: unknown;
    exitCode: number;
  }) {
    super(input.message);
    this.name = 'CliCommandError';
    this.code = input.code;
    this.details = input.details;
    this.exitCode = input.exitCode;
  }
}

export interface CliAdapter {
  invoke<T>(argv: string[]): Promise<T>;
  snapshot(): Promise<SnapshotReport>;
  runtimeStatus(): Promise<RuntimeStatus>;
}

export function createCliAdapter(runner: CliRunner = runCli): CliAdapter {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function invoke<T>(argv: string[]): Promise<T> {
    const args = argv.includes('--json') ? argv : [...argv, '--json'];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const context: CliContext = {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      json: true,
    };
    const exitCode = await runner(args, context);
    const text = stdout.join('\n').trim();
    const errorText = stderr.join('\n').trim();

    // A structured error on stderr wins over any stdout payload: commands such
    // as `skill add` may have written their success object before a later
    // auto-commit failed.
    if (exitCode !== 0 && errorText) {
      throw errorFromStderr(errorText, exitCode);
    }

    if (text) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new CliCommandError({
          code: 'CLI_OUTPUT_INVALID',
          message: `CLI returned invalid JSON for "${args.join(' ')}".`,
          details: { stdout: text },
          exitCode,
        });
      }
    }

    if (exitCode !== 0) {
      throw errorFromStderr(errorText, exitCode);
    }

    return undefined as T;
  }

  return {
    invoke: (argv) => enqueue(() => invoke(argv)),
    snapshot: () => enqueue(() => invoke<SnapshotReport>(['snapshot'])),
    runtimeStatus: () => enqueue(() => invoke<RuntimeStatus>(['env'])),
  };
}

function errorFromStderr(text: string, exitCode: number): CliCommandError {
  try {
    const parsed = JSON.parse(text) as CliErrorEnvelope;
    if (parsed.ok === false && parsed.error) {
      return new CliCommandError({
        code: parsed.error.code,
        message: parsed.error.message,
        details: parsed.error.details,
        exitCode,
      });
    }
  } catch {
    // Fall through to the plain-text error.
  }

  return new CliCommandError({
    code: 'CLI_ERROR',
    message: text || `CLI exited with code ${exitCode}.`,
    exitCode,
  });
}
