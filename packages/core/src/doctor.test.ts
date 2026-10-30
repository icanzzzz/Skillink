import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { doctor } from './doctor.js';
import { importFolder } from './import-folder.js';
import { addRouteEntry, readRouteFile, writeRouteFile } from './route.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup() {
  const root = await tempDir('skillink-doctor-');
  const home = path.join(root, 'home');
  const source = path.join(root, 'source');
  const targetPath = path.join(root, 'project', 'packages');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
  await mkdir(targetPath, { recursive: true });
  const imported = await importFolder({
    sourceDir: source,
    name: 'demo',
    version: '1.0.0',
    home,
  });
  const paths = getSkillinkPaths(home);
  await addTarget({ paths, id: 'project-a', path: targetPath, mode: 'link' });
  await addRouteEntry({ paths, targetId: 'project-a', name: 'demo', requested: '1.0.0' });
  return { paths, imported, targetPath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('doctor', () => {
  it('reports a missing library content directory', async () => {
    const { paths, imported } = await setup();
    await rm(imported.path, { recursive: true, force: true });

    const report = await doctor({ paths });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_CONTENT', name: 'demo' }),
      ]),
    );
  });

  it('reports an orphan library directory', async () => {
    const { paths } = await setup();
    await mkdir(path.join(paths.libraryDir, 'orphan', '1.0.0'), { recursive: true });

    const report = await doctor({ paths });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ORPHAN_CONTENT', name: 'orphan' }),
      ]),
    );
  });

  it('reports a route reference missing from the library catalog', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.skills.ghost = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha512-ghost',
      source: 'skills/ghost/1.0.0',
      enabled: true,
    };
    await writeRouteFile(paths, route);

    const report = await doctor({ paths });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ROUTE_MISSING_VERSION', name: 'ghost' }),
      ]),
    );
  });
});
