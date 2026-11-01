import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { getSkillDir, type DoctorIssue } from '@skillink/shared';
import { isNodeError } from '../node-error.js';
import { verifySkillIntegrity } from '../skill-integrity.js';
import { pathIsDirectory, pathIsFile, type DoctorContext } from './issues.js';

export async function checkSkillContent(
  ctx: DoctorContext,
): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const { paths } = ctx;

  for (const [name, skillEntry] of Object.entries(ctx.skillFile.skills)) {
    for (const version of Object.keys(skillEntry.versions)) {
      const contentPath = getSkillDir(paths, name, version);

      if (!(await pathIsDirectory(contentPath))) {
        issues.push({
          code: 'MISSING_CONTENT',
          message: `Skill content is missing: ${name}@${version}`,
          name,
          version,
          path: contentPath,
        });
        continue;
      }

      if (!(await pathIsFile(path.join(contentPath, 'SKILL.md')))) {
        issues.push({
          code: 'SKILL_MD_MISSING',
          message: `Skill content has no SKILL.md: ${name}@${version}`,
          name,
          version,
          path: contentPath,
        });
        continue;
      }

      try {
        const integrity = await verifySkillIntegrity(
          paths,
          name,
          version,
          skillEntry.versions[version]!,
        );
        if (!integrity.ok) {
          issues.push({
            code: 'SKILL_INTEGRITY_MISMATCH',
            message: `Skill content does not match skill.json: ${name}@${version}`,
            name,
            version,
            path: contentPath,
            details: {
              expectedIntegrity: integrity.expected.integrity,
              actualIntegrity: integrity.actual.integrity,
              expectedFileCount: integrity.expected.fileCount,
              actualFileCount: integrity.actual.fileCount,
              expectedSize: integrity.expected.size,
              actualSize: integrity.actual.size,
            },
          });
        }
      } catch (error) {
        issues.push({
          code: 'INVALID_CONFIG',
          message: error instanceof Error ? error.message : String(error),
          name,
          version,
          path: contentPath,
        });
      }
    }
  }

  const skillDirectories = await readdir(paths.libraryDir, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  for (const skillDirectory of skillDirectories) {
    if (
      !skillDirectory.isDirectory() ||
      skillDirectory.name.toLowerCase() === '.git'
    ) {
      continue;
    }

    const skillEntry = ctx.skillFile.skills[skillDirectory.name];
    const versionDirectories = (
      await readdir(path.join(paths.libraryDir, skillDirectory.name), {
        withFileTypes: true,
      }).catch(() => [])
    ).filter((entry) => entry.isDirectory());

    if (!skillEntry) {
      if (versionDirectories.length === 0) {
        continue;
      }
      issues.push({
        code: 'ORPHAN_CONTENT',
        message: `Library directory is not in skill.json: ${skillDirectory.name}`,
        name: skillDirectory.name,
        path: path.join(paths.libraryDir, skillDirectory.name),
      });
      continue;
    }

    for (const versionDirectory of versionDirectories) {
      if (!skillEntry.versions[versionDirectory.name]) {
        issues.push({
          code: 'ORPHAN_CONTENT',
          message: `Library version is not in skill.json: ${skillDirectory.name}@${versionDirectory.name}`,
          name: skillDirectory.name,
          version: versionDirectory.name,
          path: path.join(
            paths.libraryDir,
            skillDirectory.name,
            versionDirectory.name,
          ),
        });
      }
    }
  }

  return issues;
}
