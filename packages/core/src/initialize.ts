import { mkdir, stat } from 'node:fs/promises';
import { SkillinkError, type SkillinkPaths } from '@skillink/shared';
import { writeSettingsFile } from './language-store.js';
import { isNodeError } from './node-error.js';
import { readPackageFile, writePackageFile } from './package-store.js';
import { readRouteFile, writeRouteFile } from './route.js';
import { readSkillFile, writeSkillFile } from './skill-store.js';

export async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

export async function ensureDirectories(paths: SkillinkPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.localesDir, { recursive: true }),
    mkdir(paths.libraryDir, { recursive: true }),
    mkdir(paths.cacheDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.tmpDir, { recursive: true }),
  ]);
}

export async function ensureControlFiles(paths: SkillinkPaths): Promise<void> {
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

export async function writeInitialSettings(
  paths: SkillinkPaths,
): Promise<void> {
  if (!(await pathExists(paths.settingsFile))) {
    await writeSettingsFile(paths, { schemaVersion: 1 });
  }
}

/**
 * Ensure the home directory layout and control files exist. A v1 home is
 * rejected until `init` or `migrate` has produced the v2 configuration.
 */
export async function ensureHome(paths: SkillinkPaths): Promise<void> {
  await ensureDirectories(paths);

  if (
    (await pathExists(paths.skillsFile)) &&
    !(await pathExists(paths.skillFile))
  ) {
    throw new SkillinkError(
      'IO_ERROR',
      'Found v1 skills.json. Run "skillink init" or "skillink migrate" first.',
      { home: paths.home },
    );
  }

  await ensureControlFiles(paths);
}
