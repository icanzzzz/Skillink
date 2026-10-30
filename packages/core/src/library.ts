import {
  SkillinkError,
  SkillsFileSchema,
  createEmptySkillsFile,
  type LibraryVersion,
  type PackageKind,
  type SkillinkPaths,
  type SkillsFile,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';

export async function readSkillsFile(paths: SkillinkPaths): Promise<SkillsFile> {
  return readJsonFile(paths.skillsFile, SkillsFileSchema, createEmptySkillsFile());
}

export async function writeSkillsFile(
  paths: SkillinkPaths,
  file: SkillsFile,
): Promise<void> {
  await writeJsonAtomic(paths.skillsFile, file, SkillsFileSchema);
}

export function librarySourcePath(name: string, version: string): string {
  return `skills/${name}/${version}`;
}

export interface UpsertLibraryVersionInput {
  name: string;
  version: string;
  integrity: string;
  fileCount: number;
  size: number;
  kind: PackageKind;
  built?: boolean;
}

export async function upsertLibraryVersion(
  paths: SkillinkPaths,
  input: UpsertLibraryVersionInput,
): Promise<{ created: boolean }> {
  const file = await readSkillsFile(paths);
  const packageEntry = file.packages[input.name] ?? {
    kind: input.kind,
    versions: {},
  };
  const existing = packageEntry.versions[input.version];

  if (existing) {
    if (existing.integrity === input.integrity) {
      return { created: false };
    }

    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Package ${input.name}@${input.version} already exists with different content.`,
      {
        name: input.name,
        version: input.version,
        existingIntegrity: existing.integrity,
        incomingIntegrity: input.integrity,
      },
    );
  }

  const version: LibraryVersion = {
    integrity: input.integrity,
    source: librarySourcePath(input.name, input.version),
    fileCount: input.fileCount,
    size: input.size,
    built: input.built ?? false,
  };

  file.packages[input.name] = {
    ...packageEntry,
    kind: input.kind,
    versions: {
      ...packageEntry.versions,
      [input.version]: version,
    },
  };

  await writeSkillsFile(paths, file);
  return { created: true };
}

export function getLibraryVersion(
  file: SkillsFile,
  name: string,
  version: string,
): LibraryVersion | undefined {
  return file.packages[name]?.versions[version];
}
