import { describe, expect, it } from 'vitest';
import {
  deriveTargetIdDefault,
  slugifyTargetId,
  targetPathBaseName,
} from './target-id.js';

describe('target id defaults', () => {
  it('slugifies display values', () => {
    expect(slugifyTargetId('Project A')).toBe('project-a');
    expect(slugifyTargetId('  __  ')).toBe('target');
  });

  it('reads folder names from Windows and POSIX paths', () => {
    expect(targetPathBaseName('C:/Projects/ProjectA/skills')).toBe('skills');
    expect(targetPathBaseName('C:\\Projects\\Project A\\skills\\')).toBe(
      'skills',
    );
    expect(targetPathBaseName('/home/me/project-a')).toBe('project-a');
    expect(targetPathBaseName('')).toBe('');
  });

  it('prefers an explicit id, then the label, then the path folder', () => {
    expect(
      deriveTargetIdDefault({
        id: 'custom',
        label: 'Project A',
        path: 'C:/Projects/ProjectB/skills',
      }),
    ).toBe('custom');
    expect(
      deriveTargetIdDefault({
        label: 'Project A',
        path: 'C:/Projects/ProjectB/skills',
      }),
    ).toBe('project-a');
    expect(
      deriveTargetIdDefault({ path: 'C:/Projects/ProjectB/skills' }),
    ).toBe('skills');
  });
});
