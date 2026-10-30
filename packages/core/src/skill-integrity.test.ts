import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type SkillVersion,
} from '@skillink/shared';
import {
  assertSkillIntegrity,
  verifySkillIntegrity,
} from './skill-integrity.js';
import { importSkill } from './import-skill.js';
import { readSkillFile } from './skill-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<{
  home: string;
  paths: ReturnType<typeof getSkillinkPaths>;
  expected: SkillVersion;
}> {
  const root = await tempDir('skillink-integrity-');
  const home = path.join(root, 'home');
  const source = await tempDir('skillink-integrity-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# demo\n', 'utf8');
  await writeFile(path.join(source, 'content.txt'), 'original', 'utf8');
  await importSkill({ sourceDir: source, name: 'demo', version: '1.0.0', home });
  const expected = (await readSkillFile(getSkillinkPaths(home))).skills.demo
    ?.versions['1.0.0'];
  if (!expected) {
    throw new Error('expected skill version was not imported');
  }
  return { home, paths: getSkillinkPaths(home), expected };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('skill integrity', () => {
  it('accepts untouched library content', async () => {
    const { paths, expected } = await setup();

    const result = await verifySkillIntegrity(paths, 'demo', '1.0.0', expected);

    expect(result.ok).toBe(true);
    expect(result.actual).toEqual({
      integrity: expected.integrity,
      fileCount: expected.fileCount,
      size: expected.size,
    });
    await expect(
      assertSkillIntegrity(paths, 'demo', '1.0.0', expected),
    ).resolves.toBeUndefined();
  });

  it('detects changed skill content', async () => {
    const { paths, expected } = await setup();
    await writeFile(
      path.join(getSkillDir(paths, 'demo', '1.0.0'), 'content.txt'),
      'tampered',
      'utf8',
    );

    const result = await verifySkillIntegrity(paths, 'demo', '1.0.0', expected);

    expect(result.ok).toBe(false);
    expect(result.actual.integrity).not.toBe(expected.integrity);
    await expect(
      assertSkillIntegrity(paths, 'demo', '1.0.0', expected),
    ).rejects.toMatchObject({
      code: 'SKILL_INTEGRITY_MISMATCH',
      details: expect.objectContaining({
        name: 'demo',
        version: '1.0.0',
        expected: expected.integrity,
      }),
    });
  });

  it('reports metadata mismatches even when content hashes match', async () => {
    const { paths, expected } = await setup();

    const result = await verifySkillIntegrity(paths, 'demo', '1.0.0', {
      ...expected,
      fileCount: expected.fileCount + 1,
    });

    expect(result.ok).toBe(false);
    expect(result.actual.integrity).toBe(expected.integrity);
  });
});
