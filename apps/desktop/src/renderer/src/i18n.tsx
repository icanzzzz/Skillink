import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  EN_MESSAGES,
  createTranslator,
  type LanguagePackSummary,
  type LanguageState,
  type LocaleInstallReport,
  type Translator,
} from '@skillink/shared';
import type { LanguageInstallRequest } from '../../ipc-schemas.js';
import type { DesktopApi } from '../../shared.js';

export interface I18nContextValue {
  state: LanguageState;
  translator: Translator;
  t: Translator['t'];
  formatDate: Translator['formatDate'];
  formatNumber: Translator['formatNumber'];
  chooseLanguagePack(): Promise<string | null>;
  installLanguagePack(
    input: LanguageInstallRequest,
  ): Promise<LocaleInstallReport>;
  useLanguage(locale: string): Promise<void>;
  removeLanguage(locale: string): Promise<void>;
}

const ENGLISH_PACK: LanguagePackSummary = {
  locale: 'en',
  name: 'English',
  nativeName: 'English',
  version: '1.0.0',
  direction: 'ltr',
  messageCount: Object.keys(EN_MESSAGES).length,
  coverage: 1,
  builtIn: true,
};

const ENGLISH_STATE: LanguageState = {
  current: 'en',
  direction: 'ltr',
  packs: [ENGLISH_PACK],
  messages: EN_MESSAGES,
};

const ENGLISH_TRANSLATOR = createTranslator('en', EN_MESSAGES);

const DEFAULT_CONTEXT: I18nContextValue = {
  state: ENGLISH_STATE,
  translator: ENGLISH_TRANSLATOR,
  t: ENGLISH_TRANSLATOR.t,
  formatDate: ENGLISH_TRANSLATOR.formatDate,
  formatNumber: ENGLISH_TRANSLATOR.formatNumber,
  chooseLanguagePack: async () => null,
  installLanguagePack: async () => {
    throw new Error(ENGLISH_TRANSLATOR.t('language.unavailable'));
  },
  useLanguage: async () => undefined,
  removeLanguage: async () => undefined,
};

const I18nContext = createContext<I18nContextValue>(DEFAULT_CONTEXT);

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export interface I18nProviderProps {
  api?: DesktopApi;
  state?: LanguageState;
  children: ReactNode;
}

export function I18nProvider({
  api,
  state: providedState,
  children,
}: I18nProviderProps): ReactNode {
  const resolvedApi =
    api ?? (typeof window !== 'undefined' ? window.skillink : undefined);
  const [state, setState] = useState<LanguageState>(
    providedState ?? ENGLISH_STATE,
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!resolvedApi) {
      return;
    }
    setState(await resolvedApi.getLanguageState());
  }, [resolvedApi]);

  useEffect(() => {
    if (providedState || !resolvedApi) {
      return;
    }

    let active = true;
    resolvedApi
      .getLanguageState()
      .then((next) => {
        if (active) {
          setState(next);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [providedState, resolvedApi]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.lang = state.current;
    document.documentElement.dir = state.direction;
  }, [state.current, state.direction]);

  const translator = useMemo(
    () => createTranslator(state.current, state.messages),
    [state.current, state.messages],
  );

  const chooseLanguagePack = useCallback(async (): Promise<string | null> => {
    return resolvedApi ? resolvedApi.chooseLanguagePack() : null;
  }, [resolvedApi]);

  const installLanguagePack = useCallback(
    async (input: LanguageInstallRequest): Promise<LocaleInstallReport> => {
      if (!resolvedApi) {
        throw new Error(translator.t('language.unavailable'));
      }
      const report = await resolvedApi.installLanguagePack(input);
      await refresh();
      return report;
    },
    [refresh, resolvedApi, translator],
  );

  const useLanguage = useCallback(
    async (locale: string): Promise<void> => {
      if (!resolvedApi) {
        return;
      }
      await resolvedApi.useLanguage(locale);
      await refresh();
    },
    [refresh, resolvedApi],
  );

  const removeLanguage = useCallback(
    async (locale: string): Promise<void> => {
      if (!resolvedApi) {
        return;
      }
      await resolvedApi.removeLanguage(locale);
      await refresh();
    },
    [refresh, resolvedApi],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      state,
      translator,
      t: translator.t,
      formatDate: translator.formatDate,
      formatNumber: translator.formatNumber,
      chooseLanguagePack,
      installLanguagePack,
      useLanguage,
      removeLanguage,
    }),
    [
      state,
      translator,
      chooseLanguagePack,
      installLanguagePack,
      useLanguage,
      removeLanguage,
    ],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export type { LanguageInstallRequest };
