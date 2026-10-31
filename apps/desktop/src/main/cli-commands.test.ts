import { describe, expect, it } from 'vitest';
import {
  buildAddTargetArgs,
  buildApplyArgs,
  buildCopyPackageArgs,
  buildCreatePackageArgs,
  buildGcArgs,
  buildImportSkillArgs,
  buildLanguageInstallArgs,
  buildLanguageRemoveArgs,
  buildLanguageUseArgs,
  buildRouteAddArgs,
} from './cli-commands.js';

describe('CLI argv builders', () => {
  it('keeps a Windows path with spaces as one argument', () => {
    expect(
      buildAddTargetArgs({
        path: 'C:/Users/Test User/Project Skills',
        id: 'project-a',
        mode: 'link',
      }),
    ).toEqual([
      'target',
      'add',
      'C:/Users/Test User/Project Skills',
      '--id',
      'project-a',
      '--mode',
      'link',
      '--json',
    ]);
  });

  it('maps apply options', () => {
    expect(
      buildApplyArgs({
        dryRun: true,
        prune: true,
        targetId: 'project-a',
      }),
    ).toEqual([
      'apply',
      '--dry-run',
      '--prune',
      '--target',
      'project-a',
      '--json',
    ]);
    expect(buildApplyArgs({})).toEqual(['apply', '--json']);
  });

  it('maps package dependencies to variadic options', () => {
    expect(
      buildCreatePackageArgs({
        name: 'frontend',
        version: '1.0.0',
        skills: { pdf: '1.0.0', review: '2.0.0' },
        packages: { base: '2.0.0' },
      }),
    ).toEqual([
      'package',
      'create',
      'frontend@1.0.0',
      '--skill',
      'pdf@1.0.0',
      'review@2.0.0',
      '--package',
      'base@2.0.0',
      '--json',
    ]);

    expect(
      buildCopyPackageArgs({
        sourceName: 'frontend',
        sourceVersion: '1.0.0',
        targetName: 'frontend',
        targetVersion: '1.1.0',
        skillOverrides: { pdf: '1.1.0' },
        dropSkills: ['review'],
      }),
    ).toEqual([
      'package',
      'copy',
      'frontend@1.0.0',
      'frontend@1.1.0',
      '--skill',
      'pdf@1.1.0',
      '--drop-skill',
      'review',
      '--json',
    ]);
  });

  it('maps import, route, and gc options', () => {
    expect(
      buildImportSkillArgs({
        sourceDir: 'C:/Skills/pdf',
        name: 'pdf',
        version: '1.0.0',
      }),
    ).toEqual([
      'skill',
      'add',
      'C:/Skills/pdf',
      '--name',
      'pdf',
      '--version',
      '1.0.0',
      '--json',
    ]);
    expect(
      buildRouteAddArgs({
        targetId: 'project-a',
        name: 'demo',
        requested: '^1.0.0',
      }),
    ).toEqual(['route', 'add', 'project-a', 'demo@^1.0.0', '--json']);
    expect(
      buildGcArgs({ dryRun: false, maxAgeDays: 30, keepTagged: false }),
    ).toEqual([
      'gc',
      '--apply',
      '--max-age-days',
      '30',
      '--no-keep-tagged',
      '--json',
    ]);
  });

  it('builds language pack commands', () => {
    expect(
      buildLanguageInstallArgs({
        path: 'C:/packs/zh-CN.json',
        use: true,
        force: true,
      }),
    ).toEqual([
      'locale',
      'install',
      'C:/packs/zh-CN.json',
      '--force',
      '--use',
    ]);
    expect(buildLanguageUseArgs('zh-CN')).toEqual(['locale', 'use', 'zh-CN']);
    expect(buildLanguageRemoveArgs('zh-CN')).toEqual([
      'locale',
      'remove',
      'zh-CN',
    ]);
  });
});
