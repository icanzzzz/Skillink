import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  LanguageState,
  LocaleInstallReport,
} from '@skillink/shared';
import type { DesktopApi } from '../../shared.js';
import {
  I18nProvider,
  createLanguageActions,
  installPickedLanguage,
  useI18n,
} from './i18n.js';

const englishState: LanguageState = {
  current: 'en',
  direction: 'ltr',
  packs: [],
  messages: {},
};

const chineseState: LanguageState = {
  current: 'zh-CN',
  direction: 'ltr',
  packs: [],
  messages: {},
};

const installReport: LocaleInstallReport = {
  pack: {
    locale: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    version: '1.0.0',
    direction: 'ltr',
    messageCount: 1,
    coverage: 1,
    builtIn: false,
  },
  missingKeys: [],
  extraKeys: [],
  active: true,
};

function Probe() {
  const { t } = useI18n();
  return <span>{t('app.nav.overview')}</span>;
}

describe('I18nProvider', () => {
  it('uses the provided language state messages', () => {
    expect(
      renderToStaticMarkup(
        <I18nProvider
          state={{
            current: 'en',
            direction: 'ltr',
            packs: [],
            messages: { 'app.nav.overview': '测试概览' },
          }}
        >
          <Probe />
        </I18nProvider>,
      ),
    ).toContain('测试概览');
  });

  it('falls back to the default English catalog without a provider', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('Overview');
  });

  it('falls back to English for keys missing from the current pack', () => {
    expect(
      renderToStaticMarkup(
        <I18nProvider
          state={{
            current: 'fr',
            direction: 'ltr',
            packs: [],
            messages: {},
          }}
        >
          <Probe />
        </I18nProvider>,
      ),
    ).toContain('Overview');
  });

  it('refreshes language state after install, use, and remove', async () => {
    let current = chineseState;
    const calls: string[] = [];
    const api = {
      getLanguageState: async () => current,
      chooseLanguagePack: async () => {
        calls.push('choose');
        return 'C:/packs/zh-CN.json';
      },
      installLanguagePack: async (input: { path: string; use?: boolean; force?: boolean }) => {
        calls.push(`install:${input.use}:${input.force}`);
        current = chineseState;
        return installReport;
      },
      useLanguage: async (locale: string) => {
        calls.push(`use:${locale}`);
        current = chineseState;
      },
      removeLanguage: async (locale: string) => {
        calls.push(`remove:${locale}`);
        current = englishState;
      },
    } as unknown as DesktopApi;
    const updates: string[] = [];
    const actions = createLanguageActions(api, (next) => {
      updates.push(next.current);
    });

    expect(await installPickedLanguage(actions)).toEqual(installReport);
    await actions.useLanguage('zh-CN');
    await actions.removeLanguage('zh-CN');

    expect(calls).toEqual([
      'choose',
      'install:true:true',
      'use:zh-CN',
      'remove:zh-CN',
    ]);
    expect(updates).toEqual(['zh-CN', 'zh-CN', 'en']);
  });

  it('does not install when the picker is cancelled', async () => {
    const chooseLanguagePack = vi.fn(async () => null);
    const installLanguagePack = vi.fn(async () => installReport);
    const actions = {
      chooseLanguagePack,
      installLanguagePack,
      useLanguage: async () => undefined,
      removeLanguage: async () => undefined,
    };

    expect(await installPickedLanguage(actions)).toBeNull();
    expect(installLanguagePack).not.toHaveBeenCalled();
  });
});
