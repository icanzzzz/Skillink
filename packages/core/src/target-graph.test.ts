import { describe, expect, it } from 'vitest';
import type {
  PackageFile,
  SkillFile,
  TargetRoute,
} from '@skillink/shared';
import {
  checkTargetPackageLocks,
  resolveTarget,
  resolveTargetGraph,
} from './target-graph.js';
import { computePackageIntegrity } from './package-graph.js';

const skillFile: SkillFile = {
  schemaVersion: 2,
  skills: {
    pdf: {
      versions: {
        '1.0.0': { integrity: 'sha256-pdf-1', fileCount: 1, size: 1, built: false },
        '2.0.0': { integrity: 'sha256-pdf-2', fileCount: 1, size: 1, built: false },
      },
    },
    review: {
      versions: {
        '1.0.0': { integrity: 'sha256-review-1', fileCount: 1, size: 1, built: false },
      },
    },
  },
};

const packageFile: PackageFile = {
  schemaVersion: 2,
  packages: {
    base: {
      versions: {
        '1.0.0': { packages: {}, skills: { pdf: '1.0.0' } },
      },
    },
    ui: {
      versions: {
        '1.0.0': { packages: {}, skills: { review: '1.0.0' } },
      },
    },
    conflicting: {
      versions: {
        '1.0.0': { packages: {}, skills: { pdf: '2.0.0' } },
      },
    },
  },
};

const target: TargetRoute = {
  id: 'project-a',
  path: 'C:/Projects/ProjectA/skills',
  mode: 'link',
  enabled: true,
  packages: {
    base: {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-stale',
      enabled: true,
    },
    ui: {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-stale',
      enabled: false,
    },
  },
};

const conflictingTarget: TargetRoute = {
  ...target,
  packages: {
    base: {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-stale',
      enabled: true,
    },
    conflicting: {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-stale',
      enabled: true,
    },
  },
};

describe('target graph', () => {
  it('reports every invalid lock without throwing', () => {
    const checks = checkTargetPackageLocks(packageFile, target, {
      includeDisabled: true,
    });

    expect(checks.map((check) => check.name)).toEqual(['base', 'ui']);
    expect(checks[1]?.error?.code).toBe('PACKAGE_INTEGRITY_MISMATCH');
  });

  it('returns valid and invalid checks together', () => {
    const validTarget: TargetRoute = {
      ...target,
      packages: {
        base: {
          ...target.packages.base!,
          integrity: computePackageIntegrity(packageFile, [
            { name: 'base', version: '1.0.0' },
          ]),
        },
      },
    };

    const checks = checkTargetPackageLocks(packageFile, validTarget);

    expect(checks.map((check) => check.name)).toEqual(['base']);
    expect(checks[0]?.error).toBeUndefined();
  });

  it('rejects a lock mismatch from resolveTarget', () => {
    expect(() => resolveTarget(packageFile, skillFile, target)).toThrowError(
      expect.objectContaining({ code: 'PACKAGE_INTEGRITY_MISMATCH' }),
    );
  });

  it('excludes disabled packages by default and includes them on request', () => {
    expect([
      ...resolveTargetGraph(packageFile, skillFile, target).skills.keys(),
    ]).toEqual(['pdf']);
    expect([
      ...resolveTargetGraph(packageFile, skillFile, target, {
        includeDisabledPackages: true,
      }).skills.keys(),
    ]).toEqual(['pdf', 'review']);
  });

  it('propagates skill version conflicts from the target graph', () => {
    expect(() =>
      resolveTargetGraph(packageFile, skillFile, conflictingTarget),
    ).toThrowError(expect.objectContaining({ code: 'SKILL_VERSION_CONFLICT' }));
  });
});
