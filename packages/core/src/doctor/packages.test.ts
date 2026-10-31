import { describe, expect, it } from 'vitest';
import type {
  PackageFile,
  RouteFile,
  SkillFile,
  SkillinkPaths,
} from '@skillink/shared';
import { computePackageIntegrity } from '../package-graph.js';
import type { DoctorContext } from './issues.js';
import { checkPackageUsage } from './packages.js';

const paths = { home: 'C:/home' } as SkillinkPaths;

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

function routeFor(packageFile: PackageFile): RouteFile {
  return {
    schemaVersion: 2,
    targets: [
      {
        id: 'project-a',
        path: 'C:/project/skills',
        mode: 'link',
        enabled: true,
        packages: {
          base: {
            requested: '1.0.0',
            resolved: '1.0.0',
            integrity: computePackageIntegrity(packageFile, [
              { name: 'base', version: '1.0.0' },
            ]),
            enabled: true,
          },
        },
      },
    ],
  };
}

function context(packageFile: PackageFile): DoctorContext {
  return {
    paths,
    route: routeFor(packageFile),
    packageFile,
    skillFile,
  };
}

const nestedPackage: PackageFile = {
  schemaVersion: 2,
  packages: {
    base: {
      versions: {
        '1.0.0': { packages: { nested: '1.0.0' }, skills: {} },
      },
    },
    nested: {
      versions: {
        '1.0.0': { packages: {}, skills: { pdf: '1.0.0' } },
      },
    },
  },
};

const unusedPackage: PackageFile = {
  schemaVersion: 2,
  packages: {
    ...nestedPackage.packages,
    orphan: {
      versions: {
        '1.0.0': { packages: {}, skills: { pdf: '1.0.0' } },
      },
    },
  },
};

describe('checkPackageUsage', () => {
  it('does not report a nested package version as unused', () => {
    const issues = checkPackageUsage(context(nestedPackage));

    expect(
      issues.filter((issue) => issue.code === 'UNUSED_PACKAGE_VERSION'),
    ).toEqual([]);
  });

  it('reports an unused package version', () => {
    const issues = checkPackageUsage(context(unusedPackage));

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'UNUSED_PACKAGE_VERSION',
        name: 'orphan',
        version: '1.0.0',
      }),
    );
  });
});
