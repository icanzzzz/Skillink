import os from 'node:os';
import path from 'node:path';
import { expandPath } from './path-expand.js';
import { assertSafeSegment, assertSafeVersion } from './safe-path.js';

export interface SkillinkPaths {
  home: string;
  /** user preferences, including the selected UI locale */
  settingsFile: string;
  /** installed language packs */
  localesDir: string;
  routeFile: string;
  /** v2 skill catalog */
  skillFile: string;
  /** v2 package composition config */
  packageFile: string;
  /** v1 catalog; used only by migration */
  skillsFile: string;
  /** home-level cross-process write lock */
  lockFile: string;
  libraryDir: string;
  cacheDir: string;
  logsDir: string;
  tmpDir: string;
}

export function getDefaultSkillinkHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.SKILLINK_HOME?.trim();
  if (override) {
    return path.resolve(expandPath(override, { env }));
  }

  return path.join(os.homedir(), '.agents', 'skillink');
}

export function getSkillinkPaths(home = getDefaultSkillinkHome()): SkillinkPaths {
  const resolvedHome = path.resolve(expandPath(home));

  return {
    home: resolvedHome,
    settingsFile: path.join(resolvedHome, 'settings.json'),
    localesDir: path.join(resolvedHome, 'locales'),
    routeFile: path.join(resolvedHome, 'route.json'),
    skillFile: path.join(resolvedHome, 'skill.json'),
    packageFile: path.join(resolvedHome, 'package.json'),
    skillsFile: path.join(resolvedHome, 'skills.json'),
    lockFile: path.join(resolvedHome, '.skillink.lock'),
    libraryDir: path.join(resolvedHome, 'skills'),
    cacheDir: path.join(resolvedHome, 'cache'),
    logsDir: path.join(resolvedHome, 'logs'),
    tmpDir: path.join(resolvedHome, 'tmp'),
  };
}

export function getSkillDir(
  paths: SkillinkPaths,
  name: string,
  version: string,
): string {
  assertSafeSegment(name, 'skill name');
  assertSafeVersion(version, 'skill version');
  return path.join(paths.libraryDir, name, version);
}
