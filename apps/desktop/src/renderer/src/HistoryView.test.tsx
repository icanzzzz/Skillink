import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HistoryView } from './HistoryView.js';
import { renderWithMessages } from './i18n.test-utils.js';

describe('HistoryView', () => {
  it('renders snapshot ids and rollback buttons', () => {
    const html = renderToStaticMarkup(
      <HistoryView
        entries={[
          {
            id: '2026-10-30T12-00-00-000Z',
            path: 'C:/home/history/2026-10-30T12-00-00-000Z',
            createdAt: '2026-10-30T12:00:00.000Z',
            reason: 'add-route-entry',
          },
        ]}
      />,
    );

    expect(html).toContain('2026-10-30T12-00-00-000Z');
    expect(html).toContain('add-route-entry');
    expect(html).toContain('Rollback');
  });

  it('renders the empty state', () => {
    const html = renderToStaticMarkup(<HistoryView entries={[]} />);

    expect(html).toContain('No history yet');
  });

  it('renders translated history text', () => {
    const html = renderWithMessages(<HistoryView entries={[]} />, {
      'history.heading': '历史记录',
      'history.empty': '还没有历史记录。',
    });

    expect(html).toContain('历史记录');
    expect(html).toContain('还没有历史记录。');
  });
});
