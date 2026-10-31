import { describe, expect, it } from 'vitest';
import {
  AddTargetRequestSchema,
  ApplyRequestSchema,
  CopyPackageRequestSchema,
  CreatePackageRequestSchema,
  GcRequestSchema,
  ImportSkillRequestSchema,
  LanguageInstallRequestSchema,
  LanguageRemoveRequestSchema,
  LanguageUseRequestSchema,
  PackageRemoveRequestSchema,
  PackageTagRequestSchema,
  RollbackRequestSchema,
  RouteAddRequestSchema,
  RouteEnableRequestSchema,
  RouteRemoveRequestSchema,
  ScanSkillsRequestSchema,
  SkillRemoveRequestSchema,
  SkillTagRequestSchema,
  TargetEnableRequestSchema,
  TargetRemoveRequestSchema,
} from './ipc-schemas.js';

describe('IPC request schemas', () => {
  it('accepts a valid skill import request', () => {
    expect(
      ImportSkillRequestSchema.parse({
        sourceDir: 'C:/Projects/example',
        name: 'example',
        version: '1.0.0',
      }),
    ).toEqual({
      sourceDir: 'C:/Projects/example',
      name: 'example',
      version: '1.0.0',
    });
    expect(ImportSkillRequestSchema.safeParse({ name: 'example' }).success).toBe(
      false,
    );
    expect(
      ImportSkillRequestSchema.safeParse({ sourceDir: '' }).success,
    ).toBe(false);
  });

  it('accepts a valid skill scan request', () => {
    expect(
      ScanSkillsRequestSchema.parse({ sourceDir: 'C:/Projects/skills' }),
    ).toEqual({ sourceDir: 'C:/Projects/skills' });
    expect(ScanSkillsRequestSchema.safeParse({ sourceDir: '' }).success).toBe(
      false,
    );
    expect(
      ScanSkillsRequestSchema.safeParse({ sourceDir: 'C:/skills', extra: true })
        .success,
    ).toBe(false);
  });

  it('rejects an invalid target mode', () => {
    expect(
      AddTargetRequestSchema.safeParse({
        path: 'C:/Projects/skills',
        mode: 'hardlink',
      }).success,
    ).toBe(false);
    expect(
      AddTargetRequestSchema.parse({
        path: 'C:/Projects/skills',
        mode: 'link',
      }),
    ).toEqual({
      path: 'C:/Projects/skills',
      mode: 'link',
    });
  });

  it('validates package creation and copy requests', () => {
    expect(
      CreatePackageRequestSchema.parse({
        name: 'frontend',
        version: '1.0.0',
        skills: { pdf: '1.0.0' },
      }),
    ).toEqual({
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
      packages: {},
    });
    expect(
      CreatePackageRequestSchema.safeParse({
        name: 'empty',
        version: '1.0.0',
      }).success,
    ).toBe(false);
    expect(
      CreatePackageRequestSchema.safeParse({
        name: 'frontend',
        version: '1.0.0',
        skills: { pdf: '' },
      }).success,
    ).toBe(false);

    expect(
      CopyPackageRequestSchema.parse({
        sourceName: 'frontend',
        sourceVersion: '1.0.0',
        targetName: 'frontend',
        targetVersion: '1.1.0',
        skillOverrides: { pdf: '1.1.0' },
        dropSkills: ['review'],
      }),
    ).toMatchObject({
      sourceName: 'frontend',
      targetName: 'frontend',
      skillOverrides: { pdf: '1.1.0' },
      dropSkills: ['review'],
    });
    expect(
      CopyPackageRequestSchema.safeParse({
        sourceVersion: '1.0.0',
        targetName: 'frontend',
        targetVersion: '1.1.0',
      }).success,
    ).toBe(false);
  });

  it('rejects empty route package names and versions', () => {
    expect(
      RouteAddRequestSchema.safeParse({
        targetId: 'project-a',
        name: '',
        requested: '1.0.0',
      }).success,
    ).toBe(false);
    expect(
      RouteAddRequestSchema.safeParse({
        targetId: 'project-a',
        name: 'frontend',
        requested: '',
      }).success,
    ).toBe(false);
    expect(
      RouteRemoveRequestSchema.safeParse({ targetId: 'project-a', name: '' })
        .success,
    ).toBe(false);
  });

  it('validates target and route lifecycle requests', () => {
    expect(TargetRemoveRequestSchema.parse({ id: 'project-a' })).toEqual({
      id: 'project-a',
    });
    expect(TargetRemoveRequestSchema.safeParse({ id: '' }).success).toBe(false);

    expect(
      TargetEnableRequestSchema.parse({ id: 'project-a', enabled: false }),
    ).toEqual({ id: 'project-a', enabled: false });
    expect(
      TargetEnableRequestSchema.safeParse({ id: 'project-a' }).success,
    ).toBe(false);

    expect(
      RouteEnableRequestSchema.parse({
        targetId: 'project-a',
        name: 'frontend',
        enabled: true,
      }),
    ).toEqual({
      targetId: 'project-a',
      name: 'frontend',
      enabled: true,
    });
    expect(
      RouteEnableRequestSchema.safeParse({
        targetId: 'project-a',
        name: '',
        enabled: true,
      }).success,
    ).toBe(false);
  });

  it('validates skill and package tag/remove requests', () => {
    expect(
      SkillTagRequestSchema.parse({
        name: 'pdf',
        version: '1.0.0',
        tag: 'stable',
      }),
    ).toEqual({ name: 'pdf', version: '1.0.0', tag: 'stable' });
    expect(
      SkillTagRequestSchema.safeParse({
        name: 'pdf',
        version: '1.0.0',
        tag: '',
      }).success,
    ).toBe(false);
    expect(
      SkillRemoveRequestSchema.safeParse({ name: 'pdf' }).success,
    ).toBe(false);
    expect(
      PackageTagRequestSchema.parse({
        name: 'frontend',
        version: '1.0.0',
        tag: 'latest',
      }),
    ).toEqual({ name: 'frontend', version: '1.0.0', tag: 'latest' });
    expect(
      PackageRemoveRequestSchema.safeParse({ name: 'frontend' }).success,
    ).toBe(false);
  });

  it('rejects a rollback request without an id', () => {
    expect(RollbackRequestSchema.safeParse({}).success).toBe(false);
    expect(RollbackRequestSchema.safeParse({ id: '' }).success).toBe(false);
    expect(
      RollbackRequestSchema.parse({ id: '2026-10-30T12-00-00-000Z' }),
    ).toEqual({ id: '2026-10-30T12-00-00-000Z' });
  });

  it('accepts optional booleans and numbers for gc', () => {
    expect(GcRequestSchema.parse({})).toEqual({});
    expect(
      GcRequestSchema.parse({ dryRun: true, keepTagged: false, maxAgeDays: 0 }),
    ).toEqual({ dryRun: true, keepTagged: false, maxAgeDays: 0 });
    expect(GcRequestSchema.safeParse({ maxAgeDays: -1 }).success).toBe(false);
  });

  it('accepts apply options with only known fields', () => {
    expect(ApplyRequestSchema.parse({ dryRun: true })).toEqual({
      dryRun: true,
    });
    expect(ApplyRequestSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(ApplyRequestSchema.safeParse({ prune: true }).success).toBe(false);
  });

  it('validates language pack requests', () => {
    expect(
      LanguageInstallRequestSchema.parse({
        path: 'C:/packs/zh-CN.json',
        use: true,
        force: true,
      }),
    ).toEqual({
      path: 'C:/packs/zh-CN.json',
      use: true,
      force: true,
    });
    expect(LanguageInstallRequestSchema.safeParse({ path: '' }).success).toBe(
      false,
    );
    expect(
      LanguageInstallRequestSchema.parse({ path: 'C:/packs/zh-CN.json' }),
    ).toEqual({ path: 'C:/packs/zh-CN.json' });
    expect(LanguageUseRequestSchema.safeParse({ locale: '' }).success).toBe(
      false,
    );
    expect(LanguageUseRequestSchema.parse({ locale: 'zh-CN' })).toEqual({
      locale: 'zh-CN',
    });
    expect(
      LanguageRemoveRequestSchema.safeParse({ locale: '../route' }).success,
    ).toBe(false);
    expect(
      LanguageUseRequestSchema.safeParse({ locale: '..\\route' }).success,
    ).toBe(false);
    expect(
      LanguageRemoveRequestSchema.parse({ locale: 'zh-CN' }),
    ).toEqual({ locale: 'zh-CN' });
  });
});
