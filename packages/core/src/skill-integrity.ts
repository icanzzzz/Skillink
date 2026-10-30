import {
  SkillinkError,
  getSkillDir,
  type SkillinkPaths,
  type SkillVersion,
} from '@skillink/shared';
import { scanFolder } from './folder-scan.js';

export interface SkillIntegrityExpectation {
  integrity: string;
  fileCount: number;
  size: number;
}

export interface SkillIntegrityResult {
  name: string;
  version: string;
  path: string;
  ok: boolean;
  hasSkillMd: boolean;
  expected: SkillIntegrityExpectation;
  actual: SkillIntegrityExpectation;
}

export async function verifySkillIntegrity(
  paths: SkillinkPaths,
  name: string,
  version: string,
  expected: SkillVersion | SkillIntegrityExpectation,
): Promise<SkillIntegrityResult> {
  const skillPath = getSkillDir(paths, name, version);
  const scan = await scanFolder(skillPath);
  const expectedValues: SkillIntegrityExpectation = {
    integrity: expected.integrity,
    fileCount: expected.fileCount,
    size: expected.size,
  };
  const actual: SkillIntegrityExpectation = {
    integrity: scan.integrity,
    fileCount: scan.fileCount,
    size: scan.totalSize,
  };

  return {
    name,
    version,
    path: skillPath,
    ok:
      scan.kind === 'skill' &&
      actual.integrity === expectedValues.integrity &&
      actual.fileCount === expectedValues.fileCount &&
      actual.size === expectedValues.size,
    hasSkillMd: scan.kind === 'skill',
    expected: expectedValues,
    actual,
  };
}

export async function assertSkillIntegrity(
  paths: SkillinkPaths,
  name: string,
  version: string,
  expected: SkillVersion | SkillIntegrityExpectation,
): Promise<void> {
  const result = await verifySkillIntegrity(paths, name, version, expected);
  if (result.ok) {
    return;
  }

  throw new SkillinkError(
    'SKILL_INTEGRITY_MISMATCH',
    `Skill content does not match skill.json: ${name}@${version}`,
    {
      name,
      version,
      path: result.path,
      hasSkillMd: result.hasSkillMd,
      expected: result.expected.integrity,
      actual: result.actual.integrity,
      expectedFileCount: result.expected.fileCount,
      actualFileCount: result.actual.fileCount,
      expectedSize: result.expected.size,
      actualSize: result.actual.size,
    },
  );
}
