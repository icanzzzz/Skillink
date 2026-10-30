import os from 'node:os';
import path from 'node:path';

export interface SkillinkPaths {
  home: string;
  routeFile: string;
  skillsFile: string;
  libraryDir: string;
  historyDir: string;
  cacheDir: string;
  logsDir: string;
  trashDir: string;
  tmpDir: string;
}

export function getDefaultSkillinkHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.SKILLINK_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(os.homedir(), '.agents', 'skillink');
}

export function getSkillinkPaths(home = getDefaultSkillinkHome()): SkillinkPaths {
  const resolvedHome = path.resolve(home);

  return {
    home: resolvedHome,
    routeFile: path.join(resolvedHome, 'route.json'),
    skillsFile: path.join(resolvedHome, 'skills.json'),
    libraryDir: path.join(resolvedHome, 'skills'),
    historyDir: path.join(resolvedHome, 'history'),
    cacheDir: path.join(resolvedHome, 'cache'),
    logsDir: path.join(resolvedHome, 'logs'),
    trashDir: path.join(resolvedHome, 'trash'),
    tmpDir: path.join(resolvedHome, 'tmp'),
  };
}

export function getPackageDir(
  paths: SkillinkPaths,
  name: string,
  version: string,
): string {
  return path.join(paths.libraryDir, name, version);
}
