import {
  ensureHome as ensureCoreHome,
} from '@skillink/core';
import {
  getSkillinkPaths,
  SkillinkError,
  type SkillinkPaths,
} from '@skillink/shared';
import type { CliContext } from './cli-context.js';
import { withCliMutation } from './mutation.js';

export type CliHomeSource = 'context' | 'env' | 'registry' | null;

export interface CommandRuntime {
  context: CliContext;
  argv: string[];
  jsonMode: boolean;
  home: string | null;
  homeSource: CliHomeSource;
  paths(): SkillinkPaths;
  ensureHome(): Promise<SkillinkPaths>;
  mutate<T>(
    paths: SkillinkPaths,
    commandPath: string,
    action: string,
    summary: string | ((result: T) => string),
    task: () => Promise<T>,
    options?: { skills?: boolean; commit?: boolean },
  ): Promise<T>;
  setExitCode(code: number): void;
}

export interface CommandRuntimeOptions {
  home?: string | null;
  homeSource?: CliHomeSource;
  getResolutionError?: () => unknown;
}

export function createCommandRuntime(
  context: CliContext,
  argv: string[],
  setExitCode: (code: number) => void,
  options: CommandRuntimeOptions = {},
): CommandRuntime {
  const home = options.home ?? context.home ?? null;
  const homeSource =
    options.homeSource ?? (context.home ? 'context' : null);
  const getResolutionError = options.getResolutionError ?? (() => undefined);

  const paths = (): SkillinkPaths => {
    const resolutionError = getResolutionError();
    if (resolutionError) {
      throw resolutionError;
    }
    if (!home) {
      throw new SkillinkError(
        'CONTROL_PLANE_REQUIRED',
        'No control plane is selected. Run "skillink control-plane add <path>" or set SKILLINK_HOME.',
      );
    }
    return getSkillinkPaths(home);
  };

  return {
    context,
    argv,
    jsonMode: context.json ?? argv.includes('--json'),
    home,
    homeSource,
    paths,
    async ensureHome() {
      const current = paths();
      await ensureCoreHome(current);
      return current;
    },
    mutate<T>(
      current: SkillinkPaths,
      commandPath: string,
      action: string,
      summary: string | ((result: T) => string),
      task: () => Promise<T>,
      options: { skills?: boolean; commit?: boolean } = {},
    ): Promise<T> {
      return withCliMutation(
        { paths: current, commandPath, argv, action, summary, ...options },
        task,
      );
    },
    setExitCode,
  };
}
