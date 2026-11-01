import { describe, expect, it } from 'vitest';
import type { LanguageState } from '@skillink/shared';
import { LanguageDialog } from './LanguageDialog.js';
import { renderWithLanguageState } from './i18n.test-utils.js';

const state: LanguageState = {
  current: 'zh-CN',
  direction: 'ltr',
  messages: {
    'language.title': '语言',
    'language.install': '安装语言包…',
    'language.current': '当前',
  },
  packs: [
    {
      locale: 'en',
      name: 'English',
      nativeName: 'English',
      version: '1.0.0',
      direction: 'ltr',
      messageCount: 1,
      coverage: 1,
      builtIn: true,
    },
    {
      locale: 'zh-CN',
      name: 'Chinese (Simplified)',
      nativeName: '简体中文',
      version: '1.0.0',
      direction: 'ltr',
      messageCount: 1,
      coverage: 1,
      builtIn: false,
    },
  ],
};

describe('LanguageDialog', () => {
  it('lists installed languages and the current selection', () => {
    const html = renderWithLanguageState(
      <LanguageDialog open onClose={() => undefined} />,
      state,
    );

    expect(html).toContain('语言');
    expect(html).toContain('安装语言包…');
    expect(html).toContain('简体中文');
    expect(html).toContain('当前');
  });

  it('renders nothing when closed', () => {
    const html = renderWithLanguageState(
      <LanguageDialog open={false} onClose={() => undefined} />,
      state,
    );

    expect(html).not.toContain('language-dialog');
    expect(html).not.toContain('简体中文');
  });
});
