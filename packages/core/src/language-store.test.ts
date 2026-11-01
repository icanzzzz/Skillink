import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EN_MESSAGES,
  createTranslator,
  getSkillinkPaths,
  type LanguagePack,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  getLanguageState,
  installLanguagePack,
  listLanguagePacks,
  removeLanguagePack,
  setActiveLocale,
} from './language-store.js';
import {
  readSettingsFile,
  writeSettingsFile,
} from './settings-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<SkillinkPaths> {
  const root = await tempDir('skillink-language-store-');
  return getSkillinkPaths(path.join(root, 'home'));
}

function fullMessages(): LanguagePack['messages'] {
  return Object.fromEntries(
    Object.keys(EN_MESSAGES).map((key) => [key, `translated ${key}`]),
  );
}

function languagePack(overrides: Partial<LanguagePack> = {}): LanguagePack {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    version: '1.0.0',
    direction: 'ltr',
    messages: fullMessages(),
    ...overrides,
  };
}

async function writePackSource(
  prefix: string,
  pack: LanguagePack,
): Promise<string> {
  const dir = await tempDir(prefix);
  const file = path.join(dir, 'pack.json');
  await writeFile(file, JSON.stringify(pack), 'utf8');
  return file;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('language store', () => {
  it('defaults to English when no settings or packs exist', async () => {
    const paths = await setup();

    const state = await getLanguageState(paths, { systemLocale: 'en-US' });

    expect(state.current).toBe('en');
    expect(state.direction).toBe('ltr');
    expect(state.messages).toEqual(EN_MESSAGES);
    expect(state.packs).toMatchObject([
      { locale: 'en', builtIn: true, coverage: 1 },
    ]);
  });

  it('installs and lists a complete language pack', async () => {
    const paths = await setup();
    const source = await writePackSource('skillink-pack-', languagePack());

    const report = await installLanguagePack(paths, { sourcePath: source });

    expect(report.pack).toMatchObject({
      locale: 'zh-CN',
      nativeName: '简体中文',
      coverage: 1,
      builtIn: false,
    });
    expect(report.missingKeys).toEqual([]);
    expect(report.extraKeys).toEqual([]);

    const packs = await listLanguagePacks(paths);
    expect(packs.map((pack) => pack.locale)).toEqual(['en', 'zh-CN']);
  });

  it('falls back to English for keys missing from a partial pack', async () => {
    const paths = await setup();
    const source = await writePackSource(
      'skillink-pack-',
      languagePack({
        messages: {
          'app.nav.overview': '概览',
        },
      }),
    );

    const report = await installLanguagePack(paths, {
      sourcePath: source,
      use: true,
    });

    expect(report.pack.coverage).toBeGreaterThan(0);
    expect(report.pack.coverage).toBeLessThan(1);
    expect(report.missingKeys).toContain('app.nav.skills');

    const state = await getLanguageState(paths, { systemLocale: 'en-US' });
    expect(state.current).toBe('zh-CN');
    expect(state.messages).not.toHaveProperty('app.nav.skills');
    expect(
      createTranslator(state.current, state.messages).t('app.nav.overview'),
    ).toBe('概览');
    expect(
      createTranslator(state.current, state.messages).t('app.nav.skills'),
    ).toBe('Skills');
  });

  it('requires force to replace an installed pack and keeps the selection', async () => {
    const paths = await setup();
    const first = await writePackSource('skillink-pack-', languagePack());
    await installLanguagePack(paths, { sourcePath: first, use: true });

    const duplicate = await writePackSource(
      'skillink-pack-',
      languagePack({ version: '1.0.1' }),
    );
    await expect(
      installLanguagePack(paths, { sourcePath: duplicate }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_PACK_EXISTS' });

    const replaced = await installLanguagePack(paths, {
      sourcePath: duplicate,
      force: true,
    });

    expect(replaced.pack.version).toBe('1.0.1');
    expect(replaced.active).toBe(true);
    expect((await readSettingsFile(paths)).locale).toBe('zh-CN');
    expect(
      (await listLanguagePacks(paths)).filter(
        (pack) => pack.locale.toLowerCase() === 'zh-cn',
      ),
    ).toMatchObject([{ version: '1.0.1' }]);
  });

  it('rejects installing a built-in locale', async () => {
    const paths = await setup();
    const source = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'en', name: 'English', nativeName: 'English' }),
    );

    await expect(
      installLanguagePack(paths, { sourcePath: source }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_PACK_BUILTIN' });
  });

  it('resets to English when the current pack is removed', async () => {
    const paths = await setup();
    const source = await writePackSource('skillink-pack-', languagePack());
    await installLanguagePack(paths, { sourcePath: source, use: true });

    const result = await removeLanguagePack(paths, 'zh-CN');

    expect(result).toEqual({ removed: 'zh-CN', current: 'en' });
    expect(await readSettingsFile(paths)).toEqual({
      schemaVersion: 1,
      locale: 'en',
    });
    expect(
      (await listLanguagePacks(paths)).map((pack) => pack.locale),
    ).toEqual(['en']);
  });

  it('stores case-variant locales in one lowercase file', async () => {
    const paths = await setup();
    const first = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'zh-CN' }),
    );
    const second = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'zh-cn' }),
    );

    await installLanguagePack(paths, { sourcePath: first });
    await installLanguagePack(paths, {
      sourcePath: second,
      force: true,
    });

    expect(await readdir(paths.localesDir)).toEqual(['zh-cn.json']);
    expect(
      (await listLanguagePacks(paths)).filter((pack) => !pack.builtIn),
    ).toHaveLength(1);
  });

  it('rejects invalid, oversized, and wrong-version packs', async () => {
    const paths = await setup();
    const invalidDir = await tempDir('skillink-pack-invalid-');
    const invalidJson = path.join(invalidDir, 'invalid.json');
    await writeFile(invalidJson, '{not json', 'utf8');
    await expect(
      installLanguagePack(paths, { sourcePath: invalidJson }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_PACK_INVALID' });

    const oversized = path.join(invalidDir, 'oversized.json');
    await writeFile(oversized, 'a'.repeat(512 * 1024 + 1), 'utf8');
    await expect(
      installLanguagePack(paths, { sourcePath: oversized }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_PACK_INVALID' });

    const wrongVersion = await writePackSource(
      'skillink-pack-invalid-',
      { ...languagePack(), schemaVersion: 2 } as unknown as LanguagePack,
    );
    await expect(
      installLanguagePack(paths, { sourcePath: wrongVersion }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_PACK_INVALID' });

    const emptyMessage = await writePackSource(
      'skillink-pack-invalid-',
      languagePack({
        messages: {
          'app.nav.overview': '',
        },
      }),
    );
    await expect(
      installLanguagePack(paths, { sourcePath: emptyMessage }),
    ).rejects.toMatchObject({ code: 'LANGUAGE_PACK_INVALID' });
  });

  it('falls back to English for missing, damaged, or unreadable settings', async () => {
    const paths = await setup();
    const source = await writePackSource('skillink-pack-', languagePack());
    await installLanguagePack(paths, { sourcePath: source, use: true });

    await writeSettingsFile(paths, { schemaVersion: 1, locale: 'ja' });
    expect(
      (await getLanguageState(paths, { systemLocale: 'zh-CN' })).current,
    ).toBe('en');

    await writeSettingsFile(paths, { schemaVersion: 1, locale: 'zh-CN' });
    await writeFile(path.join(paths.localesDir, 'zh-cn.json'), '{broken');
    expect(
      (await getLanguageState(paths, { systemLocale: 'en-US' })).current,
    ).toBe('en');

    await writeFile(paths.settingsFile, '{broken', 'utf8');
    expect(
      (await getLanguageState(paths, { systemLocale: 'en-US' })).current,
    ).toBe('en');
    expect(
      (await getLanguageState(paths, { systemLocale: 'zh-CN' })).current,
    ).toBe('en');
  });

  it('resolves SKILLINK_LOCALE before settings before system locale', async () => {
    const paths = await setup();
    const chinese = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'zh-CN' }),
    );
    const japanese = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'ja', name: 'Japanese', nativeName: '日本語' }),
    );
    await installLanguagePack(paths, { sourcePath: chinese, use: true });
    await installLanguagePack(paths, { sourcePath: japanese });

    expect(
      (
        await getLanguageState(paths, {
          env: { SKILLINK_LOCALE: 'ja' },
          systemLocale: 'fr-FR',
        })
      ).current,
    ).toBe('ja');

    expect(
      (
        await getLanguageState(paths, {
          env: {},
          systemLocale: 'fr-FR',
        })
      ).current,
    ).toBe('zh-CN');

    await writeSettingsFile(paths, { schemaVersion: 1 });
    expect(
      (
        await getLanguageState(paths, {
          env: {},
          systemLocale: 'ja-JP',
        })
      ).current,
    ).toBe('ja');
  });

  it('removes a damaged pack file', async () => {
    const paths = await setup();
    await getLanguageState(paths);
    await mkdir(paths.localesDir, { recursive: true });
    await writeFile(
      path.join(paths.localesDir, 'zh-cn.json'),
      '{broken',
      'utf8',
    );

    const result = await removeLanguagePack(paths, 'zh-CN');

    expect(result.current).toBe('en');
    expect(await readdir(paths.localesDir)).toEqual([]);
  });

  it('rejects path traversal when removing a locale', async () => {
    const paths = await setup();
    await mkdir(paths.home, { recursive: true });
    await writeFile(
      paths.routeFile,
      JSON.stringify({ schemaVersion: 2, targets: [] }),
      'utf8',
    );

    for (const locale of ['../route', '..\\route', '../../victim', '']) {
      await expect(removeLanguagePack(paths, locale)).rejects.toMatchObject({
        code: 'LANGUAGE_PACK_NOT_FOUND',
      });
    }

    expect(await readFile(paths.routeFile, 'utf8')).toContain('schemaVersion');
  });

  it('keeps settings when removing a non-current pack', async () => {
    const paths = await setup();
    const chinese = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'zh-CN' }),
    );
    const japanese = await writePackSource(
      'skillink-pack-',
      languagePack({ locale: 'ja', name: 'Japanese', nativeName: '日本語' }),
    );
    await installLanguagePack(paths, { sourcePath: chinese, use: true });
    await installLanguagePack(paths, { sourcePath: japanese });

    const result = await removeLanguagePack(paths, 'ja');

    expect(result.current).toBe('zh-CN');
    expect(await readSettingsFile(paths)).toEqual({
      schemaVersion: 1,
      locale: 'zh-CN',
    });
  });

  it('writes the canonical locale when selecting a pack', async () => {
    const paths = await setup();
    const source = await writePackSource('skillink-pack-', languagePack());
    await installLanguagePack(paths, { sourcePath: source });

    await setActiveLocale(paths, 'ZH-cn');

    expect(await readFile(paths.settingsFile, 'utf8')).toContain(
      '"locale": "zh-CN"',
    );
    await expect(setActiveLocale(paths, 'fr')).rejects.toMatchObject({
      code: 'LANGUAGE_PACK_NOT_FOUND',
    });
    await expect(setActiveLocale(paths, 'en')).resolves.toBeUndefined();
  });
});
