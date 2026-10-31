import {
  SettingsFileSchema,
  type SettingsFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';

export async function readSettingsFile(
  paths: SkillinkPaths,
): Promise<SettingsFile> {
  return readJsonFile(paths.settingsFile, SettingsFileSchema, {
    schemaVersion: 1,
  });
}

export async function writeSettingsFile(
  paths: SkillinkPaths,
  settings: SettingsFile,
): Promise<void> {
  await writeJsonAtomic(paths.settingsFile, settings, SettingsFileSchema);
}
