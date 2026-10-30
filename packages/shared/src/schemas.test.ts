import { describe, expect, it } from 'vitest';
import { RouteFileSchema, SkillsFileSchema } from './schemas.js';

describe('skills file schema', () => {
  it('parses a minimal library with one package version', () => {
    const parsed = SkillsFileSchema.parse({
      schemaVersion: 1,
      packages: {
        demo: {
          kind: 'folder',
          versions: {
            '1.0.0': {
              integrity: 'sha512-abc',
              source: 'skills/demo/1.0.0',
              fileCount: 2,
              size: 12,
              built: false,
            },
          },
        },
      },
    });

    expect(parsed.packages.demo?.versions['1.0.0']?.source).toBe('skills/demo/1.0.0');
  });

  it('rejects a version without integrity', () => {
    const result = SkillsFileSchema.safeParse({
      schemaVersion: 1,
      packages: {
        demo: {
          versions: {
            '1.0.0': {
              source: 'skills/demo/1.0.0',
              fileCount: 2,
              size: 12,
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('route file schema', () => {
  it('parses a target with an exact package lock', () => {
    const parsed = RouteFileSchema.parse({
      schemaVersion: 1,
      targets: [
        {
          id: 'project-a',
          label: 'Project A',
          path: 'C:/Projects/ProjectA/packages',
          mode: 'link',
          skills: {
            demo: {
              requested: '1.0.0',
              resolved: '1.0.0',
              integrity: 'sha512-abc',
              source: 'skills/demo/1.0.0',
            },
          },
        },
      ],
    });

    expect(parsed.targets[0]?.skills.demo?.resolved).toBe('1.0.0');
  });

  it('rejects an unknown target mode', () => {
    const result = RouteFileSchema.safeParse({
      schemaVersion: 1,
      targets: [
        {
          id: 'project-a',
          path: 'C:/Projects/ProjectA/packages',
          mode: 'hardlink-everything',
          skills: {},
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
