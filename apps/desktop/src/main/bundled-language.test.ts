import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanguagePack } from '@skillink/shared';
import {
  bundledLanguagePackPath,
  shouldRefreshBundledLanguagePack,
  syncBundledLanguagePack,
} from './bundled-language.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function pack(overrides: Partial<LanguagePack> = {}): LanguagePack {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    version: '1.0.0',
    direction: 'ltr',
    messages: {
      'app.nav.skills': '技能',
      'skills.import.heading': '安装技能包',
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('bundled language pack', () => {
  it('resolves the bundled pack in development and packaged builds', () => {
    expect(
      bundledLanguagePackPath({
        isPackaged: false,
        appPath: 'C:/repo/apps/desktop',
        resourcesPath: 'C:/repo/apps/desktop/release/resources',
      }),
    ).toBe(path.resolve('C:/repo/apps/desktop', '../../locales/zh-CN.json'));

    expect(
      bundledLanguagePackPath({
        isPackaged: true,
        appPath: 'C:/Program Files/Skillink/app.asar',
        resourcesPath: 'C:/Program Files/Skillink/resources',
      }),
    ).toBe(path.join('C:/Program Files/Skillink/resources', 'locales', 'zh-CN.json'));
  });

  it('only refreshes an installed bundled pack that is missing messages', () => {
    const bundled = pack();

    expect(
      shouldRefreshBundledLanguagePack(
        pack({ messages: { 'app.nav.skills': '技能' } }),
        bundled,
      ),
    ).toBe(true);
    expect(shouldRefreshBundledLanguagePack(bundled, bundled)).toBe(false);
    expect(
      shouldRefreshBundledLanguagePack(
        pack({ version: '1.0.0' }),
        pack({ version: '1.0.1' }),
      ),
    ).toBe(true);
    expect(
      shouldRefreshBundledLanguagePack(
        pack({ version: '1.1.0' }),
        pack({ version: '1.0.1' }),
      ),
    ).toBe(false);
    expect(
      shouldRefreshBundledLanguagePack(
        pack({ name: 'Custom Chinese' }),
        bundled,
      ),
    ).toBe(false);
    expect(
      shouldRefreshBundledLanguagePack(
        pack({ nativeName: '自定义中文' }),
        bundled,
      ),
    ).toBe(false);
    expect(
      shouldRefreshBundledLanguagePack(pack({ locale: 'ja' }), bundled),
    ).toBe(false);
  });

  it('reinstalls the bundled pack when an outdated copy exists', async () => {
    const root = await tempDir('skillink-bundled-language-');
    const bundledPath = path.join(root, 'bundled.json');
    const installedPath = path.join(root, 'zh-cn.json');
    await writeFile(bundledPath, JSON.stringify(pack()), 'utf8');
    await writeFile(
      installedPath,
      JSON.stringify(pack({ messages: { 'app.nav.skills': '技能' } })),
      'utf8',
    );
    const install = vi.fn(async () => undefined);

    await expect(
      syncBundledLanguagePack({ bundledPath, installedPath, install }),
    ).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith(bundledPath);
  });

  it('reinstalls when the bundled pack version is newer', async () => {
    const root = await tempDir('skillink-bundled-language-');
    const bundledPath = path.join(root, 'bundled.json');
    const installedPath = path.join(root, 'zh-cn.json');
    await writeFile(
      bundledPath,
      JSON.stringify(pack({ version: '1.0.1' })),
      'utf8',
    );
    await writeFile(installedPath, JSON.stringify(pack()), 'utf8');
    const install = vi.fn(async () => undefined);

    await expect(
      syncBundledLanguagePack({ bundledPath, installedPath, install }),
    ).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith(bundledPath);
  });

  it('leaves a current or missing installation alone', async () => {
    const root = await tempDir('skillink-bundled-language-');
    const bundledPath = path.join(root, 'bundled.json');
    const installedPath = path.join(root, 'zh-cn.json');
    await writeFile(bundledPath, JSON.stringify(pack()), 'utf8');
    const install = vi.fn(async () => undefined);

    await expect(
      syncBundledLanguagePack({ bundledPath, installedPath, install }),
    ).resolves.toBe(false);

    await writeFile(installedPath, JSON.stringify(pack()), 'utf8');
    await expect(
      syncBundledLanguagePack({ bundledPath, installedPath, install }),
    ).resolves.toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it('does not replace a language pack owned by the user', async () => {
    const root = await tempDir('skillink-bundled-language-');
    const bundledPath = path.join(root, 'bundled.json');
    const installedPath = path.join(root, 'zh-cn.json');
    await writeFile(bundledPath, JSON.stringify(pack()), 'utf8');
    await writeFile(
      installedPath,
      JSON.stringify(pack({ name: 'Custom Chinese' })),
      'utf8',
    );
    const install = vi.fn(async () => undefined);

    await expect(
      syncBundledLanguagePack({ bundledPath, installedPath, install }),
    ).resolves.toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it('does not fail startup when the bundled pack cannot be installed', async () => {
    const root = await tempDir('skillink-bundled-language-');
    const bundledPath = path.join(root, 'bundled.json');
    const installedPath = path.join(root, 'zh-cn.json');
    await writeFile(bundledPath, JSON.stringify(pack()), 'utf8');
    await writeFile(
      installedPath,
      JSON.stringify(pack({ messages: { 'app.nav.skills': '技能' } })),
      'utf8',
    );
    const log = vi.fn();

    await expect(
      syncBundledLanguagePack({
        bundledPath,
        installedPath,
        install: async () => {
          throw new Error('install failed');
        },
        log,
      }),
    ).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('install failed'),
    );
  });
});
