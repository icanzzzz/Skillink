import { stat } from 'node:fs/promises';
import { SkillinkError, type SkillinkPaths } from '@skillink/shared';
import {
  assertCleanControlRepo,
  commitRepoChanges,
  ensureControlRepo,
  ensureDirectories,
  ensureHome,
  ensureSkillsRepo,
  gitHead,
  gitRepoExists,
  isGitAvailable,
  migrateV1ToV2,
  withHomeLock,
  writeInitialSettings,
} from '@skillink/core';
import { buildCliCommitMessage } from './commit-message.js';

export interface InitializeHomeResult {
  migrated: boolean;
  skillCount: number;
  packageCount: number;
  targetCount: number;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

export async function initializeHome(
  paths: SkillinkPaths,
  argv: string[],
): Promise<InitializeHomeResult> {
  return withHomeLock(paths, async () => {
    if (!(await isGitAvailable())) {
      throw new SkillinkError(
        'GIT_UNAVAILABLE',
        'Initializing the control plane requires git on PATH.',
        { home: paths.home },
      );
    }

    await ensureDirectories(paths);

    const hadControlRepo = await gitRepoExists(paths, 'control');
    if (hadControlRepo && (await gitHead(paths, 'control'))) {
      await assertCleanControlRepo(paths);
    }

    await writeInitialSettings(paths);

    let migration: InitializeHomeResult = {
      migrated: false,
      skillCount: 0,
      packageCount: 0,
      targetCount: 0,
    };

    if (
      (await pathExists(paths.skillsFile)) &&
      !(await pathExists(paths.skillFile))
    ) {
      migration = await migrateV1ToV2(paths);
    } else {
      await ensureHome(paths);
    }

    await ensureControlRepo(paths);
    await ensureSkillsRepo(paths);
    await commitRepoChanges({
      paths,
      repo: 'control',
      buildMessage: (changedFiles) =>
        buildCliCommitMessage({
          repo: 'control',
          commandPath: 'init',
          argv,
          action: 'initialize',
          summary: 'control plane',
          changedFiles,
        }),
    });
    await commitRepoChanges({
      paths,
      repo: 'skills',
      buildMessage: (changedFiles) =>
        buildCliCommitMessage({
          repo: 'skills',
          commandPath: 'init',
          argv,
          action: 'initialize',
          summary: 'skills',
          changedFiles,
        }),
    });

    return migration;
  });
}
