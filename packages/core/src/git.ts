import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  type GitHistoryEntry,
  type SkillinkPaths,
} from '@skillink/shared';

export type GitRepo = 'control' | 'skills';

export const CONTROL_GITIGNORE_ENTRIES = [
  '/skills/',
  '/trash/',
  '/history/',
  '/cache/',
  '/logs/',
  '/tmp/',
  '/settings.json',
  '.skillink.lock',
] as const;

/** Paths the control repo is allowed to track. Everything else is ignored. */
export const CONTROL_TRACKED_PATHS = [
  'route.json',
  'package.json',
  'skill.json',
  'locales',
  '.gitignore',
  '.gitattributes',
] as const;

export const GIT_ATTRIBUTES = '* -text';

interface RawGitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

export function gitRepoDir(paths: SkillinkPaths, repo: GitRepo): string {
  return repo === 'control' ? paths.home : paths.libraryDir;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
  };
}

function isExecError(
  error: unknown,
): error is Error & {
  code?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
} {
  return error instanceof Error;
}

async function runGitRaw(
  cwd: string,
  args: string[],
): Promise<RawGitResult> {
  try {
    const result = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        execFile(
          'git',
          args,
          {
            cwd,
            env: gitEnv(),
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(
                Object.assign(error, {
                  stdout: String(stdout ?? ''),
                  stderr: String(stderr ?? ''),
                }),
              );
              return;
            }
            resolve({
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
            });
          },
        );
      },
    );

    return { ok: true, ...result };
  } catch (error) {
    if (isExecError(error) && error.code === 'ENOENT') {
      throw new SkillinkError(
        'GIT_UNAVAILABLE',
        'Git is not available on PATH.',
        { cwd, args },
        { cause: error },
      );
    }

    if (!isExecError(error)) {
      throw error;
    }

    const rawCode: unknown = (error as unknown as { code?: unknown }).code;
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout) : '',
      stderr: error.stderr ? String(error.stderr) : '',
      exitCode: typeof rawCode === 'number' ? rawCode : undefined,
    };
  }
}

function failedGit(
  cwd: string,
  args: string[],
  result: RawGitResult,
): never {
  const detail = result.stderr.trim() || result.stdout.trim() || 'unknown error';

  if (/not a git repository/i.test(detail)) {
    throw new SkillinkError(
      'GIT_NOT_REPOSITORY',
      `Not a git repository: ${cwd}`,
      { cwd, args, stderr: result.stderr },
    );
  }

  throw new SkillinkError(
    'GIT_COMMAND_FAILED',
    `git ${args[0] ?? ''} failed: ${detail}`,
    { cwd, args, stderr: result.stderr, exitCode: result.exitCode },
  );
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await runGitRaw(cwd, args);

  if (!result.ok) {
    failedGit(cwd, args, result);
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await runGitRaw(process.cwd(), ['--version']);
    return result.ok;
  } catch (error) {
    if (error instanceof SkillinkError && error.code === 'GIT_UNAVAILABLE') {
      return false;
    }
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function appendMissingLines(
  filePath: string,
  lines: readonly string[],
): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf8');
  } catch (error) {
    if (!isExecError(error) || error.code !== 'ENOENT') {
      throw new SkillinkError(
        'IO_ERROR',
        `Failed to read ${filePath}.`,
        { filePath },
        { cause: error },
      );
    }
  }

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const present = new Set(existing.split(/\r?\n/));
  const missing = lines.filter((line) => !present.has(line));

  if (missing.length === 0) {
    return;
  }

  let next = existing;
  if (next.length > 0 && !next.endsWith('\n')) {
    next += eol;
  }
  next += `${missing.join(eol)}${eol}`;

  await writeFile(filePath, next, 'utf8');
}

export async function ensureControlRepo(paths: SkillinkPaths): Promise<void> {
  await mkdir(paths.home, { recursive: true });

  if (!(await pathExists(path.join(paths.home, '.git')))) {
    await runGit(paths.home, ['init']);
  }

  await appendMissingLines(
    path.join(paths.home, '.gitignore'),
    CONTROL_GITIGNORE_ENTRIES,
  );
  await appendMissingLines(path.join(paths.home, '.gitattributes'), [
    GIT_ATTRIBUTES,
  ]);
}

