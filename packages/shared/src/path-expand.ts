import os from 'node:os';
import path from 'node:path';
import { SkillinkError } from './errors.js';

export interface ExpandPathOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  home?: string;
  caseInsensitiveEnv?: boolean;
}

const ENV_TOKEN = /%([^%]+)%|\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function lookupEnv(
  env: ExpandPathOptions['env'],
  name: string,
  caseInsensitive: boolean,
): string | undefined {
  if (!env) {
    return undefined;
  }

  if (!caseInsensitive) {
    return env[name];
  }

  const key = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? env[key] : undefined;
}

export function expandPath(
  input: string,
  options: ExpandPathOptions = {},
): string {
  const home = options.home ?? os.homedir();
  let expanded = input;

  if (expanded === '~') {
    expanded = home;
  } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(home, expanded.slice(2));
  }

  const caseInsensitiveEnv =
    options.caseInsensitiveEnv ?? process.platform === 'win32';
  const unresolved: string[] = [];

  expanded = expanded.replace(
    ENV_TOKEN,
    (match, percentName: string | undefined, bracedName: string | undefined, bareName: string | undefined) => {
      const name = percentName ?? bracedName ?? bareName;
      if (!name) {
        return match;
      }

      const value = lookupEnv(options.env, name, caseInsensitiveEnv);
      if (value === undefined) {
        unresolved.push(name);
        return match;
      }

      return value;
    },
  );

  if (unresolved.length > 0) {
    throw new SkillinkError(
      'INVALID_PATH',
      `Path contains unresolved environment variables: ${unresolved.join(', ')}`,
      { path: input, unresolved },
    );
  }

  return expanded;
}
