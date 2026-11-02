import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type TargetMode,
} from '@skillink/shared';
import { createDirectoryLink } from './links.js';
import {
  addTarget,
  removeTarget,
  setTargetEnabled,
  setTargetMode,
} from './target.js';
import {
  addRouteEntry,
  readRouteFile,
  setPackageEnabled,
  writeRouteFile,
} from './route.js';
import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';

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

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function createTargetWithPackage() {
  const { root, paths, targetPath } = await setup();
  const source = await tempDir('skillink-target-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'pdf',
    version: '1.0.0',
    home: paths.home,
  });
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });
  await addTarget({ paths, id: 'project-a', path: targetPath });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'frontend',
    requested: '1.0.0',
  });
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

  it('adds a copy target', async () => {
    const { paths, targetPath } = await setup();

    const target = await addTarget({
      paths,
      id: 'copy-target',
      path: targetPath,
      mode: 'copy',
    });

    expect(target).toMatchObject({
      id: 'copy-target',
      path: targetPath,
      mode: 'copy',
    });
    expect((await readRouteFile(paths)).targets).toEqual([
      expect.objectContaining({ id: 'copy-target', mode: 'copy' }),
    ]);
  });

  it('rejects an unknown target mode', async () => {
    const { paths, targetPath } = await setup();

    await expect(
      addTarget({
        paths,
        id: 'bad-target',
        path: targetPath,
        mode: 'zip' as TargetMode,
      }),
    ).rejects.toMatchObject({ code: 'ROUTE_INVALID' });

    expect((await readRouteFile(paths)).targets).toEqual([]);
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

  it('expands environment variables in a target path', async () => {
    const { root, paths } = await setup();
    const previous = process.env.SKILLINK_TARGET_TEST;
    process.env.SKILLINK_TARGET_TEST = root;
    try {
      const target = await addTarget({
        paths,
        id: 'env-target',
        path: '%SKILLINK_TARGET_TEST%/env-target',
      });

      expect(target.path).toBe(path.join(root, 'env-target'));
    } finally {
      if (previous === undefined) {
        delete process.env.SKILLINK_TARGET_TEST;
      } else {
        process.env.SKILLINK_TARGET_TEST = previous;
      }
    }
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

  it('enables and disables a target', async () => {
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

  it('switches a target mode between link and copy', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });

    const copied = await setTargetMode(paths, 'project-a', 'copy');

    expect(copied.mode).toBe('copy');
    expect((await readRouteFile(paths)).targets[0]?.mode).toBe('copy');

    const linked = await setTargetMode(paths, 'project-a', 'link');

    expect(linked.mode).toBe('link');
    expect((await readRouteFile(paths)).targets[0]?.mode).toBe('link');
  });

  it('rejects switching an unknown target mode', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });

    await expect(
      setTargetMode(paths, 'project-a', 'zip' as TargetMode),
    ).rejects.toMatchObject({ code: 'ROUTE_INVALID' });

    expect((await readRouteFile(paths)).targets[0]?.mode).toBe('link');
  });

  it('rejects switching the mode of a missing target', async () => {
    const { paths } = await setup();

    await expect(
      setTargetMode(paths, 'missing', 'copy'),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  });

  it('deletes route-resolved entries when disabling a target', async () => {
    const { paths, targetPath } = await createTargetWithPackage();
    const linkPath = path.join(targetPath, 'pdf');
    await createDirectoryLink(
      getSkillDir(paths, 'pdf', '1.0.0'),
      linkPath,
    );

    await setTargetEnabled(paths, 'project-a', false);

    expect(await pathExists(linkPath)).toBe(false);
    expect(await pathExists(targetPath)).toBe(true);
    expect(
      (await readRouteFile(paths)).targets[0]?.enabled,
    ).toBe(false);
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

  it('removes resolved skill directories even when they are not managed links', async () => {
    const { paths, targetPath } = await createTargetWithPackage();

    // 故意创建真实目录，证明 route 解析结果优先于实际条目来源。
    await mkdir(path.join(targetPath, 'pdf'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'pdf', 'note.txt'),
      'copy',
      'utf8',
    );
    await mkdir(path.join(targetPath, 'extra'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'extra', 'note.txt'),
      'keep',
      'utf8',
    );
    await writeFile(path.join(targetPath, 'keep.txt'), 'keep', 'utf8');

    await removeTarget({ paths, id: 'project-a' });

    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
    expect(
      await readFile(path.join(targetPath, 'extra', 'note.txt'), 'utf8'),
    ).toBe('keep');
    expect(await readFile(path.join(targetPath, 'keep.txt'), 'utf8')).toBe(
      'keep',
    );
    expect(await pathExists(targetPath)).toBe(true);
    expect(await pathExists(getSkillDir(paths, 'pdf', '1.0.0'))).toBe(true);
    expect((await readRouteFile(paths)).targets).toEqual([]);
  });

  it('includes disabled targets and disabled package locks in cleanup', async () => {
    const { paths, targetPath } = await createTargetWithPackage();
    await setTargetEnabled(paths, 'project-a', false);
    await setPackageEnabled(paths, 'project-a', 'frontend', false);

    await mkdir(path.join(targetPath, 'pdf'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'pdf', 'note.txt'),
      'copy',
      'utf8',
    );

    await removeTarget({ paths, id: 'project-a' });

    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
    expect((await readRouteFile(paths)).targets).toEqual([]);
  });

  it('does not remove the target when route packages cannot be resolved', async () => {
    const { paths, targetPath } = await createTargetWithPackage();
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.frontend!.resolved = '9.9.9';
    await writeRouteFile(paths, route);

    await mkdir(path.join(targetPath, 'pdf'), { recursive: true });

    await expect(
      removeTarget({ paths, id: 'project-a' }),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });

    expect((await readRouteFile(paths)).targets).toHaveLength(1);
    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(true);
  });
});
