import { describe, expect, it } from 'vitest';
import {
  PackageFileSchema,
  RouteFileSchema,
  SkillFileSchema,
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
} from './schemas.js';

const skillVersion = {
  integrity: 'sha512-abc',
  fileCount: 2,
  size: 12,
};

describe('skill file schema', () => {
  it('parses a minimal skill catalog and defaults built to false', () => {
    const parsed = SkillFileSchema.parse({
      schemaVersion: 2,
      skills: {
        pdf: {
          description: 'PDF tools',
          tags: { latest: '1.0.0' },
          versions: {
            '1.0.0': skillVersion,
          },
        },
      },
    });

    expect(parsed.skills.pdf?.versions['1.0.0']).toEqual({
      ...skillVersion,
      built: false,
    });
  });

  it('rejects a skill version without integrity', () => {
    const result = SkillFileSchema.safeParse({
      schemaVersion: 2,
      skills: {
        pdf: {
          versions: {
            '1.0.0': {
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

describe('package file schema', () => {
  function packageFile(version: unknown) {
    return {
      schemaVersion: 2,
      packages: {
        frontend: {
          versions: {
            '1.0.0': version,
          },
        },
      },
    };
  }

  it('parses skill-only, package-only, and mixed package versions', () => {
    const skillOnly = PackageFileSchema.parse(
      packageFile({ skills: { pdf: '1.0.0' } }),
    );
    expect(skillOnly.packages.frontend?.versions['1.0.0']).toEqual({
      packages: {},
      skills: { pdf: '1.0.0' },
    });

    const packageOnly = PackageFileSchema.parse(
      packageFile({ packages: { base: '2.0.0' } }),
    );
    expect(packageOnly.packages.frontend?.versions['1.0.0']).toEqual({
      packages: { base: '2.0.0' },
      skills: {},
    });

    const mixed = PackageFileSchema.parse(
      packageFile({
        packages: { base: '2.0.0' },
        skills: { pdf: '1.0.0' },
      }),
    );
    expect(mixed.packages.frontend?.versions['1.0.0']).toEqual({
      packages: { base: '2.0.0' },
      skills: { pdf: '1.0.0' },
    });
  });

  it('rejects a package version with no package or skill dependency', () => {
    const result = PackageFileSchema.safeParse(
      packageFile({ packages: {}, skills: {} }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('at least one');
    }
  });

  it('rejects a package entry with no versions', () => {
    const result = PackageFileSchema.safeParse({
      schemaVersion: 2,
      packages: {
        frontend: {
          versions: {},
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('at least one version');
    }
  });
});

describe('route file schema', () => {
  it('parses a target with package locks', () => {
    const parsed = RouteFileSchema.parse({
      schemaVersion: 2,
      targets: [
        {
          id: 'project-a',
          label: 'Project A',
          path: 'C:/Projects/ProjectA/skills',
          mode: 'link',
          packages: {
            frontend: {
              requested: '^1.0.0',
              resolved: '1.0.0',
              integrity: 'sha256-abc',
            },
          },
        },
      ],
    });

    expect(parsed.targets[0]?.packages.frontend).toEqual({
      requested: '^1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-abc',
      enabled: true,
    });
  });

  it('rejects the old skills key without packages', () => {
    const result = RouteFileSchema.safeParse({
      schemaVersion: 2,
      targets: [
        {
          id: 'project-a',
          path: 'C:/Projects/ProjectA/skills',
          mode: 'link',
          skills: {},
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown target mode', () => {
    const result = RouteFileSchema.safeParse({
      schemaVersion: 2,
      targets: [
        {
          id: 'project-a',
          path: 'C:/Projects/ProjectA/skills',
          mode: 'hardlink-everything',
          packages: {},
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe('empty config constructors', () => {
  it('creates empty v2 configs', () => {
    expect(createEmptySkillFile()).toEqual({ schemaVersion: 2, skills: {} });
    expect(createEmptyPackageFile()).toEqual({ schemaVersion: 2, packages: {} });
    expect(createEmptyRouteFile()).toEqual({ schemaVersion: 2, targets: [] });
  });
});
