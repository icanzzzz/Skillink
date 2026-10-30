import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { apply } from './apply.js';
import { importSkill } from './import-skill.js';
import { computePackageIntegrity } from './package-graph.js';
import {
  createPackageVersion,
  readPackageFile,
} from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
  removeRouteEntry,
  writeRouteFile,
} from './route.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function importSkillVersion(
  home: string,
  name: string,
  version: string,
): Promise<void> {
  const source = await tempDir(`skillink-apply-source-${name}-${version}-`);
  await writeFile(path.join(source, 'SKILL.md'), `# ${name} ${version}`, 'utf8');
  await writeFile(
    path.join(source, 'content.txt'),
    `${name}@${version}`,
    'utf8',
  );
  await importSkill({ sourceDir: source, name, version, home });
}

async function setup(): Promise<{
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-apply-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  const paths = getSkillinkPaths(home);

  await importSkillVersion(home, 'pdf', '1.0.0');
  await importSkillVersion(home, 'pdf', '1.1.0');
  await importSkillVersion(home, 'review', '1.0.0');
  await importSkillVersion(home, 'docs', '1.0.0');

  for (const [name, version, skills] of [
    ['pdf-pack', '1.0.0', { pdf: '1.0.0' }],
    ['pdf-pack', '1.1.0', { pdf: '1.1.0' }],
    ['pdf-new', '1.0.0', { pdf: '1.1.0' }],
    ['pdf-old', '1.0.0', { pdf: '1.0.0' }],
    ['combo', '1.0.0', { pdf: '1.0.0', review: '1.0.0' }],
    ['base', '1.0.0', { review: '1.0.0' }],
    ['docs-pack', '1.0.0', { docs: '1.0.0', review: '1.0.0' }],
    ['same', '1.0.0', { pdf: '1.0.0' }],
  ] as const) {
    await createPackageVersion({
      paths,
      name,
      version,
      skills,
    });
  }
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    packages: { base: '1.0.0' },
    skills: { pdf: '1.0.0' },
  });
  await addTarget({
    paths,
    id: 'project-a',
    path: targetPath,
    mode: 'link',
  });

  return { paths, targetPath };
}

async function linkTarget(linkPath: string): Promise<string> {
  return path.resolve(path.dirname(linkPath), await readlink(linkPath));
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('apply', () => {
  it('projects every skill in a package composition', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });

    const report = await apply({ paths });

    expect(report.ok).toBe(true);
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'create-link', name: 'pdf' }),
        expect.objectContaining({ kind: 'create-link', name: 'review' }),
      ]),
    );
    expect((await lstat(path.join(targetPath, 'pdf'))).isSymbolicLink()).toBe(
      true,
    );
    expect(
      (await lstat(path.join(targetPath, 'review'))).isSymbolicLink(),
    ).toBe(true);
    await expect(lstat(path.join(targetPath, 'combo'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('projects skills through nested packages', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    await apply({ paths });

    expect((await lstat(path.join(targetPath, 'pdf'))).isSymbolicLink()).toBe(
      true,
    );
    expect(
      (await lstat(path.join(targetPath, 'review'))).isSymbolicLink(),
    ).toBe(true);
    await expect(
      lstat(path.join(targetPath, 'frontend')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deduplicates the same skill version required by multiple packages', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'same',
      requested: '1.0.0',
    });

    const report = await apply({ paths });

    const pdfCreates = report.operations.filter(
      (operation) =>
        operation.kind === 'create-link' && operation.name === 'pdf',
    );
    expect(pdfCreates).toHaveLength(1);
    expect((await lstat(path.join(targetPath, 'pdf'))).isSymbolicLink()).toBe(
      true,
    );
  });

  it('rejects different versions of the same skill without changing the target', async () => {
    const { paths, targetPath } = await setup();
    const packageFile = await readPackageFile(paths);
    const route = await readRouteFile(paths);
    const target = route.targets[0]!;
    target.packages['pdf-new'] = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: computePackageIntegrity(packageFile, [
        { name: 'pdf-new', version: '1.0.0' },
      ]),
      enabled: true,
    };
    target.packages['pdf-old'] = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: computePackageIntegrity(packageFile, [
        { name: 'pdf-old', version: '1.0.0' },
      ]),
      enabled: true,
    };
    await writeRouteFile(paths, route);

    await expect(apply({ paths })).rejects.toMatchObject({
      code: 'SKILL_VERSION_CONFLICT',
    });
    await expect(lstat(path.join(targetPath, 'pdf'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not change the target on dry-run', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });

    const report = await apply({ paths, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'create-link', name: 'pdf' }),
      ]),
    );
    await expect(lstat(path.join(targetPath, 'pdf'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('skips links that already point at the correct skill version', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    await apply({ paths });

    const report = await apply({ paths });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skip', name: 'pdf' }),
        expect.objectContaining({ kind: 'skip', name: 'review' }),
      ]),
    );
  });

  it('replaces a managed skill link when the package version changes', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.1.0',
    });

    const report = await apply({ paths });

    expect(report.ok).toBe(true);
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'replace-link',
          name: 'pdf',
          version: '1.1.0',
        }),
      ]),
    );
    expect(await linkTarget(path.join(targetPath, 'pdf'))).toBe(
      getSkillDir(paths, 'pdf', '1.1.0'),
    );
  });

  it('prunes only managed skills that are no longer required', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    await removeRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs-pack',
    });

    const report = await apply({ paths, prune: true });

    expect(report.ok).toBe(true);
    await expect(lstat(path.join(targetPath, 'docs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(lstat(path.join(targetPath, 'review'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(path.join(targetPath, 'pdf'))).isSymbolicLink()).toBe(
      true,
    );
  });

  it('reports an unmanaged folder conflict without deleting it', async () => {
    const { paths, targetPath } = await setup();
    const conflictPath = path.join(targetPath, 'pdf');
    await mkdir(conflictPath);
    await writeFile(path.join(conflictPath, 'keep.txt'), 'keep', 'utf8');
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });

    const report = await apply({ paths });

    expect(report.ok).toBe(false);
    expect(report.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', path: conflictPath }),
      ]),
    );
    await expect(
      writeFile(path.join(conflictPath, 'keep.txt'), 'still here', 'utf8'),
    ).resolves.toBeUndefined();
  });

  it('rejects a route whose skill content is missing', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await rm(getSkillDir(paths, 'pdf', '1.0.0'), {
      recursive: true,
      force: true,
    });

    await expect(apply({ paths })).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });
});
