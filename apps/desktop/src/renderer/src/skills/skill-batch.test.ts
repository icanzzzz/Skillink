import { describe, expect, it } from 'vitest';
import { createEmptySkillFile } from '@skillink/shared';
import {
  isAlreadyInstalled,
  resetBatchName,
  resolveSkillBatchName,
  toSkillBatchItem,
  type SkillBatchItem,
} from './skill-batch.js';

describe('toSkillBatchItem', () => {
  it('prefills the scanned name instead of leaving it empty', () => {
    const item = toSkillBatchItem({
      sourceDir: 'C:/Skills/demo@1.2.0+abc',
      name: 'demo',
      version: '1.2.0+abc',
      description: 'Demo skill',
      directoryLinks: [],
    });

    expect(item.name).toBe('demo');
    expect(item.defaultVersion).toBe('1.2.0');
    expect(item.version).toBe('1.2.0');
    expect(item.defaultVersion).toBe(item.version);
    expect(item.status).toBe('pending');
    expect(item.description).toBe('Demo skill');
  });

  it('strips build metadata from the prefilled version', () => {
    const item = toSkillBatchItem({
      sourceDir: 'C:/Skills/build@2.0.0+sha.123',
      name: 'build',
      version: '2.0.0+sha.123',
      directoryLinks: ['C:/Skills/build@2.0.0+sha.123/assets'],
    });

    expect(item.version).toBe('2.0.0');
    expect(item.defaultVersion).toBe('2.0.0');
    expect(item.directoryLinks).toEqual([
      'C:/Skills/build@2.0.0+sha.123/assets',
    ]);
  });

  it('falls back to the folder name when scanning finds no name', () => {
    const item = toSkillBatchItem({
      sourceDir: 'C:\\Skills\\untitled',
      version: undefined,
      directoryLinks: [],
    });

    expect(item.name).toBe('untitled');
    expect(item.version).toBe('');
    expect(item.defaultVersion).toBe('');
  });
});

describe('resolveSkillBatchName', () => {
  it('returns the visible name and ignores surrounding whitespace', () => {
    expect(resolveSkillBatchName({ name: ' demo ' })).toBe('demo');
    expect(resolveSkillBatchName({ name: '   ' })).toBe('');
  });
});

describe('resetBatchName', () => {
  it('keeps the visible name and version when the install succeeds', () => {
    const item: SkillBatchItem = {
      sourceDir: 'C:/Skills/demo@1.0.0',
      name: 'renamed',
      version: '1.0.0',
      defaultVersion: '1.0.0',
      directoryLinks: [],
      status: 'installing',
    };

    const next = resetBatchName(item);

    expect(next).not.toBe(item);
    expect(next.name).toBe('renamed');
    expect(next.version).toBe('1.0.0');
    expect(next.status).toBe('installed');
  });
});

describe('isAlreadyInstalled', () => {
  it('detects an installed name and version pair', () => {
    const skills = createEmptySkillFile();
    skills.skills.demo = {
      versions: {
        '1.0.0': {
          integrity: 'sha512-abc',
          fileCount: 1,
          size: 10,
          built: false,
        },
      },
    };

    expect(isAlreadyInstalled(skills, 'demo', '1.0.0')).toBe(true);
    expect(isAlreadyInstalled(skills, 'demo', '2.0.0')).toBe(false);
    expect(isAlreadyInstalled(skills, 'other', '1.0.0')).toBe(false);
  });
});
