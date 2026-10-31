import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
import { createDirectoryLink } from './links.js';
import { computePackageIntegrity } from './package-graph.js';
import {
  createPackageVersion,
  readPackageFile,
} from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
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

  it('rejects a migrated copy target before writing links', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    const route = await readRouteFile(paths);
    route.targets[0]!.mode = 'copy';
    await writeRouteFile(paths, route);

    await expect(apply({ paths })).rejects.toMatchObject({
      code: 'COPY_MODE_UNSUPPORTED',
    });
    await expect(lstat(path.join(targetPath, 'pdf'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not create a missing target directory when validation fails', async () => {
    const { paths } = await setup();
    const missingTargetPath = path.join(paths.home, '..', 'not-created');
    await addTarget({
      paths,
      id: 'missing-target',
      path: missingTargetPath,
      mode: 'link',
    });
    const route = await readRouteFile(paths);
    route.targets.find((target) => target.id === 'missing-target')!.packages = {
      broken: {
        requested: '1.0.0',
        resolved: '1.0.0',
        integrity: 'sha256-wrong',
        enabled: true,
      },
    };
    await writeRouteFile(paths, route);

    await expect(apply({ paths })).rejects.toMatchObject({
      code: 'PACKAGE_NOT_FOUND',
    });
    await expect(lstat(missingTargetPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not project earlier targets when a later target fails validation', async () => {
    const { paths, targetPath } = await setup();
    const secondTargetPath = path.join(
      await tempDir('skillink-apply-second-'),
      'skills',
    );
    await addTarget({
      paths,
      id: 'project-b',
      path: secondTargetPath,
      mode: 'link',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs-pack',
      requested: '1.0.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-b',
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
    await expect(lstat(path.join(targetPath, 'docs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(lstat(secondTargetPath)).rejects.toMatchObject({
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

  it('leaves entries outside the route untouched', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    const extraPath = path.join(targetPath, 'review');
    await createDirectoryLink(
      getSkillDir(paths, 'review', '1.0.0'),
      extraPath,
    );

    const report = await apply({ paths });

    expect(report.ok).toBe(true);
    expect((await lstat(extraPath)).isSymbolicLink()).toBe(true);
    expect(await linkTarget(extraPath)).toBe(
      getSkillDir(paths, 'review', '1.0.0'),
    );
  });

  it('replaces a same-name real directory with a managed link', async () => {
    const { paths, targetPath } = await setup();
    const destination = path.join(targetPath, 'pdf');
    await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'keep', 'utf8');
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });

    const report = await apply({ paths });

    expect(report.ok).toBe(true);
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'replace-link', name: 'pdf' }),
      ]),
    );
    const replacement = report.operations.find(
      (operation) => operation.kind === 'replace-link',
    );
    expect(replacement).not.toHaveProperty('previousKind');
    expect(replacement).not.toHaveProperty('previousSourcePath');
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await linkTarget(destination)).toBe(
      getSkillDir(paths, 'pdf', '1.0.0'),
    );
    await expect(
      readFile(path.join(destination, 'keep.txt'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replaces a same-name regular file with a managed link', async () => {
    const { paths, targetPath } = await setup();
    const destination = path.join(targetPath, 'pdf');
    await writeFile(destination, 'not a skill', 'utf8');
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });

    const report = await apply({ paths });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'replace-link', name: 'pdf' }),
      ]),
    );
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await linkTarget(destination)).toBe(
      getSkillDir(paths, 'pdf', '1.0.0'),
    );
  });

  it('replaces a broken link', async () => {
    const { paths, targetPath } = await setup();
    const missing = path.join(
      await tempDir('skillink-apply-missing-link-'),
      'gone',
    );
    await mkdir(missing);
    const destination = path.join(targetPath, 'pdf');
    await createDirectoryLink(missing, destination);
    await rm(missing, { recursive: true, force: true });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });

    const report = await apply({ paths });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'replace-link', name: 'pdf' }),
      ]),
    );
    expect(await linkTarget(destination)).toBe(
      getSkillDir(paths, 'pdf', '1.0.0'),
    );
  });

  it('skips an external link whose content matches the skill', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    const external = path.join(
      await tempDir('skillink-apply-external-identical-'),
      'pdf-copy',
    );
    await cp(getSkillDir(paths, 'pdf', '1.0.0'), external, {
      recursive: true,
    });
    const destination = path.join(targetPath, 'pdf');
    await createDirectoryLink(external, destination);

    const report = await apply({ paths });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skip', name: 'pdf' }),
      ]),
    );
    expect(await linkTarget(destination)).toBe(path.resolve(external));
  });

  it('replaces an external link whose content differs from the skill', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    const external = path.join(
      await tempDir('skillink-apply-external-different-'),
      'pdf-copy',
    );
    await cp(getSkillDir(paths, 'pdf', '1.0.0'), external, {
      recursive: true,
    });
    await writeFile(path.join(external, 'content.txt'), 'changed', 'utf8');
    const destination = path.join(targetPath, 'pdf');
    await createDirectoryLink(external, destination);

    const report = await apply({ paths });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'replace-link', name: 'pdf' }),
      ]),
    );
    expect(await linkTarget(destination)).toBe(
      getSkillDir(paths, 'pdf', '1.0.0'),
    );
  });

  it('does not delete a real directory on dry-run', async () => {
    const { paths, targetPath } = await setup();
    const destination = path.join(targetPath, 'pdf');
    await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'keep', 'utf8');
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });

    const report = await apply({ paths, dryRun: true });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'replace-link', name: 'pdf' }),
      ]),
    );
    expect((await lstat(destination)).isDirectory()).toBe(true);
    await expect(
      readFile(path.join(destination, 'keep.txt'), 'utf8'),
    ).resolves.toBe('keep');
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

  it('rejects a route whose skill content has no SKILL.md', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await rm(path.join(getSkillDir(paths, 'pdf', '1.0.0'), 'SKILL.md'));

    await expect(apply({ paths })).rejects.toMatchObject({
      code: 'SKILL_MD_MISSING',
    });
  });

  it('rejects a route whose skill content was modified after import', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await writeFile(
      path.join(getSkillDir(paths, 'pdf', '1.0.0'), 'content.txt'),
      'tampered',
      'utf8',
    );

    await expect(apply({ paths })).rejects.toMatchObject({
      code: 'SKILL_INTEGRITY_MISMATCH',
      details: expect.objectContaining({
        name: 'pdf',
        version: '1.0.0',
      }),
    });
    await expect(
      lstat(path.join(targetPath, 'pdf')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unsafe skill references before writing outside the target', async () => {
    const { paths, targetPath } = await setup();
    await writeFile(
      paths.skillFile,
      JSON.stringify({
        schemaVersion: 2,
        skills: {
          '../victim': {
            versions: {
              '1.0.0': {
                integrity: 'sha512-x',
                fileCount: 1,
                size: 1,
              },
            },
          },
        },
      }),
      'utf8',
    );
    await writeFile(
      paths.packageFile,
      JSON.stringify({
        schemaVersion: 2,
        packages: {
          frontend: {
            versions: {
              '1.0.0': {
                packages: {},
                skills: { '../victim': '1.0.0' },
              },
            },
          },
        },
      }),
      'utf8',
    );
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.frontend = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-x',
      enabled: true,
    };
    await writeRouteFile(paths, route);

    await expect(apply({ paths })).rejects.toThrow();
    await expect(
      lstat(path.join(targetPath, '..', 'victim')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
