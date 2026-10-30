import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { importFolder } from './import-folder.js';
import {
  addRouteEntry,
  readRouteFile,
  removeRouteEntry,
  resolveLibraryVersion,
} from './route.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function seedLibrary(home: string): Promise<void> {
  const source = await tempDir('skillink-route-source-');
  await writeFile(path.join(source, 'file.txt'), 'same content', 'utf8');

  for (const version of ['1.0.0', '1.1.0', '1.2.0']) {
    await importFolder({ sourceDir: source, name: 'demo', version, home });
  }
}

async function setup() {
  const root = await tempDir('skillink-route-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'packages');
  await mkdir(targetPath, { recursive: true });
  await seedLibrary(home);
  const paths = getSkillinkPaths(home);
  await addTarget({
    paths,
    id: 'project-a',
    label: 'Project A',
    path: targetPath,
    mode: 'link',
  });
  return { root, home, targetPath, paths };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('route entries', () => {
  it('adds an exact version and records integrity/source', async () => {
    const { paths } = await setup();

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.0.0',
    });

    expect(lock.resolved).toBe('1.0.0');
    expect(lock.source).toBe('skills/demo/1.0.0');
    expect(lock.integrity).toMatch(/^sha512-/);

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.skills.demo?.resolved).toBe('1.0.0');
  });

  it('resolves a semver range to the highest matching version', async () => {
    const { paths } = await setup();

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '^1.0.0',
    });

    expect(lock.requested).toBe('^1.0.0');
    expect(lock.resolved).toBe('1.2.0');
  });

  it('resolves a tag from skills.json', async () => {
    const { paths } = await setup();
    const library = await import('./library.js').then((module) =>
      module.readSkillsFile(paths),
    );
    library.packages.demo = {
      ...library.packages.demo!,
      tags: { stable: '1.1.0' },
    };
    const { writeSkillsFile } = await import('./library.js');
    await writeSkillsFile(paths, library);

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: 'stable',
    });

    expect(lock.resolved).toBe('1.1.0');
  });

  it('rejects a missing version', async () => {
    const { paths } = await setup();

    await expect(
      addRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'demo',
        requested: '9.9.9',
      }),
    ).rejects.toThrow(/version/i);
  });

  it('rejects a missing package', async () => {
    const { paths } = await setup();

    await expect(
      addRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'missing',
        requested: '1.0.0',
      }),
    ).rejects.toThrow(/package/i);
  });

  it('removes a route entry without touching the target directory', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.0.0',
    });

    await expect(
      removeRouteEntry({ paths, targetId: 'project-a', name: 'demo' }),
    ).resolves.toBe(true);
    const route = await readRouteFile(paths);
    expect(route.targets[0]?.skills.demo).toBeUndefined();
  });

  it('exposes version resolution for inspection', async () => {
    const { paths } = await setup();
    const { readSkillsFile } = await import('./library.js');
    const library = await readSkillsFile(paths);

    expect(resolveLibraryVersion(library, 'demo', '~1.1.0')).toEqual({
      version: '1.1.0',
      entry: expect.objectContaining({
        source: 'skills/demo/1.1.0',
      }),
    });
  });
});