export async function ensureSkillsRepo(paths: SkillinkPaths): Promise<void> {
  await mkdir(paths.libraryDir, { recursive: true });

  if (!(await pathExists(path.join(paths.libraryDir, '.git')))) {
    await runGit(paths.libraryDir, ['init']);
  }

  await appendMissingLines(path.join(paths.libraryDir, '.gitattributes'), [
    GIT_ATTRIBUTES,
  ]);
}

export async function gitRepoExists(
  paths: SkillinkPaths,
  repo: GitRepo,
): Promise<boolean> {
  return pathExists(path.join(gitRepoDir(paths, repo), '.git'));
}

export async function gitStatus(
  paths: SkillinkPaths,
  repo: GitRepo,
  pathspec: readonly string[] = [],
): Promise<string[]> {
  const { stdout } = await runGit(gitRepoDir(paths, repo), [
    'status',
    '--porcelain',
    ...(pathspec.length > 0 ? ['--', ...pathspec] : []),
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export async function gitAddAll(
  paths: SkillinkPaths,
  repo: GitRepo,
  pathspec: readonly string[] = [],
): Promise<void> {
  await runGit(gitRepoDir(paths, repo), [
    'add',
    '-A',
    ...(pathspec.length > 0 ? ['--', ...pathspec] : []),
  ]);
}

export async function gitStagedFiles(
  paths: SkillinkPaths,
  repo: GitRepo,
  pathspec: readonly string[] = [],
): Promise<string[]> {
  const { stdout } = await runGit(gitRepoDir(paths, repo), [
    'diff',
    '--cached',
    '--name-only',
    '-z',
    ...(pathspec.length > 0 ? ['--', ...pathspec] : []),
  ]);

  return stdout
    .split('\0')
    .filter((file) => file.length > 0)
    .sort();
}

export async function gitTrackedFiles(
  paths: SkillinkPaths,
  repo: GitRepo,
): Promise<string[]> {
  const { stdout } = await runGit(gitRepoDir(paths, repo), [
    'ls-files',
    '-z',
  ]);

  return stdout.split('\0').filter((file) => file.length > 0);
}

export interface GitCommitOptions {
  allowEmpty?: boolean;
  files?: string[];
}

export async function gitCommit(
  paths: SkillinkPaths,
  repo: GitRepo,
  message: string,
  options: GitCommitOptions = {},
): Promise<string> {
  const cwd = gitRepoDir(paths, repo);
  const args = [
    '-c',
    'user.name=Skillink',
    '-c',
    'user.email=skillink@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-verify',
    ...(options.allowEmpty ? ['--allow-empty'] : []),
    '-m',
    message,
  ];

  const result = await runGitRaw(cwd, args);

  if (!result.ok) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || 'unknown error';
    throw new SkillinkError(
      'GIT_COMMIT_FAILED',
      `Failed to commit ${repo} changes in ${cwd}: ${detail}. ` +
        `Files: ${(options.files ?? []).join(', ') || 'unknown'}. ` +
        `Run "git -C "${cwd}" status" and commit or restore manually.`,
      {
        repo,
        cwd,
        message,
        files: options.files ?? [],
        hint: `git -C "${cwd}" status`,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
    );
  }

  const head = await runGit(cwd, ['rev-parse', 'HEAD']);
  return head.stdout.trim();
}

export interface GitLogOptions {
  limit?: number;
}

export async function gitLog(
  paths: SkillinkPaths,
  repo: GitRepo,
  options: GitLogOptions = {},
): Promise<GitHistoryEntry[]> {
  const cwd = gitRepoDir(paths, repo);
  const limit = options.limit ?? 50;
  const result = await runGitRaw(cwd, [
    'log',
    '-n',
    String(limit),
    '--format=%H%x1f%aI%x1f%s',
  ]);

  if (!result.ok) {
    if (
      /does not have any commits|unknown revision|bad revision|ambiguous argument/i.test(
        result.stderr,
      )
    ) {
      return [];
    }
    failedGit(cwd, ['log'], result);
  }

  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id = '', createdAt = '', ...reason] = line.split('\x1f');
      return {
        id,
        createdAt,
        reason: reason.join('\x1f'),
      };
    })
    .filter((entry) => entry.id.length > 0);
}

