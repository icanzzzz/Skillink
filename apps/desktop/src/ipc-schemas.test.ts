import { describe, expect, it } from 'vitest';
import {
  AddTargetRequestSchema,
  ApplyRequestSchema,
  GcRequestSchema,
  ImportFolderRequestSchema,
  LibraryRemoveRequestSchema,
  LibraryTagRequestSchema,
  RollbackRequestSchema,
  RouteAddRequestSchema,
  RouteRemoveRequestSchema,
} from './ipc-schemas.js';

describe('IPC request schemas', () => {
  it('accepts a valid import request', () => {
    expect(
      ImportFolderRequestSchema.parse({
        sourceDir: 'C:/Projects/example',
        name: 'example',
        version: '1.0.0',
      }),
    ).toEqual({
      sourceDir: 'C:/Projects/example',
      name: 'example',
      version: '1.0.0',
    });
  });

  it('rejects an import request without sourceDir', () => {
    expect(ImportFolderRequestSchema.safeParse({ name: 'example' }).success).toBe(false);
    expect(ImportFolderRequestSchema.safeParse({ sourceDir: '' }).success).toBe(false);
  });

  it('rejects an invalid target mode', () => {
    expect(
      AddTargetRequestSchema.safeParse({
        path: 'C:/Projects/packages',
        mode: 'hardlink',
      }).success,
    ).toBe(false);

    expect(
      AddTargetRequestSchema.parse({
        path: 'C:/Projects/packages',
        mode: 'link',
      }),
    ).toEqual({
      path: 'C:/Projects/packages',
      mode: 'link',
    });
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
        name: 'demo',
        requested: '',
      }).success,
    ).toBe(false);

    expect(
      RouteRemoveRequestSchema.safeParse({ targetId: 'project-a', name: '' }).success,
    ).toBe(false);
  });

  it('rejects a rollback request without an id', () => {
    expect(RollbackRequestSchema.safeParse({}).success).toBe(false);
    expect(RollbackRequestSchema.safeParse({ id: '' }).success).toBe(false);
    expect(RollbackRequestSchema.parse({ id: '2026-10-30T12-00-00-000Z' })).toEqual({
      id: '2026-10-30T12-00-00-000Z',
    });
  });

  it('accepts optional booleans and numbers for gc', () => {
    expect(GcRequestSchema.parse({})).toEqual({});
    expect(
      GcRequestSchema.parse({ dryRun: true, keepTagged: false, maxAgeDays: 0 }),
    ).toEqual({ dryRun: true, keepTagged: false, maxAgeDays: 0 });
    expect(GcRequestSchema.safeParse({ maxAgeDays: -1 }).success).toBe(false);
  });

  it('validates library tag and remove requests', () => {
    expect(
      LibraryTagRequestSchema.parse({
        name: 'demo',
        version: '1.0.0',
        tag: 'stable',
      }),
    ).toEqual({ name: 'demo', version: '1.0.0', tag: 'stable' });
    expect(LibraryTagRequestSchema.safeParse({ name: 'demo', version: '1.0.0', tag: '' }).success).toBe(false);
    expect(LibraryRemoveRequestSchema.safeParse({ name: 'demo' }).success).toBe(false);
  });

  it('accepts apply options with only known fields', () => {
    expect(ApplyRequestSchema.parse({ dryRun: true, prune: false })).toEqual({
      dryRun: true,
      prune: false,
    });
    expect(ApplyRequestSchema.safeParse({ unknown: true }).success).toBe(false);
  });
});
