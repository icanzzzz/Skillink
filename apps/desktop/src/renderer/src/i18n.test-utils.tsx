import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import {
  EN_LANGUAGE_SUMMARY,
  type LanguagePackSummary,
  type LanguageState,
  type MessageCatalog,
} from '@skillink/shared';
import { I18nProvider } from './i18n.js';

export function renderWithMessages(
  node: ReactNode,
  overrides: MessageCatalog,
  packs: LanguagePackSummary[] = [EN_LANGUAGE_SUMMARY],
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
