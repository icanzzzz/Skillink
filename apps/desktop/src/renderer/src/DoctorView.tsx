import type { DoctorReport } from '@skillink/shared';

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
  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DIAGNOSTICS</p>
            <h2>Doctor</h2>
          </div>
          <div className="row-actions">
            <span className={report.ok ? 'health ok' : 'health warn'}>
              {report.ok ? 'healthy' : `${report.issues.length} issues`}
            </span>
            <button
              className="secondary"
              type="button"
              onClick={onRefresh}
              disabled={busy || !onRefresh}
            >
              Refresh
            </button>
            <button
              className="primary"
              type="button"
              onClick={onApply}
              disabled={busy || !onApply}
            >
              Apply routes
            </button>
          </div>
        </div>

        {report.issues.length === 0 ? (
          <p className="empty">
            No issues found. route.json, package.json, skill.json, the skill
            library, and links are consistent.
          </p>
        ) : (
          <div className="issues">
            {report.issues.map((issue, index) => (
              <div className="issue-row" key={`${issue.code}-${index}`}>
                <code>{issue.code}</code>
                <span>{issue.message}</span>
                {issue.path ? <span className="path-value">{issue.path}</span> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
