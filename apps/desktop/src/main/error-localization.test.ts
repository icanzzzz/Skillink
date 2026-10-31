import { describe, expect, it } from 'vitest';
import type { LanguageState } from '@skillink/shared';
import { CliCommandError } from './cli-adapter.js';
import { localizeError, translateCliError } from './error-localization.js';

const state: LanguageState = {
  current: 'zh-CN',
  direction: 'ltr',
  packs: [],
  messages: {
    'errors.LANGUAGE_PACK_INVALID': '语言包格式无效。',
  },
};

describe('CLI error localization', () => {
  it('translates known errors with the error code', () => {
    expect(
      translateCliError(
        new CliCommandError({
          code: 'LANGUAGE_PACK_INVALID',
          message: 'Invalid language pack.',
          exitCode: 1,
        }),
        state,
      ).message,
    ).toBe('语言包格式无效。 (LANGUAGE_PACK_INVALID)');
  });

  it('keeps the original message in English', () => {
    expect(
      translateCliError(
        new CliCommandError({
          code: 'LANGUAGE_PACK_INVALID',
          message: 'Invalid language pack.',
          exitCode: 1,
        }),
        { ...state, current: 'en' },
      ).message,
    ).toBe('Invalid language pack.');
  });

  it('keeps the original message when the pack has no translation', () => {
    expect(
      translateCliError(
        new CliCommandError({
          code: 'PACKAGE_NOT_FOUND',
          message: 'Package "demo" is not defined.',
          exitCode: 1,
        }),
        state,
      ).message,
    ).toBe('Package "demo" is not defined.');
  });

  it('keeps the original message for unknown error codes', () => {
    expect(
      translateCliError(
        new CliCommandError({
          code: 'UNKNOWN_CODE',
          message: 'Unknown failure.',
          exitCode: 1,
        }),
        state,
      ).message,
    ).toBe('Unknown failure.');
  });

  it('passes through non-CLI errors', () => {
    const error = new Error('boom');
    expect(translateCliError(error, state)).toBe(error);
    expect(translateCliError('boom', state).message).toBe('boom');
  });

  it('keeps the original message when language state loading fails', async () => {
    const error = new CliCommandError({
      code: 'LANGUAGE_PACK_INVALID',
      message: 'Invalid language pack.',
      exitCode: 1,
    });

    await expect(
      localizeError(error, () => Promise.reject(new Error('no state'))),
    ).resolves.toBe(error);
  });
});
