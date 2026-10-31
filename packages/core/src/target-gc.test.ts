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
import { getSkillinkPaths, type TargetRoute } from '@skillink/shared';
import { createDirectoryLink } from './links.js';
import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';
import {
  gcTargetEntries,
  resolvePackageSkillNames,
  resolveTargetActiveSkillNames,
  resolveTargetSkillNames,
} from './target-gc.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function setup() {
  const root = await tempDir('skillink-target-gc-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });

  const source = await tempDir('skillink-target-gc-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'pdf',
    version: '1.0.0',
    home,
  });

  const paths = getSkillinkPaths(home);
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });

  const target: TargetRoute = {
    id: 'project-a',
    path: targetPath,
    mode: 'link',
    enabled: true,
    packages: {
      frontend: {
        requested: '1.0.0',
        resolved: '1.0.0',
        integrity: 'sha256-test',
        enabled: false,
      },
    },
  };

  return { root, paths, target, targetPath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('target GC', () => {
  it('resolves skills from all package locks including disabled locks', async () => {
    const { paths, target } = await setup();

    await expect(resolveTargetSkillNames({ paths, target })).resolves.toEqual([
      'pdf',
    ]);
  });

  it('resolves one package closure for route-change cleanup', async () => {
    const { paths, target } = await setup();
    await createPackageVersion({
      paths,
      name: 'nested',
      version: '1.0.0',
      packages: { frontend: '1.0.0' },
    });

    await expect(
      resolvePackageSkillNames({
        paths,
        packageRef: { name: 'frontend', version: '1.0.0' },
      }),
    ).resolves.toEqual(['pdf']);
    await expect(
      resolvePackageSkillNames({
        paths,
        packageRef: { name: 'nested', version: '1.0.0' },
      }),
    ).resolves.toEqual(['pdf']);
    expect(target.packages.frontend?.enabled).toBe(false);
  });

  it('resolves only enabled package locks as active target skills', async () => {
    const { paths, target } = await setup();
    const enabledTarget: TargetRoute = {
      ...target,
      packages: {
        frontend: { ...target.packages.frontend!, enabled: true },
      },
    };

    await expect(
      resolveTargetActiveSkillNames({ paths, target }),
    ).resolves.toEqual([]);
    await expect(
      resolveTargetActiveSkillNames({ paths, target: enabledTarget }),
    ).resolves.toEqual(['pdf']);
    await expect(
      resolveTargetActiveSkillNames({
        paths,
        target: { ...enabledTarget, enabled: false },
      }),
    ).resolves.toEqual([]);
  });

  it('deletes resolved directory links and real directories but skips files', async () => {
    const { paths, target, targetPath } = await setup();
    const librarySkill = path.join(paths.libraryDir, 'pdf', '1.0.0');

    await createDirectoryLink(librarySkill, path.join(targetPath, 'pdf'));
    await mkdir(path.join(targetPath, 'review'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'review', 'note.txt'),
      'delete',
      'utf8',
    );
    await writeFile(path.join(targetPath, 'review-note'), 'keep', 'utf8');
    await createDirectoryLink(
      librarySkill,
      path.join(targetPath, 'extra-link'),
    );
    await mkdir(path.join(targetPath, 'extra'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'extra', 'note.txt'),
      'keep',
      'utf8',
    );

    const removed = await gcTargetEntries({
      paths,
      target,
      skillNames: ['pdf', 'review', 'review-note'],
    });

    expect(removed).toEqual(['pdf', 'review']);
    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
    expect(await pathExists(path.join(targetPath, 'review'))).toBe(false);
    expect(await pathExists(path.join(targetPath, 'extra-link'))).toBe(true);
    expect(await readFile(path.join(targetPath, 'review-note'), 'utf8')).toBe(
      'keep',
    );
    expect(
      await readFile(path.join(targetPath, 'extra', 'note.txt'), 'utf8'),
    ).toBe('keep');
    expect(await pathExists(path.join(librarySkill, 'SKILL.md'))).toBe(true);
    expect(await pathExists(targetPath)).toBe(true);
  });

  it('does not traverse links inside a real skill directory', async () => {
    const { paths, target, targetPath } = await setup();
    const librarySkill = path.join(paths.libraryDir, 'pdf', '1.0.0');

    await mkdir(path.join(targetPath, 'review'), { recursive: true });
    await createDirectoryLink(
      librarySkill,
      path.join(targetPath, 'review', 'pdf-link'),
    );

    await expect(
      gcTargetEntries({
        paths,
        target,
        skillNames: ['review'],
      }),
    ).resolves.toEqual(['review']);
    expect(await pathExists(path.join(librarySkill, 'SKILL.md'))).toBe(true);
  });

  it('returns an empty list when the target directory is missing', async () => {
    const { paths, target, targetPath } = await setup();
    await rm(targetPath, { recursive: true, force: true });

    await expect(
      gcTargetEntries({ paths, target, skillNames: ['pdf'] }),
    ).resolves.toEqual([]);
  });
});
