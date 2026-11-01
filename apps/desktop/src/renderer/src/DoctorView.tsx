import { formatDoctorIssue } from '@skillink/shared';
import type { DoctorReport } from '@skillink/shared';
import { useI18n } from './i18n.js';

export interface DoctorViewProps {
  report: DoctorReport;
  busy?: boolean;
  onRefresh?: () => void;
  onApply?: () => void;
}

export function DoctorView({
  report,
  busy = false,
  onRefresh,
  onApply,
}: DoctorViewProps) {
  const { t, translator } = useI18n();

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('doctor.eyebrow')}</p>
            <h2>{t('doctor.heading')}</h2>
          </div>
          <div className="row-actions">
            <span className={report.ok ? 'health ok' : 'health warn'}>
              {report.ok
                ? t('status.healthy')
                : t('doctor.issues', { count: report.issues.length })}
            </span>
            <button
              className="secondary"
              type="button"
              onClick={onRefresh}
              disabled={busy || !onRefresh}
            >
              {t('doctor.refresh')}
            </button>
            <button
              className="primary"
              type="button"
              onClick={onApply}
              disabled={busy || !onApply}
            >
              {t('app.actions.applyRoutes')}
            </button>
          </div>
        </div>

        {report.issues.length === 0 ? (
          <p className="empty">{t('doctor.empty')}</p>
        ) : (
          <div className="issues">
            {report.issues.map((issue, index) => (
              <div className="issue-row" key={`${issue.code}-${index}`}>
                <code>{issue.code}</code>
                <span>{formatDoctorIssue(issue, translator)}</span>
                {issue.path ? <span className="path-value">{issue.path}</span> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
