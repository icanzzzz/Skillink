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

export interface LanguageActions {
  chooseLanguagePack(): Promise<string | null>;
  installLanguagePack(
    input: LanguageInstallRequest,
  ): Promise<LocaleInstallReport>;
  useLanguage(locale: string): Promise<void>;
  removeLanguage(locale: string): Promise<void>;
}

/**
 * Creates the state-updating language operations used by the provider.
 * Every successful operation re-reads the authoritative language state so
 * the UI switches immediately without a restart.
 */
export function createLanguageActions(
  api: DesktopApi,
  onState: (state: LanguageState) => void,
): LanguageActions {
  async function refresh(): Promise<void> {
    onState(await api.getLanguageState());
  }

  return {
    chooseLanguagePack: () => api.chooseLanguagePack(),
    installLanguagePack: async (input) => {
      const report = await api.installLanguagePack(input);
      await refresh();
      return report;
    },
    useLanguage: async (locale) => {
      await api.useLanguage(locale);
      await refresh();
    },
    removeLanguage: async (locale) => {
      await api.removeLanguage(locale);
      await refresh();
    },
  };
}

export async function installPickedLanguage(actions: {
  chooseLanguagePack(): Promise<string | null>;
  installLanguagePack(
    input: LanguageInstallRequest,
  ): Promise<LocaleInstallReport>;
}): Promise<LocaleInstallReport | null> {
  const selected = await actions.chooseLanguagePack();
  if (!selected) {
    return null;
  }
  return actions.installLanguagePack({
    path: selected,
    use: true,
    force: true,
  });
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

  const actions = useMemo(
    () => (resolvedApi ? createLanguageActions(resolvedApi, setState) : undefined),
    [resolvedApi],
  );

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
    return actions?.chooseLanguagePack() ?? null;
  }, [actions]);

  const installLanguagePack = useCallback(
    async (input: LanguageInstallRequest): Promise<LocaleInstallReport> => {
      if (!actions) {
        throw new Error(translator.t('language.unavailable'));
      }
      return actions.installLanguagePack(input);
    },
    [actions, translator],
  );

  const useLanguage = useCallback(
    async (locale: string): Promise<void> => {
      await actions?.useLanguage(locale);
    },
    [actions],
  );

  const removeLanguage = useCallback(
    async (locale: string): Promise<void> => {
      await actions?.removeLanguage(locale);
    },
    [actions],
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
