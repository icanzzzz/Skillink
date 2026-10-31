import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './i18n.js';

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
});
