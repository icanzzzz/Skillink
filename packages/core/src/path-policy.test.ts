import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import {
  assertSafeImportSource,
  assertSafeTargetPath,
  isPathInside,
} from './path-policy.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-path-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('import source policy', () => {
  it('rejects a configured system directory', async () => {
    const dir = await tempDir();

    await expect(
      assertSafeImportSource(dir, { systemDirectories: [dir] }),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });

  it('accepts a normal source directory', async () => {
    const dir = await tempDir();

    await expect(
      assertSafeImportSource(dir, { systemDirectories: [] }),
    ).resolves.toBe(path.resolve(dir));
  });
});

describe('target path policy', () => {
  it('accepts a normal project subdirectory', async () => {
    const dir = await tempDir();
    const paths = getSkillinkPaths(path.join(dir, 'home'));
    const target = path.join(dir, 'project', 'packages');

    expect(assertSafeTargetPath(target, paths)).toBe(path.resolve(target));
  });

  it('rejects a path inside the control plane', async () => {
    const dir = await tempDir();
    const paths = getSkillinkPaths(path.join(dir, 'home'));

    expect(() => assertSafeTargetPath(path.join(paths.home, 'target'), paths)).toThrow(
      /control plane/i,
    );
  });

  it('rejects the control plane root itself', async () => {
    const dir = await tempDir();
    const paths = getSkillinkPaths(path.join(dir, 'home'));

    expect(() => assertSafeTargetPath(paths.home, paths)).toThrow();
  });

  it('rejects a drive root', async () => {
    const dir = await tempDir();
    const paths = getSkillinkPaths(path.join(dir, 'home'));
    const root = path.parse(path.resolve(dir)).root;

    expect(() => assertSafeTargetPath(root, paths)).toThrow(/root/i);
  });

  it('rejects the user home root', async () => {
    const dir = await tempDir();
    const paths = getSkillinkPaths(path.join(dir, 'home'));

    expect(() => assertSafeTargetPath(os.homedir(), paths)).toThrow(/home/i);
  });

  it('detects nested paths case-insensitively on Windows', async () => {
    const parent = path.resolve('C:/Temp/Skillink');
    const child = path.resolve('c:/temp/skillink/project');

    if (process.platform === 'win32') {
      expect(isPathInside(child, parent)).toBe(true);
    }
  });
});
