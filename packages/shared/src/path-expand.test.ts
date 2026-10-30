import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandPath } from './path-expand.js';

const home = path.resolve('C:/Users/TestUser');

describe('expandPath', () => {
  it('expands a bare tilde', () => {
    expect(expandPath('~', { home })).toBe(home);
  });

  it('expands tilde-prefixed paths', () => {
    expect(expandPath('~/skills', { home })).toBe(path.join(home, 'skills'));
    expect(expandPath('~\\skills', { home })).toBe(path.join(home, 'skills'));
  });

  it('expands percent-style environment variables', () => {
    const env = { USERPROFILE: 'C:\\Users\\TestUser' };

    expect(expandPath('%USERPROFILE%\\skills', { env })).toBe(
      'C:\\Users\\TestUser\\skills',
    );
  });

  it('matches environment names case-insensitively on Windows', () => {
    const env = { UserProfile: 'C:\\Users\\TestUser' };

    expect(
      expandPath('%USERPROFILE%\\skills', { env, caseInsensitiveEnv: true }),
    ).toBe('C:\\Users\\TestUser\\skills');
  });

  it('expands dollar-style home variables', () => {
    const env = { HOME: '/home/test' };

    expect(expandPath('$HOME/skills', { env })).toBe('/home/test/skills');
    expect(expandPath('${HOME}/skills', { env })).toBe('/home/test/skills');
  });

  it('rejects unresolved environment variables', () => {
    expect(() => expandPath('%MISSING%\\skills', { env: {} })).toThrow(
      /MISSING/,
    );
    expect(() => expandPath('$MISSING/skills', { env: {} })).toThrow(
      /MISSING/,
    );
  });
});