export async function gitHead(
  paths: SkillinkPaths,
  repo: GitRepo,
): Promise<string | undefined> {
  const cwd = gitRepoDir(paths, repo);
  const result = await runGitRaw(cwd, ['rev-parse', '--verify', 'HEAD']);

  if (!result.ok) {
    if (/not a git repository/i.test(result.stderr)) {
      failedGit(cwd, ['rev-parse', 'HEAD'], result);
    }
    return undefined;
  }

  return result.stdout.trim();
}

export async function gitResolveCommit(
  paths: SkillinkPaths,
  repo: GitRepo,
  revision: string,
): Promise<string> {
  const trimmed = revision.trim();

  if (!trimmed || trimmed.startsWith('-')) {
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      `Revision not found: ${revision}`,
      { revision, repo },
    );
  }

  const cwd = gitRepoDir(paths, repo);
  const result = await runGitRaw(cwd, [
    'rev-parse',
    '--verify',
    `${trimmed}^{commit}`,
  ]);

  if (!result.ok) {
    if (/not a git repository/i.test(result.stderr)) {
      failedGit(cwd, ['rev-parse', trimmed], result);
    }
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      `Revision not found: ${trimmed}`,
      { revision: trimmed, repo, stderr: result.stderr },
    );
  }

  return result.stdout.trim();
}

export async function gitShowFile(
  paths: SkillinkPaths,
  repo: GitRepo,
  revision: string,
  file: string,
): Promise<string> {
  const cwd = gitRepoDir(paths, repo);
  const { stdout } = await runGit(cwd, ['show', `${revision}:${file}`]);
  return stdout;
}

export async function gitFileExistsAt(
  paths: SkillinkPaths,
  repo: GitRepo,
  revision: string,
  file: string,
): Promise<boolean> {
  const cwd = gitRepoDir(paths, repo);
  const result = await runGitRaw(cwd, [
    'cat-file',
    '-e',
    `${revision}:${file}`,
  ]);

  return result.ok;
}

export async function gitShowJson<T = unknown>(
  paths: SkillinkPaths,
  repo: GitRepo,
  revision: string,
  file: string,
): Promise<T> {
  const text = await gitShowFile(paths, repo, revision, file);

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Invalid JSON in ${file} at ${revision}.`,
      { file, revision, repo },
      { cause: error },
    );
  }
}

export async function gitCheckoutPaths(
  paths: SkillinkPaths,
  repo: GitRepo,
  revision: string,
  files: string[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const cwd = gitRepoDir(paths, repo);
  const result = await runGitRaw(cwd, [
    'checkout',
    revision,
    '--',
    ...files,
  ]);

  if (!result.ok) {
    throw new SkillinkError(
      'GIT_RESTORE_FAILED',
      `Failed to restore ${files.join(', ')} from ${revision}: ${
        result.stderr.trim() || 'unknown error'
      }`,
      { repo, revision, files, stderr: result.stderr },
    );
  }
}

export async function gitPathHistory(
  paths: SkillinkPaths,
  repo: GitRepo,
  file: string,
): Promise<string | undefined> {
  const cwd = gitRepoDir(paths, repo);
  const result = await runGitRaw(cwd, [
    'log',
    '--format=%H',
    '--',
    file,
  ]);

  if (!result.ok) {
    if (
      /does not have any commits|unknown revision|bad revision|ambiguous argument/i.test(
        result.stderr,
      )
    ) {
      return undefined;
    }
    failedGit(cwd, ['log', file], result);
  }

  for (const commit of result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const present = await runGitRaw(cwd, ['cat-file', '-e', `${commit}:${file}`]);
    if (present.ok) {
      return commit;
    }
  }

  return undefined;
}
