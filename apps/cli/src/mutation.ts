import type { SkillinkPaths } from '@skillink/shared';
import {
  commitRepoChanges,
  ensureCleanOrBootstrap,
  withHomeLock,
  type HomeLockOptions,
} from '@skillink/core';
import { buildCliCommitMessage } from './commit-message.js';

export interface CliMutationOptions<T> {
  paths: SkillinkPaths;
  commandPath: string;
  argv: string[];
  action?: string;
  summary: string | ((result: T) => string);
  /** Commit the skills repository too. Defaults to false. */
  skills?: boolean;
  /** Set false for lock-only mutations such as apply. Defaults to true. */
  commit?: boolean;
  lockOptions?: HomeLockOptions;
}

/**
 * Run one CLI mutation under the home lock, then auto-commit the skills
 * repository (when requested) before the control plane.
 */
export async function withCliMutation<T>(
  options: CliMutationOptions<T>,
  task: () => Promise<T>,
): Promise<T> {
  return withHomeLock(
    options.paths,
    async () => {
      if (options.commit === false) {
        return task();
      }

      await ensureCleanOrBootstrap(options.paths);

      const result = await task();
      const summary =
        typeof options.summary === 'function'
          ? options.summary(result)
          : options.summary;

      if (options.skills) {
        await commitRepoChanges({
          paths: options.paths,
          repo: 'skills',
          buildMessage: (changedFiles) =>
            buildCliCommitMessage({
              repo: 'skills',
              commandPath: options.commandPath,
              argv: options.argv,
              action: options.action,
              summary,
              changedFiles,
            }),
        });
      }

      await commitRepoChanges({
        paths: options.paths,
        repo: 'control',
        buildMessage: (changedFiles) =>
          buildCliCommitMessage({
            repo: 'control',
            commandPath: options.commandPath,
            argv: options.argv,
            action: options.action,
            summary,
            changedFiles,
          }),
      });

      return result;
    },
    options.lockOptions,
  );
}
