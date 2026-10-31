import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanSkillPackages } from './skill-scan.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makePackage(
  root: string,
  relativeDir: string,
  frontmatter?: string,
): Promise<string> {
  const packageDir = path.join(root, relativeDir);
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'SKILL.md'),
    frontmatter ?? '# Skill',
    'utf8',
  );
  return packageDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('scanSkillPackages', () => {
  it('finds packages recursively and ignores folders without SKILL.md', async () => {
    const root = await tempDir('skillink-scan-');
    const alpha = await makePackage(
      root,
      'alpha@1.0.0',
      '---\nname: ignored\ndescription: Alpha tools\n---\n',
    );
    const beta = await makePackage(root, 'beta');
    const gamma = await makePackage(root, 'nested/gamma');
    await mkdir(path.join(root, 'plain'));
    await writeFile(path.join(root, 'plain', 'notes.txt'), 'not a skill');

    const report = await scanSkillPackages(root);

    expect(report.rootDir).toBe(path.resolve(root));
    expect(report.packages).toEqual([
      {
        sourceDir: alpha,
        name: 'alpha',
        version: '1.0.0',
        description: 'Alpha tools',
        directoryLinks: [],
      },
      {
        sourceDir: beta,
        name: 'beta',
        directoryLinks: [],
      },
      {
        sourceDir: gamma,
        name: 'gamma',
        directoryLinks: [],
      },
    ]);
  });

  it('stops at the first SKILL.md boundary so nested skills stay package content', async () => {
    const root = await tempDir('skillink-scan-');
    const outer = await makePackage(root, 'outer');
    await makePackage(outer, 'inner');

    const report = await scanSkillPackages(root);

    expect(report.packages).toEqual([
      {
        sourceDir: outer,
        name: 'outer',
        directoryLinks: [],
      },
    ]);
  });

  it('falls back to SKILL.md frontmatter when the folder has no skill name', async () => {
    const root = await tempDir('skillink-scan-');
    const source = await makePackage(
      root,
      '@1.2.0',
      '---\nname: from-frontmatter\ndescription: From frontmatter\n---\n',
    );

    const report = await scanSkillPackages(root);

    expect(report.packages).toEqual([
      {
        sourceDir: source,
        name: 'from-frontmatter',
        version: '1.2.0',
        description: 'From frontmatter',
        directoryLinks: [],
      },
    ]);
  });

  it('reports directory links without following or recursing into them', async () => {
    const root = await tempDir('skillink-scan-');
    const source = await makePackage(root, 'linked');
    const target = await makePackage(
      await tempDir('skillink-scan-target-'),
      'target',
    );
    const link = path.join(source, 'assets');
    await symlink(
      target,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const report = await scanSkillPackages(root);

    expect(report.packages).toHaveLength(1);
    expect(report.packages[0]).toMatchObject({
      sourceDir: source,
      directoryLinks: [path.resolve(link)],
    });
  });

  it('returns an empty package list when no SKILL.md exists', async () => {
    const root = await tempDir('skillink-scan-');
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'notes.txt'), 'plain');

    await expect(scanSkillPackages(root)).resolves.toEqual({
      rootDir: path.resolve(root),
      packages: [],
    });
  });

  it('rejects source paths that are not safe import sources', async () => {
    const root = await tempDir('skillink-scan-');
    const missing = path.join(root, 'missing');

    await expect(scanSkillPackages(missing)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
  });
});
