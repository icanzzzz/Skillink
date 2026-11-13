import type { PackageEntry, PackageFile, SkillEntry, SkillFile } from '@skillink/shared';
import { sortVersionsDesc, suggestNextVersion } from '@skillink/shared';

export interface VersionChoice {
  value: string;
  label: string;
  kind: 'version' | 'tag';
}

export interface LibraryOption {
  name: string;
  description?: string;
  tags: Record<string, string>;
  versions: string[];
  latestVersion: string | null;
}

export interface SkillOption extends LibraryOption {}

export interface PackageOption extends LibraryOption {
  skillCount: Record<string, number>;
}

function latestVersionOf(
  tags: Record<string, string>,
  versions: readonly string[],
): string | null {
  const tagged = tags.latest;
  if (tagged !== undefined && versions.includes(tagged)) {
    return tagged;
  }
  return sortVersionsDesc(versions)[0] ?? null;
}

function baseOption(
  name: string,
  entry: SkillEntry | PackageEntry,
): LibraryOption {
  const versions = sortVersionsDesc(Object.keys(entry.versions));
  const tags = entry.tags ?? {};
  return {
    name,
    ...(entry.description === undefined
      ? {}
      : { description: entry.description }),
    tags,
    versions,
    latestVersion: latestVersionOf(tags, versions),
  };
}

export function skillOptions(file: SkillFile): SkillOption[] {
  return Object.entries(file.skills)
    .map(([name, entry]) => baseOption(name, entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function packageOptions(file: PackageFile): PackageOption[] {
  return Object.entries(file.packages)
    .map(([name, entry]) => {
      const skillCount: Record<string, number> = {};
      for (const [version, value] of Object.entries(entry.versions)) {
        skillCount[version] = Object.keys(value.skills).length;
      }
      return { ...baseOption(name, entry), skillCount };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function versionChoices(
  option: LibraryOption,
  includeTags: boolean,
): VersionChoice[] {
  const choices: VersionChoice[] = [];

  if (includeTags) {
    for (const [tag, version] of Object.entries(option.tags)) {
      if (option.versions.includes(version)) {
        choices.push({
          value: tag,
          label: `${tag} → ${version}`,
          kind: 'tag',
        });
      }
    }
  }

  for (const version of option.versions) {
    choices.push({ value: version, label: version, kind: 'version' });
  }

  return choices;
}

export function defaultRequested(option: LibraryOption): string {
  return option.latestVersion ?? '';
}

export function suggestVersionFor(file: PackageFile, name: string): string {
  const entry = file.packages[name];
  if (entry === undefined) {
    return '1.0.0';
  }
  return suggestNextVersion(Object.keys(entry.versions));
}
