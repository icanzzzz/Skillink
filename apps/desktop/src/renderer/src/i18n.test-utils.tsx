import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import {
  EN_MESSAGES,
  type LanguagePackSummary,
  type LanguageState,
  type MessageCatalog,
} from '@skillink/shared';
import { I18nProvider } from './i18n.js';

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

export function renderWithMessages(
  node: ReactNode,
  overrides: MessageCatalog,
  packs: LanguagePackSummary[] = [ENGLISH_PACK],
): string {
  return renderWithLanguageState(node, {
    current: 'en',
    direction: 'ltr',
    packs,
    messages: overrides,
  });
}

export function renderWithLanguageState(
  node: ReactNode,
  state: LanguageState,
): string {
  return renderToStaticMarkup(
    <I18nProvider state={state}>{node}</I18nProvider>,
  );
}
