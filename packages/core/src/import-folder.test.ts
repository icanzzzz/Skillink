import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { importFolder } from './import-folder.js';
import { readSkillsFile } from './library.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeSource(): Promise<string> {
  const source = await tempDir('skillink-source-');
  await writeFile(path.join(source, 'notes.txt'), 'hello world', 'utf8');
  await writeFile(path.join(source, '.hidden'), 'secret', 'utf8');
  await mkdir(path.join(source, 'nested'));
  await writeFile(path.join(source, 'nested', 'data.txt'), 'nested', 'utf8');
  await mkdir(path.join(source, 'empty'));
  return source;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('importFolder', () => {
  it('imports an arbitrary folder without SKILL.md', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-home-');
    const paths = getSkillinkPaths(home);

    const result = await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect(result).toMatchObject({
      name: 'demo',
      version: '1.0.0',
      created: true,
      kind: 'folder',
      fileCount: 3,
    });
    expect(result.size).toBeGreaterThan(0);
    expect(result.path).toBe(path.join(paths.libraryDir, 'demo', '1.0.0'));

    const library = await readSkillsFile(paths);
    expect(library.packages.demo?.kind).toBe('folder');
    expect(library.packages.demo?.versions['1.0.0']?.source).toBe(
      'skills/demo/1.0.0',
    );

    await expect(
      readFile(path.join(result.path, 'notes.txt'), 'utf8'),
    ).resolves.toBe('hello world');
    await expect(
      readFile(path.join(result.path, '.hidden'), 'utf8'),
    ).resolves.toBe('secret');
    expect((await stat(path.join(result.path, 'empty'))).isDirectory()).toBe(true);
    await expect(readFile(path.join(paths.home, 'route.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('marks a folder containing SKILL.md as a skill without validating it', async () => {
    const source = await makeSource();
    await writeFile(path.join(source, 'SKILL.md'), '---\nname: demo\n---\n', 'utf8');
    const home = await tempDir('skillink-home-');

    const result = await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect(result.kind).toBe('skill');
  });

  it('reuses the same version when content is unchanged', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-home-');

    const first = await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    const second = await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.integrity).toBe(first.integrity);
  });

  it('rejects a different content snapshot under the same version', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-home-');

    await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    await writeFile(path.join(source, 'notes.txt'), 'changed', 'utf8');

    await expect(
      importFolder({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toThrow(/already exists|different content/i);
  });

  it('generates an auto version when version is omitted', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-home-');

    const result = await importFolder({
      sourceDir: source,
      name: 'demo',
      home,
    });

    expect(result.version).toMatch(/^0\.0\.0\+[0-9a-f]{8}$/);
  });

  it('rejects symlinks inside the source folder', async () => {
    const source = await makeSource();
    const target = await tempDir('skillink-symlink-target-');
    await symlink(
      target,
      path.join(source, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const home = await tempDir('skillink-home-');

    await expect(
      importFolder({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toThrow(/symbolic link|symlink/i);
  });
});
