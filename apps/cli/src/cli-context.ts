import type { Command } from 'commander';

export interface CliContext {
  home?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
}

export function printJson(context: CliContext, value: unknown): void {
  context.stdout(JSON.stringify(value, null, 2));
}

export function printJsonError(
  context: CliContext,
  code: string,
  message: string,
  details?: unknown,
): void {
  context.stderr(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    }),
  );
}

export function addCommonOptions(command: Command): Command {
  return command.option('--json', 'Print machine-readable JSON');
}
