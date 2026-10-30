import { randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getPackageDir,
  getSkillinkPaths,
  type PackageKind,
} from '@skillink/shared';
import { scanFolder } from './folder-scan.js';
import {
  librarySourcePath,
  readSkillsFile,
  upsertLibraryVersion,
} from './library.js';
import {
  assertSafePackageName,
  createAutoVersion,
  normalizeVersion,
} from './package-name.js';

export interface ImportFolderInput {
  sourceDir: string;
  name?: string;
  version?: string;
  home?: string;
}

export interface ImportResult {
  name: string;
  version: string;
  integrity: string;
  source: string;
  path: string;
  kind: PackageKind;
  fileCount: number;
  size: number;
  created: boolean;
}

function sourceError(message: string, sourceDir: string): SkillinkError {
  return new SkillinkError('IO_ERROR', message, { sourceDir });
}

export async function importFolder(input: ImportFolderInput): Promise<ImportResult> {
  const paths = getSkillinkPaths(input.home);
  const sourceDir = path.resolve(input.sourceDir);
  const sourceStat = await stat(sourceDir).catch((error: unknown) => {
    throw new SkillinkError(
      'IO_ERROR',
      `Source folder does not exist: ${sourceDir}`,
      { sourceDir },
      { cause: error },
    );
  });

  if (!sourceStat.isDirectory()) {
    throw sourceError(`Source is not a folder: ${sourceDir}`, sourceDir);
  }

  const scan = await scanFolder(sourceDir);
  const name = assertSafePackageName(input.name ?? path.basename(sourceDir));
  const version =
    normalizeVersion(input.version) ?? createAutoVersion(scan.manifestHash);
  const packageDir = getPackageDir(paths, name, version);
  const source = librarySourcePath(name, version);
  const library = await readSkillsFile(paths);
  const existing = library.packages[name]?.versions[version];

  if (existing) {
    if (existing.integrity === scan.integrity) {
      return {
        name,
        version,
        integrity: existing.integrity,
        source: existing.source,
        path: packageDir,
        kind: library.packages[name]?.kind ?? scan.kind,
        fileCount: existing.fileCount,
        size: existing.size,
        created: false,
      };
    }

    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Package ${name}@${version} already exists with different content.`,
      {
        name,
        version,
        existingIntegrity: existing.integrity,
        incomingIntegrity: scan.integrity,
      },
    );
  }

  try {
    await lstat(packageDir);
    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Version directory already exists but is not in skills.json: ${packageDir}`,
      { name, version, packageDir },
    );
  } catch (error) {
    if (error instanceof SkillinkError) {
      throw error;
    }
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  const stagingDir = path.join(paths.tmpDir, `import-${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    for (const directory of scan.directories) {
      await mkdir(path.join(stagingDir, directory.relativePath), {
        recursive: true,
      });
    }

    for (const file of scan.files) {
      const destination = path.join(stagingDir, file.relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(sourceDir, file.relativePath), destination);
      await chmod(destination, file.mode).catch(() => undefined);
    }

    await mkdir(path.dirname(packageDir), { recursive: true });
    await rename(stagingDir, packageDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  try {
    await upsertLibraryVersion(paths, {
      name,
      version,
      integrity: scan.integrity,
      fileCount: scan.fileCount,
      size: scan.totalSize,
      kind: scan.kind,
    });
  } catch (error) {
    await rm(packageDir, { recursive: true, force: true });
    throw error;
  }

  return {
    name,
    version,
    integrity: scan.integrity,
    source,
    path: packageDir,
    kind: scan.kind,
    fileCount: scan.fileCount,
    size: scan.totalSize,
    created: true,
  };
}
