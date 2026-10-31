import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillDir, getSkillinkPaths } from '@skillink/shared';
import { importSkill } from './import-skill.js';
import { verifySkillIntegrity } from './skill-integrity.js';
import { readSkillFile, writeSkillFile } from './skill-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeSource(withSkillMd = true): Promise<string> {
  const source = await tempDir('skillink-skill-source-');
  if (withSkillMd) {
    await writeFile(
      path.join(source, 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill\n---\n',
      'utf8',
    );
  }
  await writeFile(path.join(source, 'notes.txt'), 'hello world', 'utf8');
  await writeFile(path.join(source, '.hidden'), 'secret', 'utf8');
  await mkdir(path.join(source, 'nested'));
  await writeFile(path.join(source, 'nested', 'data.txt'), 'nested', 'utf8');
  await mkdir(path.join(source, 'empty'));
  return source;
}

async function makeNamedSource(folderName: string): Promise<string> {
  const root = await tempDir('skillink-skill-source-');
  const source = path.join(root, folderName);
  await mkdir(source, { recursive: true });
  await writeFile(
    path.join(source, 'SKILL.md'),
    '---\nname: demo\ndescription: Demo skill\n---\n',
    'utf8',
  );
  return source;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('importSkill', () => {
  it('rejects a folder without a root SKILL.md and writes nothing', async () => {
    const source = await makeSource(false);
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_MD_REQUIRED' });

    expect(await pathExists(paths.skillFile)).toBe(false);
    expect(await pathExists(getSkillDir(paths, 'demo', '1.0.0'))).toBe(false);
  });

  it('rejects an import that exceeds configured limits without writing content', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
        limits: { maxFiles: 2 },
      }),
    ).rejects.toMatchObject({
      code: 'IMPORT_LIMIT_EXCEEDED',
      details: expect.objectContaining({ maxFiles: 2 }),
    });

    expect(await pathExists(paths.skillFile)).toBe(false);
    expect(await pathExists(getSkillDir(paths, 'demo', '1.0.0'))).toBe(false);
  });

  it('rejects skill names that collide case-insensitively', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');

    await importSkill({
      sourceDir: source,
      name: 'Demo',
      version: '1.0.0',
      home,
    });

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_EXISTS' });
  });

  it('imports a folder with SKILL.md and records it in skill.json', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    const result = await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect(result).toMatchObject({
      name: 'demo',
      version: '1.0.0',
      created: true,
      fileCount: 4,
    });
    expect(result.path).toBe(getSkillDir(paths, 'demo', '1.0.0'));

    const skillFile = await readSkillFile(paths);
    expect(skillFile.skills.demo?.versions['1.0.0']?.integrity).toMatch(
      /^sha512-/,
    );
    expect(skillFile.skills.demo?.versions['1.0.0']).not.toHaveProperty(
      'source',
    );

    await expect(
      readFile(path.join(result.path, 'notes.txt'), 'utf8'),
    ).resolves.toBe('hello world');
    await expect(
      readFile(path.join(result.path, '.hidden'), 'utf8'),
    ).resolves.toBe('secret');
    expect((await stat(path.join(result.path, 'empty'))).isDirectory()).toBe(
      true,
    );
    expect((await lstat(result.path)).isDirectory()).toBe(true);
  });

  it('records frontmatter description and metadata', async () => {
    const source = await tempDir('skillink-skill-source-');
    await writeFile(
      path.join(source, 'SKILL.md'),
      `---
name: pdf
description: PDF tools
metadata:
  author: Skillink
  featured: true
---

# PDF tools
`,
      'utf8',
    );
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await importSkill({
      sourceDir: source,
      name: 'pdf',
      version: '1.0.0',
      home,
    });

    const entry = (await readSkillFile(paths)).skills.pdf;
    expect(entry?.description).toBe('PDF tools');
    expect(entry?.versions['1.0.0']?.metadata).toEqual({
      name: 'pdf',
      author: 'Skillink',
      featured: 'true',
    });
  });

  it('fills missing display metadata when the same version is reused', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    const skillFile = await readSkillFile(paths);
    delete skillFile.skills.demo?.description;
    await writeSkillFile(paths, skillFile);

    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect((await readSkillFile(paths)).skills.demo?.description).toBe(
      'Demo skill',
    );
  });

  it('rejects re-import when the library copy was tampered with', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);
    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    await writeFile(
      path.join(getSkillDir(paths, 'demo', '1.0.0'), 'notes.txt'),
      'tampered',
      'utf8',
    );

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_INTEGRITY_MISMATCH' });
  });

  it('preserves directory modes so imported content matches its integrity', async () => {
    const source = await makeSource();
    const nested = path.join(source, 'nested');
    await chmod(nested, 0o555);
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    try {
      await importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      });

      const expected = (await readSkillFile(paths)).skills.demo?.versions[
        '1.0.0'
      ];
      expect(expected).toBeDefined();
      const result = await verifySkillIntegrity(
        paths,
        'demo',
        '1.0.0',
        expected!,
      );
      expect(result.ok).toBe(true);
    } finally {
      await chmod(nested, 0o755).catch(() => undefined);
    }
  });

  it('expands environment variables in the source path', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const previous = process.env.SKILLINK_IMPORT_TEST;
    process.env.SKILLINK_IMPORT_TEST = source;
    try {
      const result = await importSkill({
        sourceDir: '%SKILLINK_IMPORT_TEST%',
        name: 'demo',
        version: '1.0.0',
        home,
      });

      expect(result.path).toBe(
        getSkillDir(getSkillinkPaths(home), 'demo', '1.0.0'),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SKILLINK_IMPORT_TEST;
      } else {
        process.env.SKILLINK_IMPORT_TEST = previous;
      }
    }
  });

  it('reuses the same version when content is unchanged', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');

    const first = await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    const second = await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.integrity).toBe(first.integrity);
  });

  it('rejects reuse when the existing content is missing', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    await rm(getSkillDir(paths, 'demo', '1.0.0'), {
      recursive: true,
      force: true,
    });

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('rejects reuse when the existing content has no SKILL.md', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    await rm(path.join(getSkillDir(paths, 'demo', '1.0.0'), 'SKILL.md'));

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_MD_MISSING' });
  });

  it('rejects a different content snapshot under the same version', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');

    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });
    await writeFile(path.join(source, 'notes.txt'), 'changed', 'utf8');

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toThrow(/already exists|different content/i);
  });

  it('derives the name and version from a name@version folder name', async () => {
    const source = await makeNamedSource('demo@1.2.0');
    const home = await tempDir('skillink-skill-home-');

    const result = await importSkill({ sourceDir: source, home });

    expect(result).toMatchObject({
      name: 'demo',
      version: '1.2.0',
      created: true,
    });
  });

  it('lets explicit values override parts of the folder name', async () => {
    const source = await makeNamedSource('demo@1.2.0');
    const home = await tempDir('skillink-skill-home-');

    const result = await importSkill({
      sourceDir: source,
      name: 'pdf',
      version: '2.0.0',
      home,
    });

    expect(result).toMatchObject({ name: 'pdf', version: '2.0.0' });
  });

  it('keeps the folder-name and auto-version fallbacks for incomplete folder names', async () => {
    const source = await makeNamedSource('demo');
    const home = await tempDir('skillink-skill-home-');

    const result = await importSkill({ sourceDir: source, home });

    expect(result.name).toBe('demo');
    expect(result.version).toMatch(/^0\.0\.0\+[0-9a-f]{8}$/);
  });

  it('uses a version from a version-only folder name when the name is supplied', async () => {
    const source = await makeNamedSource('@1.2.0');
    const home = await tempDir('skillink-skill-home-');

    const result = await importSkill({
      sourceDir: source,
      name: 'demo',
      home,
    });

    expect(result).toMatchObject({ name: 'demo', version: '1.2.0' });
  });

  it('generates an auto version when version is omitted', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');

    const result = await importSkill({
      sourceDir: source,
      name: 'demo',
      home,
    });

    expect(result.version).toMatch(/^0\.0\.0\+[0-9a-f]{8}$/);
  });

  it('rejects directory links inside the source folder with their path', async () => {
    const source = await makeSource();
    const target = await tempDir('skillink-skill-symlink-target-');
    const linkPath = path.join(source, 'linked');
    await symlink(
      target,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const home = await tempDir('skillink-skill-home-');

    await expect(
      importSkill({
        sourceDir: source,
        name: 'demo',
        version: '1.0.0',
        home,
      }),
    ).rejects.toMatchObject({
      code: 'UNSAFE_PATH',
      details: {
        path: linkPath,
        relativePath: 'linked',
      },
    });
  });

  it('does not create package.json or route.json', async () => {
    const source = await makeSource();
    const home = await tempDir('skillink-skill-home-');
    const paths = getSkillinkPaths(home);

    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home,
    });

    expect(await pathExists(paths.packageFile)).toBe(false);
    expect(await pathExists(paths.routeFile)).toBe(false);
  });
});
