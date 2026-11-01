import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  isSafeSegment,
  parseSkillDirectoryName,
  type SkillPackageCandidate,
  type SkillPackageScanReport,
} from '@skillink/shared';
import { DEFAULT_IMPORT_LIMITS } from './folder-scan.js';
import { assertSafeImportSource } from './path-policy.js';
import { parseSkillFrontmatter } from './skill-md.js';

export interface ScanSkillPackagesOptions {
  maxDepth?: number;
}

async function readOptionalFrontmatter(
  packageDir: string,
): Promise<{ name?: string; description?: string }> {
  try {
    const content = await readFile(path.join(packageDir, 'SKILL.md'), 'utf8');
    const frontmatter = parseSkillFrontmatter(content);
    return {
      ...(frontmatter?.name ? { name: frontmatter.name } : {}),
      ...(frontmatter?.description
        ? { description: frontmatter.description }
        : {}),
    };
  } catch {
    return {};
  }
}

async function listDirectoryLinks(
  packageDir: string,
  maxDepth: number,
): Promise<string[]> {
  const links: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      throw new SkillinkError(
        'IMPORT_LIMIT_EXCEEDED',
        `Skill package exceeds the maximum depth of ${maxDepth}.`,
        { path: current, depth, maxDepth },
      );
    }

    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const info = await lstat(fullPath);

      if (info.isSymbolicLink()) {
        const pointsToDirectory = await stat(fullPath)
          .then((target) => target.isDirectory())
          .catch(() => true);
        if (pointsToDirectory) {
          links.push(path.resolve(fullPath));
        }
        continue;
      }

      if (info.isDirectory()) {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(packageDir, 0);
  return links.sort((left, right) => left.localeCompare(right));
}

async function describePackage(
  packageDir: string,
  maxDepth: number,
): Promise<SkillPackageCandidate> {
  const folderName = path.basename(packageDir);
  const folderSpec = parseSkillDirectoryName(folderName);
  const frontmatter = await readOptionalFrontmatter(packageDir);
  const frontmatterName =
    frontmatter.name !== undefined && isSafeSegment(frontmatter.name)
      ? frontmatter.name
      : undefined;
  const name = folderSpec?.name ?? frontmatterName;

  return {
    sourceDir: packageDir,
    ...(name === undefined ? {} : { name }),
    ...(folderSpec?.version === undefined
      ? {}
      : { version: folderSpec.version }),
    ...(frontmatter.description === undefined
      ? {}
      : { description: frontmatter.description }),
    directoryLinks: await listDirectoryLinks(packageDir, maxDepth),
  };
}

/**
 * Finds skill packages below a folder. A skill package is a directory whose
 * root contains SKILL.md; recursion stops at the first package boundary so
 * nested SKILL.md files are treated as package content. Directory links are
 * reported but never followed.
 */
export async function scanSkillPackages(
  sourceDir: string,
  options: ScanSkillPackagesOptions = {},
): Promise<SkillPackageScanReport> {
  let rootDir: string;
  try {
    rootDir = await assertSafeImportSource(sourceDir);
  } catch (error) {
    if (error instanceof SkillinkError) {
      throw error;
    }
    throw new SkillinkError(
      'IO_ERROR',
      `Source folder does not exist or is not accessible: ${sourceDir}`,
      { sourceDir },
      { cause: error },
    );
  }
  const maxDepth = options.maxDepth ?? DEFAULT_IMPORT_LIMITS.maxDepth;
  const packages: SkillPackageCandidate[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      throw new SkillinkError(
        'IMPORT_LIMIT_EXCEEDED',
        `Source folder exceeds the maximum depth of ${maxDepth}.`,
        { path: current, depth, maxDepth },
      );
    }

    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    const skillEntry = entries.find(
      (entry) =>
        entry.name === 'SKILL.md' &&
        (entry.isFile() || entry.isSymbolicLink()),
    );

    if (skillEntry) {
      packages.push(await describePackage(current, maxDepth));
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), depth + 1);
      }
    }
  }

  await walk(rootDir, 0);

  return { rootDir, packages };
}
