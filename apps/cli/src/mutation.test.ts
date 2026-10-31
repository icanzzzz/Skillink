import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import {
  ensureControlRepo,
  ensureSkillsRepo,
  gitAddAll,
  gitCommit,
  gitHead,
  gitLog,
  gitStatus,
  isGitAvailable,
} from '@skillink/core';
import { withCliMutation } from './mutation.js';

const gitReady = await isGitAvailable();

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-mutation-'));
  tempDirs.push(dir);
  return dir;
}

async function seededHome() {
  const paths = getSkillinkPaths(await tempHome());
  await ensureControlRepo(paths);
  await ensureSkillsRepo(paths);
  await writeFile(paths.routeFile, '{"schemaVersion":2,"targets":[]}', 'utf8');
  await writeFile(
    paths.packageFile,
    '{"schemaVersion":2,"packages":{}}',
    'utf8',
  );
  await writeFile(paths.skillFile, '{"schemaVersion":2,"skills":{}}', 'utf8');
  await gitAddAll(paths, 'control');
  await gitCommit(paths, 'control', 'skillink(init): initialize control plane');
  await gitAddAll(paths, 'skills');
  await gitCommit(paths, 'skills', 'skillink(skills): initialize skills');
  return paths;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!gitReady)('CLI mutations', () => {
  it('rejects a dirty control repository before a mutation', async () => {
    const paths = await seededHome();
    await writeFile(paths.routeFile, '{"schemaVersion":2,"targets":[9]}', 'utf8');

    await expect(
      withCliMutation(
        {
          paths,
          commandPath: 'skill tag',
          argv: ['skill', 'tag', 'pdf@1.0.0', 'latest'],
          action: 'tag',
          summary: 'pdf@1.0.0 as latest',
        },
        async () => 'never',
      ),
    ).rejects.toMatchObject({
      code: 'GIT_DIRTY',
      message: expect.stringMatching(/route\.json[\s\S]*git -C/),
    });
  });

  it('commits skills before the control plane', async () => {
    const paths = await seededHome();

    await withCliMutation(
      {
        paths,
        commandPath: 'skill add',
        argv: ['skill', 'add', 'pdf'],
        action: 'add',
        summary: 'pdf@1.0.0',
        skills: true,
      },
      async () => {
        await mkdir(path.join(paths.libraryDir, 'pdf', '1.0.0'), {
          recursive: true,
        });
        await writeFile(
          path.join(paths.libraryDir, 'pdf', '1.0.0', 'SKILL.md'),
          '# pdf',
          'utf8',
        );
        await writeFile(
          paths.skillFile,
          JSON.stringify({ schemaVersion: 2, skills: { pdf: { versions: {} } } }),
          'utf8',
        );
      },
    );

    const skillsLog = await gitLog(paths, 'skills');
    const controlLog = await gitLog(paths, 'control');
    expect(skillsLog[0]?.reason).toBe('skillink(skills): add pdf@1.0.0');
    expect(controlLog[0]?.reason).toBe('skillink(skill): add pdf@1.0.0');
    expect(await gitStatus(paths, 'control')).toEqual([]);
    expect(await gitStatus(paths, 'skills')).toEqual([]);
  });

  it('skips commits for read-only mutations but still locks', async () => {
    const paths = await seededHome();

    await withCliMutation(
      {
        paths,
        commandPath: 'apply',
        argv: ['apply'],
        action: 'apply',
        summary: '',
        commit: false,
      },
      async () => {
        await writeFile(
          paths.routeFile,
          '{"schemaVersion":2,"targets":[7]}',
          'utf8',
        );
      },
    );

    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(init): initialize control plane',
    );
    expect(await gitStatus(paths, 'control')).not.toEqual([]);
  });

  it('does not commit when the mutation fails', async () => {
    const paths = await seededHome();
    const before = await gitHead(paths, 'control');

    await expect(
      withCliMutation(
        {
          paths,
          commandPath: 'skill add',
          argv: ['skill', 'add', 'pdf'],
          action: 'add',
          summary: 'pdf@1.0.0',
          skills: true,
        },
        async () => {
          await writeFile(
            paths.routeFile,
            '{"schemaVersion":2,"targets":[7]}',
            'utf8',
          );
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    expect(await gitHead(paths, 'control')).toBe(before);
  });
});
