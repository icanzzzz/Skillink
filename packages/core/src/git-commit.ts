import { mkdir, stat } from 'node:fs/promises';
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
import { withHomeLock, type HomeLockOptions } from './git-lock.js';
import {
  readPackageFile,
  writePackageFile,
} from './package-store.js';
import {
  readRouteFile,
  writeRouteFile,
} from './route.js';
import {
  readSkillFile,
  writeSkillFile,
} from './skill-store.js';

const MAX_SUBJECT_LENGTH = 72;
const MAX_CHANGED_FILES = 20;

const COMMAND_SCOPES = new Set([
  'init',
  'migrate',
  'skill',
  'package',
  'target',
  'route',
  'gc',
  'locale',
  'rollback',
  'apply',
]);

export interface CommitMessageInput {
  commandPath: string;
  argv: string[];
  action?: string;
  summary?: string;
  changedFiles: string[];
  scope?: string;
}

function commandToken(commandPath: string): string {
  return commandPath.trim().split(/\s+/)[0] ?? '';
}

function fileScope(file: string): string | undefined {
  const normalized = file.replace(/\\/g, '/');

  if (normalized === 'route.json') {
    return 'route';
  }
  if (normalized === 'package.json') {
    return 'package';
  }
  if (normalized === 'skill.json') {
    return 'skill';
  }
  if (normalized.startsWith('locales/')) {
    return 'locale';
  }
  if (normalized.startsWith('skills/')) {
    return 'skills';
  }

  return undefined;
}

export function inferScope(
  commandPath: string,
  changedFiles: string[],
): string {
  const command = commandToken(commandPath);
  if (COMMAND_SCOPES.has(command)) {
    return command;
  }

  const scopes = new Set<string>();
  for (const file of changedFiles) {
    const scope = fileScope(file);
    if (scope) {
      scopes.add(scope);
    }
  }

  if (scopes.size === 1) {
    return [...scopes][0]!;
  }

  return 'config';
}

export function truncateList(files: string[], max = MAX_CHANGED_FILES): string[] {
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

function buildCommitMessage(repo: GitRepo, input: CommitMessageInput): string {
  const scope =
    repo === 'skills'
      ? 'skills'
      : (input.scope ?? inferScope(input.commandPath, input.changedFiles));
  const action =
    input.action ??
    (commandToken(input.commandPath) === ''
      ? 'update'
      : input.commandPath.trim().split(/\s+/).at(-1)!);
  const summary = input.summary?.trim() ?? '';
  const subject = truncateSubject(
    [`skillink(${scope}):`, action, summary].filter(Boolean).join(' '),
  );
  const command = ['skillink', ...input.argv].join(' ');
  const visible = truncateList(input.changedFiles);

  const body = [
    `Command: ${command}`,
    '',
    'Changed:',
    ...visible.map((file) => `- ${file}`),
  ];

  return `${subject}\n\n${body.join('\n')}`;
}

export function buildControlCommitMessage(input: CommitMessageInput): string {
  return buildCommitMessage('control', input);
}

export function buildSkillsCommitMessage(input: CommitMessageInput): string {
  return buildCommitMessage('skills', input);
}

export interface RepoCommitOptions {
  paths: SkillinkPaths;
  repo: GitRepo;
  commandPath: string;
  argv: string[];
  action?: string;
  summary?: string;
  scope?: string;
  message?: string;
}

/**
 * Stage and commit everything in one repository. Returns the commit hash, or
 * undefined when the repository is absent or has no changes.
 */
export async function commitRepoChanges(
  options: RepoCommitOptions,
): Promise<string | undefined> {
  if (!(await gitRepoExists(options.paths, options.repo))) {
    return undefined;
  }

  const pathspec =
    options.repo === 'control' ? await controlPathspec(options.paths) : [];

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
    (options.repo === 'skills'
      ? buildSkillsCommitMessage({ ...options, changedFiles })
      : buildControlCommitMessage({ ...options, changedFiles }));

  return gitCommit(options.paths, options.repo, message, {
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

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
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
 * Create the three control-plane config files if they are missing. Used before
 * a bootstrap commit so the first history entry is a complete control plane.
 */
export async function ensureControlFiles(
  paths: SkillinkPaths,
): Promise<void> {
  await mkdir(paths.localesDir, { recursive: true });
  if (!(await pathExists(paths.routeFile))) {
    await writeRouteFile(paths, await readRouteFile(paths));
  }
  if (!(await pathExists(paths.packageFile))) {
    await writePackageFile(paths, await readPackageFile(paths));
  }
  if (!(await pathExists(paths.skillFile))) {
    await writeSkillFile(paths, await readSkillFile(paths));
  }
}

/**
 * Ensure both repositories exist and have a baseline commit. Existing dirty
 * control-plane changes are rejected instead of being folded into a command.
 */
export async function ensureCleanOrBootstrap(
  paths: SkillinkPaths,
  argv: string[],
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
      commandPath: 'init',
      argv,
      action: 'initialize',
      summary: 'control plane',
      scope: 'init',
    });
  }

  if (!(await gitHead(paths, 'skills'))) {
    await commitRepoChanges({
      paths,
      repo: 'skills',
      commandPath: 'init',
      argv,
      action: 'initialize',
      summary: 'skills',
      scope: 'skills',
    });
  }
}

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

      await ensureCleanOrBootstrap(options.paths, options.argv);

      const result = await task();
      const summary =
        typeof options.summary === 'function'
          ? options.summary(result)
          : options.summary;

      if (options.skills) {
        await commitRepoChanges({
          paths: options.paths,
          repo: 'skills',
          commandPath: options.commandPath,
          argv: options.argv,
          action: options.action,
          summary,
          scope: 'skills',
        });
      }

      await commitRepoChanges({
        paths: options.paths,
        repo: 'control',
        commandPath: options.commandPath,
        argv: options.argv,
        action: options.action,
        summary,
      });

      return result;
    },
    options.lockOptions,
  );
}
