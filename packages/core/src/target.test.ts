import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { addTarget, removeTarget, setTargetEnabled } from './target.js';
import { readRouteFile } from './route.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup() {
  const root = await tempDir('skillink-target-');
  const paths = getSkillinkPaths(path.join(root, 'home'));
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  return { root, paths, targetPath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('targets', () => {
  it('adds a target with an empty package route', async () => {
    const { paths, targetPath } = await setup();

    const target = await addTarget({
      paths,
      id: 'project-a',
      label: 'Project A',
      path: targetPath,
      mode: 'link',
    });

    expect(target).toMatchObject({
      id: 'project-a',
      path: targetPath,
      mode: 'link',
      packages: {},
    });
    const route = await readRouteFile(paths);
    expect(route.targets).toHaveLength(1);
  });

  it('expands a tilde in a target path', async () => {
    const { paths } = await setup();

    const target = await addTarget({
      paths,
      id: 'home-target',
      path: '~/skillink-target-expansion',
    });

    expect(target.path).toBe(
      path.join(os.homedir(), 'skillink-target-expansion'),
    );
  });

  it('generates a target id when omitted', async () => {
    const { paths, targetPath } = await setup();

    const target = await addTarget({
      paths,
      label: 'My Project',
      path: targetPath,
    });

    expect(target.id).toMatch(/^my-project/);
  });

  it('rejects duplicate target ids', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });

    await expect(
      addTarget({
        paths,
        id: 'project-a',
        path: path.join(path.dirname(targetPath), 'other'),
      }),
    ).rejects.toThrow(/target/i);
  });

  it('rejects target ids that collide case-insensitively', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'Project-A', path: targetPath });

    await expect(
      addTarget({
        paths,
        id: 'project-a',
        path: path.join(path.dirname(targetPath), 'other'),
      }),
    ).rejects.toMatchObject({ code: 'TARGET_EXISTS' });
  });

  it('rejects duplicate target paths', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });

    await expect(
      addTarget({ paths, id: 'project-b', path: targetPath }),
    ).rejects.toThrow(/target/i);
  });

  it('rejects nested target paths', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });

    await expect(
      addTarget({
        paths,
        id: 'project-b',
        path: path.join(targetPath, 'nested'),
      }),
    ).rejects.toMatchObject({ code: 'TARGET_EXISTS' });
    await expect(
      addTarget({
        paths,
        id: 'project-c',
        path: path.dirname(targetPath),
      }),
    ).rejects.toMatchObject({ code: 'TARGET_EXISTS' });
  });

  it('rejects a target inside the control plane', async () => {
    const { paths } = await setup();

    await expect(
      addTarget({
        paths,
        id: 'bad',
        path: path.join(paths.home, 'target'),
      }),
    ).rejects.toThrow(/control plane/i);
  });

  it('enables and disables a target with history', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });

    const disabled = await setTargetEnabled(paths, 'project-a', false);

    expect(disabled.enabled).toBe(false);
    expect((await readRouteFile(paths)).targets[0]?.enabled).toBe(false);

    const enabled = await setTargetEnabled(paths, 'project-a', true);
    expect(enabled.enabled).toBe(true);

    await expect(
      setTargetEnabled(paths, 'missing', false),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  });

  it('removes a target without deleting the target directory', async () => {
    const { paths, targetPath } = await setup();
    await writeFile(path.join(targetPath, 'keep.txt'), 'keep', 'utf8');
    await addTarget({ paths, id: 'project-a', path: targetPath });

    await expect(
      removeTarget({ paths, id: 'project-a' }),
    ).resolves.toMatchObject({ id: 'project-a' });
    await expect(
      readFile(path.join(targetPath, 'keep.txt'), 'utf8'),
    ).resolves.toBe('keep');
    const route = await readRouteFile(paths);
    expect(route.targets).toHaveLength(0);
  });
});
