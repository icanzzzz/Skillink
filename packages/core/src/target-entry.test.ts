import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SkillVersion } from '@skillink/shared';
import { DEFAULT_IMPORT_LIMITS, scanFolder } from './folder-scan.js';
import { createDirectoryLink } from './links.js';
import { compareTargetEntry } from './target-entry.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function sourceSkill(): Promise<{
  sourcePath: string;
  expected: SkillVersion;
}> {
  const sourcePath = await tempDir('skillink-target-entry-source-');
  await writeFile(path.join(sourcePath, 'SKILL.md'), '# demo', 'utf8');
  await writeFile(path.join(sourcePath, 'content.txt'), 'original', 'utf8');
  const scan = await scanFolder(sourcePath, DEFAULT_IMPORT_LIMITS);
  return {
    sourcePath,
    expected: {
      integrity: scan.integrity,
      fileCount: scan.fileCount,
      size: scan.totalSize,
      built: false,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('compareTargetEntry', () => {
  it('reports missing when the destination does not exist', async () => {
    const root = await tempDir('skillink-target-entry-missing-');
    const { sourcePath, expected } = await sourceSkill();

    await expect(
      compareTargetEntry({
        destination: path.join(root, 'demo'),
        sourcePath,
        mode: 'link',
        expected,
      }),
    ).resolves.toEqual({ kind: 'missing' });
  });

  it('accepts a link to the expected source directory', async () => {
    const root = await tempDir('skillink-target-entry-source-link-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await createDirectoryLink(sourcePath, destination);

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({ kind: 'ok', actual: { kind: 'link' } });
  });

  it('accepts a link to another directory with identical content', async () => {
    const root = await tempDir('skillink-target-entry-identical-');
    const { sourcePath, expected } = await sourceSkill();
    const copyPath = path.join(root, 'copy');
    await cp(sourcePath, copyPath, { recursive: true });
    const destination = path.join(root, 'demo');
    await createDirectoryLink(copyPath, destination);

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({ kind: 'ok', actual: { kind: 'link' } });
  });

  it('rejects a link whose content differs from the expected skill', async () => {
    const root = await tempDir('skillink-target-entry-different-');
    const { sourcePath, expected } = await sourceSkill();
    const copyPath = path.join(root, 'copy');
    await cp(sourcePath, copyPath, { recursive: true });
    await writeFile(path.join(copyPath, 'content.txt'), 'changed', 'utf8');
    const destination = path.join(root, 'demo');
    await createDirectoryLink(copyPath, destination);

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'wrong-version',
      actual: { kind: 'link' },
    });
  });

  it('rejects a real directory in link mode without hashing it', async () => {
    const root = await tempDir('skillink-target-entry-directory-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await cp(sourcePath, destination, { recursive: true });

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'wrong-mode',
      actual: { kind: 'directory' },
    });
  });

  it('rejects a regular file in link mode', async () => {
    const root = await tempDir('skillink-target-entry-file-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await writeFile(destination, 'not a skill', 'utf8');

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'wrong-mode',
      actual: { kind: 'file' },
    });
  });

  it('reports a self-referential link as broken', async () => {
    const root = await tempDir('skillink-target-entry-loop-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await createDirectoryLink(destination, destination);

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'broken-link',
      actual: { kind: 'link' },
    });
  });

  it('reports a broken link', async () => {
    const root = await tempDir('skillink-target-entry-broken-');
    const { sourcePath, expected } = await sourceSkill();
    const missingTarget = path.join(root, 'gone');
    await mkdir(missingTarget);
    const destination = path.join(root, 'demo');
    await createDirectoryLink(missingTarget, destination);
    await rm(missingTarget, { recursive: true, force: true });

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'link',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'broken-link',
      actual: { kind: 'link' },
    });
  });

  it('accepts a real directory with matching content in copy mode', async () => {
    const root = await tempDir('skillink-target-entry-copy-ok-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await cp(sourcePath, destination, { recursive: true });

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'copy',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'ok',
      actual: { kind: 'directory' },
    });
  });

  it('reports wrong-version for a modified copy directory', async () => {
    const root = await tempDir('skillink-target-entry-copy-different-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await cp(sourcePath, destination, { recursive: true });
    await writeFile(path.join(destination, 'content.txt'), 'changed', 'utf8');

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'copy',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'wrong-version',
      actual: { kind: 'directory' },
    });
  });

  it('reports wrong-mode for a link in copy mode', async () => {
    const root = await tempDir('skillink-target-entry-copy-link-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await createDirectoryLink(sourcePath, destination);

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'copy',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'wrong-mode',
      actual: { kind: 'link' },
    });
  });

  it('reports wrong-mode for a regular file in copy mode', async () => {
    const root = await tempDir('skillink-target-entry-copy-file-');
    const { sourcePath, expected } = await sourceSkill();
    const destination = path.join(root, 'demo');
    await writeFile(destination, 'not a skill', 'utf8');

    const comparison = await compareTargetEntry({
      destination,
      sourcePath,
      mode: 'copy',
      expected,
    });

    expect(comparison).toMatchObject({
      kind: 'wrong-mode',
      actual: { kind: 'file' },
    });
  });
});
