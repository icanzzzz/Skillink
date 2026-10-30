import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSkillDir, getSkillinkPaths } from './paths.js';

describe('Skillink paths', () => {
  it('builds the three global config files and the skill library', () => {
    const home = 'C:/tmp/skillink-home';
    const paths = getSkillinkPaths(home);
    const resolvedHome = path.resolve(home);

    expect(paths.home).toBe(resolvedHome);
    expect(paths.packageFile).toBe(path.join(resolvedHome, 'package.json'));
    expect(paths.skillFile).toBe(path.join(resolvedHome, 'skill.json'));
    expect(paths.routeFile).toBe(path.join(resolvedHome, 'route.json'));
    expect(paths.libraryDir).toBe(path.join(resolvedHome, 'skills'));
  });

  it('expands a home-relative control plane path', () => {
    expect(getSkillinkPaths('~').home).toBe(path.resolve(os.homedir()));
  });

  it('builds a skill version directory', () => {
    const paths = getSkillinkPaths('C:/tmp/skillink-home');

    expect(getSkillDir(paths, 'pdf', '1.0.0')).toBe(
      path.join(paths.libraryDir, 'pdf', '1.0.0'),
    );
  });

  it('rejects unsafe skill name and version segments', () => {
    const paths = getSkillinkPaths('C:/tmp/skillink-home');

    expect(() => getSkillDir(paths, '../victim', '1.0.0')).toThrowError(
      /unsafe/i,
    );
    expect(() => getSkillDir(paths, 'pdf', '..')).toThrowError(/unsafe/i);
  });
});
