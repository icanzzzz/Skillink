import { rm } from 'node:fs/promises';
import {
  SkillFileSchema,
  SkillinkError,
  getSkillDir,
  type ApplyReport,
  type SkillFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { apply } from './apply.js';
import {
  gitCheckoutPaths,
  gitFileExistsAt,
  gitHead,
  gitPathHistory,
  gitRepoExists,
  gitResolveCommit,
  gitShowJson,
  ensureControlRepo,
  ensureSkillsRepo,
} from './git.js';
import {
  assertCleanControlRepo,
  buildCommitMessage,
  commitRepoChanges,
} from './git-commit.js';
import { withHomeLock, type HomeLockOptions } from './git-lock.js';
import { readRouteFile } from './route.js';
import {
  assertSkillContent,
  readSkillFile,
  removeEmptySkillParent,
} from './skill-store.js';
import { removeTarget } from './target.js';

const CONFIG_FILES = ['route.json', 'package.json', 'skill.json'] as const;

export interface SkillRef {
  name: string;
  version: string;
}

export interface PlannedSkillRestore extends SkillRef {
  /** skills-repository commit that still contains this version */
  commit: string;
}

export interface SkillsRestorePlan {
  restores: PlannedSkillRestore[];
  /** versions that cannot be found in the skills repository */
  missing: SkillRef[];
}

export interface RollbackInput {
  paths: SkillinkPaths;
  revision: string;
  /** Set false to restore configuration without re-projecting targets. */
  apply?: boolean;
  /** Override lock timing for tests or long operations. */
  lockOptions?: HomeLockOptions;
}

export interface RollbackResult {
  /** resolved target commit */
  revision: string;
  /** rollback commit hash, or undefined when the control plane was unchanged */
  commit?: string;
  removedTargets: string[];
  restoredSkills: PlannedSkillRestore[];
  /** skill versions removed because the restored catalog does not reference them */
  removedSkills: SkillRef[];
  apply?: ApplyReport;
}

/**
 * List skill versions required by a skill.json whose content is missing on
 * disk. Missing means the version directory or its SKILL.md is absent.
 */
export async function planMissingSkillContent(
  paths: SkillinkPaths,
  skillFile: SkillFile,
): Promise<SkillRef[]> {
  const missing: SkillRef[] = [];

  for (const [name, entry] of Object.entries(skillFile.skills)) {
    for (const version of Object.keys(entry.versions)) {
      try {
        await assertSkillContent(paths, name, version);
      } catch (error) {
        if (
          error instanceof SkillinkError &&
          (error.code === 'VERSION_NOT_FOUND' ||
            error.code === 'SKILL_MD_MISSING')
        ) {
          missing.push({ name, version });
          continue;
        }
        throw error;
      }
    }
  }

  return missing.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName !== 0 ? byName : left.version.localeCompare(right.version);
  });
}

/**
 * Find the newest skills-repository commit that still contains each missing
 * skill version. Versions with no history are reported as missing.
 */
export async function planSkillsGitRestores(
  paths: SkillinkPaths,
  missing: SkillRef[],
): Promise<SkillsRestorePlan> {
  if (!(await gitRepoExists(paths, 'skills'))) {
    return { restores: [], missing: [...missing] };
  }

  const restores: PlannedSkillRestore[] = [];
  const unavailable: SkillRef[] = [];

  for (const skill of missing) {
    const commit = await gitPathHistory(
      paths,
      'skills',
      `${skill.name}/${skill.version}`,
    );

    if (commit) {
      restores.push({ ...skill, commit });
    } else {
      unavailable.push(skill);
    }
  }

  return { restores, missing: unavailable };
}

/**
 * Restore skill version directories from the skills repository and verify
 * that each one still has SKILL.md.
 */
export async function restoreSkillContentFromGit(
  paths: SkillinkPaths,
  restores: PlannedSkillRestore[],
): Promise<void> {
  for (const restore of restores) {
    const directory = getSkillDir(paths, restore.name, restore.version);
    await rm(directory, { recursive: true, force: true });
    await gitCheckoutPaths(paths, 'skills', restore.commit, [
      `${restore.name}/${restore.version}`,
    ]);

    try {
      await assertSkillContent(paths, restore.name, restore.version);
    } catch (error) {
      throw new SkillinkError(
        'SKILL_CONTENT_NOT_IN_GIT',
        `Restored skill content is incomplete: ${restore.name}@${restore.version}`,
        { ...restore },
        { cause: error },
      );
    }
  }
}

async function restoreControlFiles(
  paths: SkillinkPaths,
  revision: string,
): Promise<void> {
  await gitCheckoutPaths(paths, 'control', revision, [...CONFIG_FILES]);
}

function skillVersions(file: SkillFile): SkillRef[] {
  return Object.entries(file.skills)
    .flatMap(([name, entry]) =>
      Object.keys(entry.versions).map((version) => ({ name, version })),
    )
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      return byName !== 0 ? byName : left.version.localeCompare(right.version);
    });
}

