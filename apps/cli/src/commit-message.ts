import { buildCommitMessage } from '@skillink/core';

export type GitRepo = 'control' | 'skills';

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

export interface CliCommitMessageInput {
  repo: GitRepo;
  commandPath: string;
  argv: string[];
  action?: string;
  summary?: string;
  changedFiles: string[];
}

export function buildCliCommitMessage(input: CliCommitMessageInput): string {
  const scope =
    input.repo === 'skills'
      ? 'skills'
      : inferScope(input.commandPath, input.changedFiles);
  const action =
    input.action ??
    (commandToken(input.commandPath) === ''
      ? 'update'
      : input.commandPath.trim().split(/\s+/).at(-1)!);
  const command =
    input.argv.length > 0 ? ['skillink', ...input.argv].join(' ') : undefined;

  return buildCommitMessage({
    scope,
    action,
    summary: input.summary,
    command,
    changedFiles: input.changedFiles,
  });
}
