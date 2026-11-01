import { describe, expect, it } from 'vitest';
import { parseSkillDirectoryName } from './skill-directory.js';

describe('parseSkillDirectoryName', () => {
  it('parses a folder named name@version', () => {
    expect(parseSkillDirectoryName('pdf@1.2.0')).toEqual({
      name: 'pdf',
      version: '1.2.0',
    });
  });

  it('uses the last path segment and accepts Windows and POSIX separators', () => {
    expect(parseSkillDirectoryName('C:\\skills\\pdf@1.2.0')).toEqual({
      name: 'pdf',
      version: '1.2.0',
    });
    expect(parseSkillDirectoryName('/home/me/skills/pdf@1.2.0/')).toEqual({
      name: 'pdf',
      version: '1.2.0',
    });
  });

  it('keeps @ characters in the name before the final separator', () => {
    expect(parseSkillDirectoryName('team@pdf@1.2.0')).toEqual({
      name: 'team@pdf',
      version: '1.2.0',
    });
  });

  it.each([
    ['pdf', { name: 'pdf' }],
    ['@1.2.0', { version: '1.2.0' }],
    ['pdf@', { name: 'pdf' }],
    ['pdf@latest', { name: 'pdf' }],
    ['pdf@1.2', { name: 'pdf' }],
  ])('parses the usable part of an incomplete folder name: %s', (value, expected) => {
    expect(parseSkillDirectoryName(value)).toEqual(expected);
  });

  it.each(['', 'C:\\'])(
    'returns undefined when there is no usable folder name: %s',
    (value) => {
      expect(parseSkillDirectoryName(value)).toBeUndefined();
    },
  );
});