/**
 * Versions present in the current catalog but absent from the restored one.
 * Only catalogued versions are removed; unknown directories are left alone.
 */
export function listExtraSkillVersions(
  current: SkillFile,
  target: SkillFile,
): SkillRef[] {
  const targetKeys = new Set(
    skillVersions(target).map((skill) => `${skill.name}@${skill.version}`),
  );

  return skillVersions(current).filter(
    (skill) => !targetKeys.has(`${skill.name}@${skill.version}`),
  );
}

async function removeSkillVersions(
  paths: SkillinkPaths,
  skills: SkillRef[],
): Promise<void> {
  for (const skill of skills) {
    await rm(getSkillDir(paths, skill.name, skill.version), {
      recursive: true,
      force: true,
    });
    await removeEmptySkillParent(paths, skill.name);
  }
}

/**
 * Roll the control plane back to a commit:
 * remove every current target projection, restore route/package/skill, restore
 * any missing skill content, re-apply, and commit once.
 *
 * The home lock and the clean-worktree check are enforced here so in-process
 * callers (GUI, tests, future APIs) cannot fold unrelated dirty files into the
 * rollback commit.
 */
export async function rollbackTo(
  input: RollbackInput,
): Promise<RollbackResult> {
  return withHomeLock(
    input.paths,
    () => rollbackToLocked(input),
    input.lockOptions,
  );
}

async function rollbackToLocked(
  input: RollbackInput,
): Promise<RollbackResult> {
  const hadControlRepo = await gitRepoExists(input.paths, 'control');
  const startHead = hadControlRepo
    ? await gitHead(input.paths, 'control')
    : undefined;

  if (!startHead) {
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      'The control plane has no commits to roll back from.',
      { home: input.paths.home },
    );
  }

  await assertCleanControlRepo(input.paths);

  await ensureControlRepo(input.paths);
  await ensureSkillsRepo(input.paths);

  const targetCommit = await gitResolveCommit(
    input.paths,
    'control',
    input.revision,
  );

  for (const file of CONFIG_FILES) {
    if (
      !(await gitFileExistsAt(input.paths, 'control', targetCommit, file))
    ) {
      throw new SkillinkError(
        'HISTORY_NOT_FOUND',
        `Commit ${targetCommit.slice(0, 7)} does not contain ${file}.`,
        { revision: targetCommit, file },
      );
    }
  }

  const targetSkillFile = SkillFileSchema.parse(
    await gitShowJson(input.paths, 'control', targetCommit, 'skill.json'),
  );
  const currentSkillFile = await readSkillFile(input.paths);
  const extraSkills = listExtraSkillVersions(currentSkillFile, targetSkillFile);
  const missing = await planMissingSkillContent(input.paths, targetSkillFile);
  const restorable = await planSkillsGitRestores(input.paths, missing);

  if (restorable.missing.length > 0) {
    throw new SkillinkError(
      'SKILL_CONTENT_NOT_IN_GIT',
      'Cannot restore skill content from the skills repository.',
      {
        missing: restorable.missing,
        revision: targetCommit,
      },
    );
  }

  const removedTargets: string[] = [];
  let applyReport: ApplyReport | undefined;

  try {
    const route = await readRouteFile(input.paths);
    for (const target of [...route.targets]) {
      await removeTarget({ paths: input.paths, id: target.id });
      removedTargets.push(target.id);
    }

    await restoreControlFiles(input.paths, targetCommit);
    await restoreSkillContentFromGit(input.paths, restorable.restores);
    await removeSkillVersions(input.paths, extraSkills);

    if (input.apply !== false) {
      applyReport = await apply({ paths: input.paths });
    }
  } catch (error) {
    try {
      await restoreControlFiles(input.paths, startHead);
    } catch (restoreError) {
      throw new SkillinkError(
        'GIT_RESTORE_FAILED',
        'Rollback failed and the control plane could not be restored.',
        {
          startHead,
          targetRevision: targetCommit,
          originalError:
            error instanceof Error ? error.message : String(error),
        },
        { cause: restoreError },
      );
    }

    throw error;
  }

  const shortRevision = targetCommit.slice(0, 7);
  const rollbackCommand =
    `skillink rollback ${input.revision}` +
    (input.apply === false ? ' --no-apply' : '');

  if (restorable.restores.length > 0 || extraSkills.length > 0) {
    await commitRepoChanges({
      paths: input.paths,
      repo: 'skills',
      buildMessage: (changedFiles) =>
        buildCommitMessage({
          scope: 'skills',
          action: 'restore',
          summary: shortRevision,
          command: rollbackCommand,
          changedFiles,
        }),
    });
  }

  const commit = await commitRepoChanges({
    paths: input.paths,
    repo: 'control',
    buildMessage: (changedFiles) =>
      buildCommitMessage({
        scope: 'rollback',
        action: 'restore',
        summary: shortRevision,
        command: rollbackCommand,
        changedFiles,
      }),
  });

  return {
    revision: targetCommit,
    commit,
    removedTargets,
    restoredSkills: restorable.restores,
    removedSkills: extraSkills,
    apply: applyReport,
  };
}
