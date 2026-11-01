import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillinkPaths,
  type RouteFile,
  type SkillFile,
} from '@skillink/shared';
import { checkSkillContent } from './skills.js';

const tempDirs: string[] = [];

async function tempPaths() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-doctor-skills-'));
  tempDirs.push(dir);
  return getSkillinkPaths(dir);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const emptyRoute: RouteFile = { schemaVersion: 2, targets: [] };
const emptyPackages = { schemaVersion: 2 as const, packages: {} };

const skillFile: SkillFile = {
  schemaVersion: 2,
  skills: {
    pdf: {
      versions: {
        '1.0.0': {
          integrity: 'sha256-pdf',
          fileCount: 1,
          size: 1,
          built: false,
        },
      },
    },
  },
};

describe('checkSkillContent', () => {
  it('reports missing skill content', async () => {
    const paths = await tempPaths();

    const issues = await checkSkillContent({
      paths,
      route: emptyRoute,
      packageFile: emptyPackages,
      skillFile,
    });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_CONTENT', name: 'pdf' }),
    );
  });

  it('reports orphan content', async () => {
    const paths = await tempPaths();
    await mkdir(path.join(paths.libraryDir, 'orphan', '1.0.0'), {
      recursive: true,
    });
    await writeFile(
      path.join(paths.libraryDir, 'orphan', '1.0.0', 'SKILL.md'),
      '# orphan',
      'utf8',
    );

    const issues = await checkSkillContent({
      paths,
      route: emptyRoute,
      packageFile: emptyPackages,
      skillFile: { schemaVersion: 2, skills: {} },
    });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'ORPHAN_CONTENT', name: 'orphan' }),
    );
  });
});
