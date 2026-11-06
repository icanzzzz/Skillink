import { describe, expect, it } from 'vitest';
import {
  buildAddTargetArgs,
  buildApplyArgs,
  buildControlPlaneAddArgs,
  buildControlPlaneListArgs,
  buildControlPlaneUseArgs,
  buildCreatePackageArgs,
  buildGcArgs,
  buildImportSkillArgs,
  buildLanguageInstallArgs,
  buildLanguageRemoveArgs,
  buildLanguageUseArgs,
  buildRouteAddArgs,
  buildScanSkillsArgs,
  buildTargetModeArgs,
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

  it('maps target mode requests', () => {
    expect(buildTargetModeArgs({ id: 'project-a', mode: 'copy' })).toEqual([
      'target',
      'mode',
      'project-a',
      'copy',
      '--json',
    ]);
  });

  it('maps apply options', () => {
    expect(
      buildApplyArgs({
        dryRun: true,
        targetId: 'project-a',
      }),
    ).toEqual([
      'apply',
      '--dry-run',
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
      buildScanSkillsArgs({ sourceDir: 'C:/Skills/collection' }),
    ).toEqual(['skill', 'scan', 'C:/Skills/collection', '--json']);
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

  it('maps control plane requests', () => {
    expect(buildControlPlaneListArgs()).toEqual(['control-plane', 'list', '--json']);
    expect(buildControlPlaneAddArgs({ path: 'C:/Users/Test User/plane' })).toEqual([
      'control-plane',
      'add',
      'C:/Users/Test User/plane',
      '--json',
    ]);
    expect(buildControlPlaneUseArgs({ path: 'C:/Users/Test User/plane' })).toEqual([
      'control-plane',
      'use',
      'C:/Users/Test User/plane',
      '--json',
    ]);
  });
});
