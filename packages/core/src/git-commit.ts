import path from 'node:path';
import { SkillinkError, type SkillinkPaths } from '@skillink/shared';
import {
  CONTROL_TRACKED_PATHS,
  ensureControlRepo,
  ensureSkillsRepo,
  gitAddAll,
  gitCommit,
  gitHead,
  gitRepoExists,
  gitStagedFiles,
  gitStatus,
  gitTrackedFiles,
  type GitRepo,
} from './git.js';
import { ensureControlFiles, pathExists } from './initialize.js';

const MAX_SUBJECT_LENGTH = 72;
const MAX_CHANGED_FILES = 20;

export interface BuildCommitMessageInput {
  scope: string;
  action: string;
  summary?: string;
  command?: string;
  changedFiles: string[];
}

function truncateList(files: string[], max = MAX_CHANGED_FILES): string[] {
  if (files.length <= max) {
    return files;
  }

  return [
    ...files.slice(0, max),
    `... and ${files.length - max} more`,
  ];
}

function truncateSubject(subject: string): string {
  if (subject.length <= MAX_SUBJECT_LENGTH) {
    return subject;
  }

  return `${subject.slice(0, MAX_SUBJECT_LENGTH - 3)}...`;
}

export function buildCommitMessage(input: BuildCommitMessageInput): string {
  const summary = input.summary?.trim() ?? '';
  const subject = truncateSubject(
    [`skillink(${input.scope}):`, input.action, summary].filter(Boolean).join(' '),
  );
  const visible = truncateList(input.changedFiles);

  const body = [
    ...(input.command ? [`Command: ${input.command}`, ''] : []),
    'Changed:',
    ...visible.map((file) => `- ${file}`),
  ];

  return `${subject}\n\n${body.join('\n')}`;
}

export interface RepoCommitOptions {
  paths: SkillinkPaths;
  repo: GitRepo;
  message?: string;
  buildMessage?: (changedFiles: string[]) => string;
  pathspec?: string[];
}

/**
 * Stage and commit everything in one repository. Returns the commit hash, or
 * undefined when the repository is absent or has no changes.
 */
export async function commitRepoChanges(
  options: RepoCommitOptions,
): Promise<string | undefined> {
  if (options.message === undefined && options.buildMessage === undefined) {
    throw new SkillinkError(
      'IO_ERROR',
      'commitRepoChanges requires a message or buildMessage.',
      { repo: options.repo },
    );
  }

  if (!(await gitRepoExists(options.paths, options.repo))) {
    return undefined;
  }

  const pathspec =
    options.pathspec ??
    (options.repo === 'control' ? await controlPathspec(options.paths) : []);

  if ((await gitStatus(options.paths, options.repo, pathspec)).length === 0) {
    return undefined;
  }

  await gitAddAll(options.paths, options.repo, pathspec);
  const changedFiles = await gitStagedFiles(
    options.paths,
    options.repo,
    pathspec,
  );

  if (changedFiles.length === 0) {
    return undefined;
  }

  const message =
    options.message ??
    (options.buildMessage
      ? options.buildMessage(changedFiles)
      : undefined);

  return gitCommit(options.paths, options.repo, message!, {
    files: changedFiles,
  });
}

export async function assertCleanControlRepo(
  paths: SkillinkPaths,
): Promise<void> {
  const status = await gitStatus(
    paths,
    'control',
    await controlPathspec(paths),
  );

  if (status.length > 0) {
    const files = status.join(', ');
    throw new SkillinkError(
      'GIT_DIRTY',
      `The control plane has uncommitted changes in ${paths.home}: ${files}. ` +
        `Commit or restore them first: git -C "${paths.home}" status.`,
      {
        home: paths.home,
        files: status,
        hint: `git -C "${paths.home}" status`,
      },
    );
  }
}

function isManagedControlFile(file: string): boolean {
  return CONTROL_TRACKED_PATHS.some(
    (managed) => file === managed || file.startsWith(`${managed}/`),
  );
}

/**
 * Pathspec for control-repo operations: existing managed paths plus managed
 * paths already tracked (so deletions are staged). Nonexistent paths are
 * omitted because `git add` rejects unmatched pathspecs.
 */
export async function controlPathspec(
  paths: SkillinkPaths,
): Promise<string[]> {
  const result = new Set<string>();

  for (const managed of CONTROL_TRACKED_PATHS) {
    if (await pathExists(path.join(paths.home, managed))) {
      result.add(managed);
    }
  }

  for (const file of await gitTrackedFiles(paths, 'control')) {
    if (isManagedControlFile(file)) {
      result.add(file);
    }
  }

  return [...result].sort();
}

/**
 * Ensure both repositories exist and have a baseline commit. Existing dirty
 * control-plane changes are rejected instead of being folded into a command.
 */
export async function ensureCleanOrBootstrap(
  paths: SkillinkPaths,
): Promise<void> {
  const hadControlRepo = await gitRepoExists(paths, 'control');
  const controlHead = hadControlRepo
    ? await gitHead(paths, 'control')
    : undefined;

  if (controlHead) {
    await assertCleanControlRepo(paths);
  }

  await ensureControlRepo(paths);
  await ensureSkillsRepo(paths);

  const hasV1Data = await pathExists(paths.skillsFile);
  if (!hasV1Data) {
    await ensureControlFiles(paths);
  }

  // A v1 home has no v2 config yet; let the migrate command produce the first
  // complete commit instead of recording a half-empty baseline.
  if (!hasV1Data || controlHead) {
    await commitRepoChanges({
      paths,
      repo: 'control',
      buildMessage: (changedFiles) =>
        buildCommitMessage({
          scope: 'init',
          action: 'initialize',
          summary: 'control plane',
          changedFiles,
        }),
    });
  }

  if (!(await gitHead(paths, 'skills'))) {
    await commitRepoChanges({
      paths,
      repo: 'skills',
      buildMessage: (changedFiles) =>
        buildCommitMessage({
          scope: 'skills',
          action: 'initialize',
          summary: 'skills',
          changedFiles,
        }),
    });
  }
}
