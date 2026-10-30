import {
  lstat,
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
import { runCli, type CliContext } from './index.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function context(home: string): CliContext & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    home,
    out,
    err,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
}

async function makeSkillSource(withSkillMd = true): Promise<string> {
  const source = await tempDir('skillink-cli-source-');
  if (withSkillMd) {
    await writeFile(path.join(source, 'SKILL.md'), '# demo', 'utf8');
  }
  await writeFile(path.join(source, 'file.txt'), 'hello', 'utf8');
  return source;
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, any>;
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

describe('CLI', () => {
  it('prints help and exits zero', async () => {
    const ctx = context(await tempDir('skillink-cli-'));

    const code = await runCli(['--help'], ctx);

    expect(code).toBe(0);
    expect(ctx.out.join('\n')).toContain('Usage');
  });

  it('initializes the three global config files', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);

    expect(await runCli(['init'], ctx)).toBe(0);

    for (const name of ['route.json', 'package.json', 'skill.json']) {
      expect(await pathExists(path.join(home, name))).toBe(true);
    }
    expect(await readJson(path.join(home, 'route.json'))).toEqual({
      schemaVersion: 2,
      targets: [],
    });
  });

  it('rejects a skill folder without SKILL.md', async () => {
    const home = await tempDir('skillink-cli-');
    const source = await makeSkillSource(false);
    const ctx = context(home);
    await runCli(['init'], ctx);

    expect(
      await runCli(
        ['skill', 'add', source, '--name', 'demo', '--version', '1.0.0'],
        ctx,
      ),
    ).toBe(1);
    expect(ctx.err.join('\n')).toContain('SKILL_MD_REQUIRED');
  });

  it('imports a skill and supports the top-level add alias', async () => {
    const home = await tempDir('skillink-cli-');
    const source = await makeSkillSource();
    const ctx = context(home);
    await runCli(['init'], ctx);

    expect(
      await runCli(['add', source, '--name', 'demo', '--version', '1.0.0'], ctx),
    ).toBe(0);

    const skillFile = await readJson(path.join(home, 'skill.json'));
    expect(skillFile.skills.demo.versions['1.0.0']).toBeDefined();
    expect(skillFile.skills.demo.versions['1.0.0'].source).toBeUndefined();
  });

  it('runs the skill -> package -> route -> apply workflow', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = await makeSkillSource();
    const targetPath = path.join(root, 'target');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    await runCli(['init'], ctx);
    expect(
      await runCli(
        ['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'],
        ctx,
      ),
    ).toBe(0);
    expect(
      await runCli(
        ['package', 'create', 'demo@1.0.0', '--skill', 'pdf@1.0.0'],
        ctx,
      ),
    ).toBe(0);
    expect(
      await runCli(
        ['target', 'add', targetPath, '--id', 'project-a'],
        ctx,
      ),
    ).toBe(0);
    expect(await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx)).toBe(
      0,
    );
    expect(await runCli(['apply'], ctx)).toBe(0);

    expect((await lstat(path.join(targetPath, 'pdf'))).isSymbolicLink()).toBe(
      true,
    );
    await expect(lstat(path.join(targetPath, 'demo'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const routeFile = await readJson(path.join(home, 'route.json'));
    expect(routeFile.targets[0].packages.demo.resolved).toBe('1.0.0');

    ctx.out.length = 0;
    expect(await runCli(['status', '--json'], ctx)).toBe(0);
    const status = JSON.parse(ctx.out.join('\n')) as {
      entries: Array<{ name: string; state: string }>;
    };
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'ok' }),
      ]),
    );
  });

  it('copies a package with a skill override', async () => {
    const home = await tempDir('skillink-cli-');
    const source = await makeSkillSource();
    const ctx = context(home);

    await runCli(['init'], ctx);
    await runCli(
      ['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'],
      ctx,
    );
    await runCli(
      ['skill', 'add', source, '--name', 'pdf', '--version', '1.1.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'demo@1.0.0', '--skill', 'pdf@1.0.0'],
      ctx,
    );

    expect(
      await runCli(
        [
          'package',
          'copy',
          'demo@1.0.0',
          'demo@1.1.0',
          '--skill',
          'pdf@1.1.0',
        ],
        ctx,
      ),
    ).toBe(0);

    const packageFile = await readJson(path.join(home, 'package.json'));
    expect(
      packageFile.packages.demo.versions['1.1.0'].skills.pdf,
    ).toBe('1.1.0');
  });

  it('parses repeated skill/package options and drop options', async () => {
    const home = await tempDir('skillink-cli-');
    const source = await makeSkillSource();
    const ctx = context(home);

    await runCli(['init'], ctx);
    for (const name of ['pdf', 'review']) {
      await runCli(
        ['skill', 'add', source, '--name', name, '--version', '1.0.0'],
        ctx,
      );
    }
    await runCli(
      ['package', 'create', 'base@1.0.0', '--skill', 'review@1.0.0'],
      ctx,
    );

    expect(
      await runCli(
        [
          'package',
          'create',
          'frontend@1.0.0',
          '--skill',
          'pdf@1.0.0',
          '--skill',
          'review@1.0.0',
          '--package',
          'base@1.0.0',
        ],
        ctx,
      ),
    ).toBe(0);

    const packageFile = await readJson(path.join(home, 'package.json'));
    expect(packageFile.packages.frontend.versions['1.0.0']).toEqual({
      packages: { base: '1.0.0' },
      skills: { pdf: '1.0.0', review: '1.0.0' },
    });

    expect(
      await runCli(
        [
          'package',
          'copy',
          'frontend@1.0.0',
          'frontend@1.1.0',
          '--drop-skill',
          'review',
          '--drop-package',
          'base',
        ],
        ctx,
      ),
    ).toBe(0);

    const copied = await readJson(path.join(home, 'package.json'));
    expect(copied.packages.frontend.versions['1.1.0']).toEqual({
      packages: {},
      skills: { pdf: '1.0.0' },
    });
  });

  it('rejects a skill version conflict at route add', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = await makeSkillSource();
    const targetPath = path.join(root, 'target');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    await runCli(['init'], ctx);
    for (const version of ['1.0.0', '1.1.0']) {
      await runCli(
        ['skill', 'add', source, '--name', 'pdf', '--version', version],
        ctx,
      );
    }
    await runCli(
      ['package', 'create', 'old@1.0.0', '--skill', 'pdf@1.0.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'new@1.0.0', '--skill', 'pdf@1.1.0'],
      ctx,
    );
    await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);
    await runCli(['route', 'add', 'project-a', 'old@1.0.0'], ctx);

    expect(await runCli(['route', 'add', 'project-a', 'new@1.0.0'], ctx)).toBe(
      1,
    );
    expect(ctx.err.join('\n')).toContain('SKILL_VERSION_CONFLICT');

    const routeFile = await readJson(path.join(home, 'route.json'));
    expect(routeFile.targets[0].packages.old).toBeDefined();
    expect(routeFile.targets[0].packages.new).toBeUndefined();
  });

  it('enables and disables targets and route packages', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = await makeSkillSource();
    const targetPath = path.join(root, 'target');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    await runCli(['init'], ctx);
    await runCli(
      ['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'pdf-pack@1.0.0', '--skill', 'pdf@1.0.0'],
      ctx,
    );
    await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);
    await runCli(['route', 'add', 'project-a', 'pdf-pack@1.0.0'], ctx);

    expect(await runCli(['target', 'disable', 'project-a'], ctx)).toBe(0);
    expect((await readJson(path.join(home, 'route.json'))).targets[0].enabled).toBe(
      false,
    );
    expect(await runCli(['target', 'enable', 'project-a'], ctx)).toBe(0);
    expect((await readJson(path.join(home, 'route.json'))).targets[0].enabled).toBe(
      true,
    );

    expect(
      await runCli(['route', 'disable', 'project-a', 'pdf-pack'], ctx),
    ).toBe(0);
    expect(
      (await readJson(path.join(home, 'route.json'))).targets[0].packages[
        'pdf-pack'
      ].enabled,
    ).toBe(false);
    expect(
      await runCli(['route', 'enable', 'project-a', 'pdf-pack'], ctx),
    ).toBe(0);
    expect(
      (await readJson(path.join(home, 'route.json'))).targets[0].packages[
        'pdf-pack'
      ].enabled,
    ).toBe(true);
  });

  it('rejects route remove when the remaining graph is invalid unless --force is used', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = await makeSkillSource();
    const targetPath = path.join(root, 'target');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    await runCli(['init'], ctx);
    await runCli(
      ['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'old@1.0.0', '--skill', 'pdf@1.0.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'new@1.0.0', '--skill', 'pdf@1.0.0'],
      ctx,
    );
    await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);
    await runCli(['route', 'add', 'project-a', 'old@1.0.0'], ctx);
    await runCli(['route', 'add', 'project-a', 'new@1.0.0'], ctx);

    const packagePath = path.join(home, 'package.json');
    const packageFile = await readJson(packagePath);
    packageFile.packages.old.versions['1.0.0'].skills.pdf = '9.9.9';
    await writeFile(packagePath, JSON.stringify(packageFile), 'utf8');

    expect(await runCli(['route', 'remove', 'project-a', 'new'], ctx)).toBe(1);
    expect(ctx.err.join('\n')).toContain('ROUTE_INVALID');
    await expect(
      readJson(path.join(home, 'route.json')),
    ).resolves.toMatchObject({
      targets: [
        {
          packages: {
            new: expect.anything(),
          },
        },
      ],
    });

    expect(
      await runCli(['route', 'remove', 'project-a', 'new', '--force'], ctx),
    ).toBe(0);
    const routeFile = await readJson(path.join(home, 'route.json'));
    expect(routeFile.targets[0].packages.new).toBeUndefined();
  });

  it('tags and removes skill and package versions', async () => {
    const home = await tempDir('skillink-cli-');
    const source = await makeSkillSource();
    const ctx = context(home);

    await runCli(['init'], ctx);
    for (const version of ['1.0.0', '1.1.0']) {
      await runCli(
        ['skill', 'add', source, '--name', 'demo', '--version', version],
        ctx,
      );
    }
    expect(await runCli(['skill', 'tag', 'demo@1.1.0', 'latest'], ctx)).toBe(0);
    expect(await runCli(['skill', 'remove', 'demo@1.0.0'], ctx)).toBe(0);

    const skillFile = await readJson(path.join(home, 'skill.json'));
    expect(skillFile.skills.demo.versions['1.0.0']).toBeUndefined();
    expect(skillFile.skills.demo.tags.latest).toBe('1.1.0');

    await runCli(
      ['package', 'create', 'demo-pack@1.0.0', '--skill', 'demo@1.1.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'demo-pack@1.1.0', '--skill', 'demo@1.1.0'],
      ctx,
    );
    expect(
      await runCli(['package', 'tag', 'demo-pack@1.0.0', 'stable'], ctx),
    ).toBe(0);
    expect(
      await runCli(['package', 'remove', 'demo-pack@1.0.0'], ctx),
    ).toBe(0);

    const packageFile = await readJson(path.join(home, 'package.json'));
    expect(packageFile.packages['demo-pack'].versions['1.0.0']).toBeUndefined();
    expect(packageFile.packages['demo-pack'].tags?.stable).toBeUndefined();
  });

  it('lists history and rolls back all three config files', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = await makeSkillSource();
    const targetPath = path.join(root, 'target');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    await runCli(['init'], ctx);
    await runCli(
      ['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'],
      ctx,
    );
    await runCli(
      ['package', 'create', 'demo@1.0.0', '--skill', 'pdf@1.0.0'],
      ctx,
    );
    await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);

    ctx.out.length = 0;
    expect(await runCli(['history', '--json'], ctx)).toBe(0);
    const entries = JSON.parse(ctx.out.join('\n')) as Array<{ id: string }>;
    const snapshotId = entries[0]!.id;

    await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx);
    expect(
      (await readJson(path.join(home, 'route.json'))).targets[0].packages.demo,
    ).toBeDefined();

    expect(await runCli(['rollback', snapshotId, '--apply'], ctx)).toBe(0);
    const restoredRoute = await readJson(path.join(home, 'route.json'));
    expect(restoredRoute.targets).toEqual([]);
  });

  it('runs gc as a dry run by default and applies with --apply', async () => {
    const home = await tempDir('skillink-cli-');
    const source = await makeSkillSource();
    const ctx = context(home);

    await runCli(['init'], ctx);
    await runCli(
      ['skill', 'add', source, '--name', 'demo', '--version', '1.0.0'],
      ctx,
    );

    ctx.out.length = 0;
    expect(
      await runCli(['gc', '--max-age-days', '0', '--json'], ctx),
    ).toBe(0);
    const dryRun = JSON.parse(ctx.out.join('\n')) as {
      dryRun: boolean;
      candidates: Array<{ name: string }>;
    };
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.candidates).toEqual([
      expect.objectContaining({ name: 'demo' }),
    ]);

    ctx.out.length = 0;
    expect(
      await runCli(['gc', '--apply', '--max-age-days', '0', '--json'], ctx),
    ).toBe(0);
    const applied = JSON.parse(ctx.out.join('\n')) as {
      removed: Array<{ name: string }>;
    };
    expect(applied.removed).toEqual([expect.objectContaining({ name: 'demo' })]);
    await expect(
      lstat(path.join(home, 'skills', 'demo', '1.0.0')),
    ).rejects.toThrow();
  });

  it('migrates v1 data and refuses entries without SKILL.md', async () => {
    const home = await tempDir('skillink-cli-');
    const contentDir = path.join(home, 'skills', 'demo', '1.0.0');
    await mkdir(contentDir, { recursive: true });
    await writeFile(path.join(contentDir, 'SKILL.md'), '# demo', 'utf8');
    await writeFile(
      path.join(home, 'skills.json'),
      JSON.stringify({
        schemaVersion: 1,
        packages: {
          demo: {
            versions: {
              '1.0.0': {
                integrity: 'sha512-demo',
                source: 'skills/demo/1.0.0',
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
      path.join(home, 'route.json'),
      JSON.stringify({
        schemaVersion: 1,
        targets: [
          {
            id: 'project-a',
            path: 'C:/tmp/project-a',
            mode: 'link',
            skills: {
              demo: {
                requested: '1.0.0',
                resolved: '1.0.0',
                integrity: 'sha512-demo',
                source: 'skills/demo/1.0.0',
              },
            },
          },
        ],
      }),
      'utf8',
    );
    const ctx = context(home);

    expect(await runCli(['migrate'], ctx)).toBe(0);
    expect(await pathExists(path.join(home, 'skill.json'))).toBe(true);
    expect(await pathExists(path.join(home, 'package.json'))).toBe(true);
    expect(await pathExists(path.join(home, 'skills.json'))).toBe(false);

    const invalidHome = await tempDir('skillink-cli-');
    const invalidContent = path.join(invalidHome, 'skills', 'demo', '1.0.0');
    await mkdir(invalidContent, { recursive: true });
    await writeFile(
      path.join(invalidHome, 'skills.json'),
      JSON.stringify({
        schemaVersion: 1,
        packages: {
          demo: {
            versions: {
              '1.0.0': {
                integrity: 'sha512-demo',
                source: 'skills/demo/1.0.0',
                fileCount: 1,
                size: 1,
              },
            },
          },
        },
      }),
      'utf8',
    );
    const invalidCtx = context(invalidHome);

    expect(await runCli(['migrate'], invalidCtx)).toBe(1);
    expect(invalidCtx.err.join('\n')).toContain('demo');
    expect(await pathExists(path.join(invalidHome, 'skills.json'))).toBe(true);
    expect(await pathExists(path.join(invalidHome, 'skill.json'))).toBe(false);
  });
});
