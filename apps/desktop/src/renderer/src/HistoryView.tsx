import { useState } from 'react';
import type { HistoryEntry } from '@skillink/shared';
import { useI18n } from './i18n.js';

export interface HistoryViewProps {
  entries: HistoryEntry[];
  busy?: boolean;
  onRollback?: (id: string, applyAfter: boolean) => void;
}

export function HistoryView({
  entries,
  busy = false,
  onRollback,
}: HistoryViewProps) {
  const { t, formatDate } = useI18n();
  const [applyAfter, setApplyAfter] = useState(false);

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('history.eyebrow')}</p>
            <h2>{t('history.heading')}</h2>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={applyAfter}
              onChange={(event) => setApplyAfter(event.target.checked)}
            />
            {t('history.applyAfter')}
          </label>
        </div>

        {entries.length === 0 ? (
          <p className="empty">{t('history.empty')}</p>
        ) : (
          <div className="history-list">
            {entries.map((entry) => (
              <article className="history-row" key={entry.id}>
                <div>
                  <code>{entry.id}</code>
                  <span>{entry.reason}</span>
                </div>
                <div className="history-meta">
                  <span>{formatDate(entry.createdAt)}</span>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !onRollback}
                    onClick={() => onRollback?.(entry.id, applyAfter)}
                  >
                    {t('history.rollback')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
