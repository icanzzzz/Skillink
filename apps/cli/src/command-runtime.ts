import {
  ensureHome as ensureCoreHome,
} from '@skillink/core';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import type { CliContext } from './cli-context.js';
import { withCliMutation } from './mutation.js';

export interface CommandRuntime {
  context: CliContext;
  argv: string[];
  jsonMode: boolean;
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

export function createCommandRuntime(
  context: CliContext,
  argv: string[],
  setExitCode: (code: number) => void,
): CommandRuntime {
  const paths = (): SkillinkPaths => getSkillinkPaths(context.home);

  return {
    context,
    argv,
    jsonMode: context.json ?? argv.includes('--json'),
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
