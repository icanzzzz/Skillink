import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkillinkError, getSkillinkPaths } from '@skillink/shared';
import { resolveSkillinkPaths } from './paths.js';

describe('resolveSkillinkPaths', () => {
  it('prefers explicit paths over home', () => {
    const paths = getSkillinkPaths('C:/explicit');
    expect(resolveSkillinkPaths({ paths, home: 'C:/ignored' })).toBe(paths);
  });

  it('builds paths from an explicit home', () => {
    expect(resolveSkillinkPaths({ home: 'C:/planes/a' }).home).toBe(
      path.resolve('C:/planes/a'),
    );
  });

  it('rejects a missing control plane', () => {
    try {
      resolveSkillinkPaths({});
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillinkError);
      expect((error as SkillinkError).code).toBe('CONTROL_PLANE_REQUIRED');
    }
  });
});
