import { useState } from 'react';
import type { HistoryEntry } from '@skillink/shared';

export interface HistoryViewProps {
  entries: HistoryEntry[];
  busy?: boolean;
  onRollback?: (id: string, applyAfter: boolean) => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function HistoryView({
  entries,
  busy = false,
  onRollback,
}: HistoryViewProps) {
  const [applyAfter, setApplyAfter] = useState(false);

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">HISTORY</p>
            <h2>Route, package, and skill snapshots</h2>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={applyAfter}
              onChange={(event) => setApplyAfter(event.target.checked)}
            />
            Apply after rollback
          </label>
        </div>

        {entries.length === 0 ? (
          <p className="empty">
            No history yet. Route, package, and skill changes create snapshots
            automatically.
          </p>
        ) : (
          <div className="history-list">
            {entries.map((entry) => (
              <article className="history-row" key={entry.id}>
                <div>
                  <code>{entry.id}</code>
                  <span>{entry.reason}</span>
                </div>
                <div className="history-meta">
                  <span>{formatTime(entry.createdAt)}</span>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !onRollback}
                    onClick={() => onRollback?.(entry.id, applyAfter)}
                  >
                    Rollback
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
