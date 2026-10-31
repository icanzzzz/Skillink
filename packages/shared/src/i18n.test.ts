import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILLINK_ERROR_CODES } from './errors.js';
import {
  LanguagePackSchema,
  createTranslator,
  formatDoctorIssue,
  matchLocale,
} from './i18n.js';
import { EN_MESSAGES } from './i18n-en.js';
import { getSkillinkPaths } from './paths.js';
import { DOCTOR_ISSUE_CODES } from './reports.js';

describe('language packs', () => {
  it('formats plural messages and falls back to English', () => {
    const translator = createTranslator('fr', {
      'overview.stats.skills': {
        one: '{count} compétence',
        other: '{count} compétences',
      },
    });

    expect(translator.t('overview.stats.skills', { count: 1 })).toBe(
      '1 compétence',
    );
    expect(translator.t('overview.stats.skills', { count: 3 })).toBe(
      '3 compétences',
    );
    expect(translator.t('app.nav.overview')).toBe('Overview');
    expect(translator.t('missing.key', {}, 'fallback')).toBe('fallback');
  });

  it('rejects invalid manifests', () => {
    expect(
      LanguagePackSchema.safeParse({
        schemaVersion: 2,
        locale: 'zh-CN',
        name: 'Chinese',
        nativeName: '简体中文',
        version: '1.0.0',
        messages: {},
      }).success,
    ).toBe(false);
  });

  it('matches locale subtags and en fallback', () => {
    expect(matchLocale('zh-Hant-TW', ['zh-CN', 'en'])).toBe('en');
    expect(matchLocale('zh', ['zh-CN', 'en'])).toBe('zh-CN');
    expect(matchLocale('ZH-cn', ['zh-CN', 'en'])).toBe('zh-CN');
    expect(matchLocale('ja-JP', ['en'])).toBe('en');
    expect(matchLocale('ja-JP', ['fr'])).toBeUndefined();
  });

  it('exposes settings and locales paths', () => {
    const home = 'C:/tmp/skillink-home';
    const paths = getSkillinkPaths(home);

    expect(paths.settingsFile).toBe(
      path.join(path.resolve(home), 'settings.json'),
    );
    expect(paths.localesDir).toBe(path.join(path.resolve(home), 'locales'));
  });

  it('declares the language pack error codes', () => {
    expect(SKILLINK_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'LANGUAGE_PACK_INVALID',
        'LANGUAGE_PACK_NOT_FOUND',
        'LANGUAGE_PACK_EXISTS',
        'LANGUAGE_PACK_BUILTIN',
      ]),
    );
  });

  it('declares every doctor issue code', () => {
    expect(DOCTOR_ISSUE_CODES).toEqual(
      expect.arrayContaining([
        'MISSING_CONTENT',
        'ORPHAN_CONTENT',
        'ROUTE_MISSING_VERSION',
        'PACKAGE_INTEGRITY_MISMATCH',
        'SKILL_NOT_FOUND',
        'SKILL_MD_MISSING',
        'SKILL_INTEGRITY_MISMATCH',
        'SKILL_VERSION_CONFLICT',
        'UNSUPPORTED_MODE',
        'PACKAGE_CYCLE',
        'PACKAGE_MISSING_VERSION',
        'UNUSED_PACKAGE_VERSION',
        'LINK_ISSUE',
        'UNSAFE_PATH',
        'INVALID_CONFIG',
      ]),
    );
  });

  it('formats doctor issues with translations', () => {
    const issue = {
      code: 'MISSING_CONTENT' as const,
      message: 'Skill content is missing: demo@1.0.0',
      name: 'demo',
      version: '1.0.0',
    };

    expect(
      formatDoctorIssue(issue, createTranslator('en', EN_MESSAGES)),
    ).toBe(issue.message);
    expect(
      formatDoctorIssue(
        issue,
        createTranslator('zh-CN', {
          'doctorIssues.MISSING_CONTENT': '技能内容缺失：{name}@{version}',
        }),
      ),
    ).toBe('技能内容缺失：demo@1.0.0');
  });
});
