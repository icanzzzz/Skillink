import { formatDoctorIssue } from '@skillink/shared';
import type { DesktopSnapshot } from '../../shared.js';
import { useI18n } from './i18n.js';
import { compositionText } from './format.js';

export type OverviewDestination = 'targets' | 'skills' | 'packages' | 'doctor';

export interface SnapshotViewProps {
  snapshot: DesktopSnapshot;
  onApply?: () => void;
  onNavigate?: (destination: OverviewDestination) => void;
}

export function SnapshotView({
  snapshot,
  onApply,
  onNavigate,
}: SnapshotViewProps) {
  const { t, translator } = useI18n();
  const skillEntries = Object.entries(snapshot.skills.skills);
  const skillVersionCount = skillEntries.reduce(
    (total, [, entry]) => total + Object.keys(entry.versions).length,
    0,
  );
  const packageEntries = Object.entries(snapshot.packages.packages);
  const packageVersionCount = packageEntries.reduce(
    (total, [, entry]) => total + Object.keys(entry.versions).length,
    0,
  );
  const targetCount = snapshot.route.targets.length;
  const targetSkills = new Map(
    (snapshot.targetSkills ?? []).map((summary) => [
      summary.targetId,
      summary,
    ]),
  );
  const okLinks = snapshot.status.entries.filter(
    (entry) => entry.state === 'ok',
  ).length;
  const issueCount = snapshot.doctor.issues.length;

  return (
    <main className="snapshot">
      <section className="hero">
        <div>
          <p className="eyebrow">{t('overview.hero.eyebrow')}</p>
          <h1>{t('overview.hero.title')}</h1>
          <p className="lede">{t('overview.hero.lede')}</p>
          <div className="hero-actions">
            <button
              className="primary"
              type="button"
              onClick={onApply}
              disabled={!onApply}
            >
              {t('app.actions.applyRoutes')}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => onNavigate?.('targets')}
              disabled={!onNavigate}
            >
              {t('app.actions.manageTargets')}
            </button>
          </div>
        </div>
        <div className={snapshot.doctor.ok ? 'health ok' : 'health warn'}>
          {snapshot.doctor.ok
            ? t('overview.health.healthy')
            : t('overview.health.issues', { count: issueCount })}
        </div>
      </section>

      <section className="stats">
        <button
          className="stat"
          type="button"
          onClick={() => onNavigate?.('skills')}
          disabled={!onNavigate}
        >
          <span className="stat-label">{t('overview.stats.skills.label')}</span>
          <strong>
            {t('overview.stats.skills', { count: skillEntries.length })}
          </strong>
          <span>
            {t('overview.stats.versions', { count: skillVersionCount })}
          </span>
        </button>
        <button
          className="stat"
          type="button"
          onClick={() => onNavigate?.('packages')}
          disabled={!onNavigate}
        >
          <span className="stat-label">
            {t('overview.stats.packages.label')}
          </span>
          <strong>
            {t('overview.stats.packages', { count: packageEntries.length })}
          </strong>
          <span>
            {t('overview.stats.versions', { count: packageVersionCount })}
          </span>
        </button>
        <button
          className="stat"
          type="button"
          onClick={() => onNavigate?.('targets')}
          disabled={!onNavigate}
        >
          <span className="stat-label">{t('overview.stats.targets.label')}</span>
          <strong>{t('overview.stats.targets', { count: targetCount })}</strong>
          <span>
            {t('overview.stats.enabled', {
              count: snapshot.route.targets.filter((target) => target.enabled)
                .length,
            })}
          </span>
        </button>
        <button
          className="stat"
          type="button"
          onClick={() => onNavigate?.('doctor')}
          disabled={!onNavigate}
        >
          <span className="stat-label">{t('overview.stats.links.label')}</span>
          <strong>{t('overview.stats.links', { count: okLinks })}</strong>
          <span>
            {t('overview.stats.checked', {
              count: snapshot.status.entries.length,
            })}
          </span>
        </button>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('overview.routes.eyebrow')}</p>
            <h2>{t('overview.routes.title')}</h2>
          </div>
          <div className="panel-heading-tools">
            <span className="count">{targetCount}</span>
            <button
              className="secondary"
              type="button"
              onClick={() => onNavigate?.('targets')}
              disabled={!onNavigate}
            >
              {t('app.actions.manageTargets')}
            </button>
          </div>
        </div>

        {targetCount === 0 ? (
          <p className="empty">{t('overview.routes.empty')}</p>
        ) : (
          <div className="table">
            <div className="table-row table-head">
              <span>{t('overview.table.target')}</span>
              <span>{t('overview.table.path')}</span>
              <span>{t('overview.table.mode')}</span>
              <span>{t('overview.table.packages')}</span>
              <span>{t('overview.table.skills')}</span>
            </div>
            {snapshot.route.targets.map((target) => {
              const summary = targetSkills.get(target.id);
              return (
                <div className="table-row" key={target.id}>
                  <span>
                    <strong>{target.label ?? target.id}</strong>
                    <small>{target.id}</small>
                  </span>
                  <span className="path-value">{target.path}</span>
                  <span>{target.mode}</span>
                  <span>{Object.keys(target.packages).length}</span>
                  <span>
                    {summary?.error
                      ? t('status.unresolved')
                      : (summary?.skills.length ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('overview.library.eyebrow')}</p>
            <h2>{t('overview.library.title')}</h2>
          </div>
        </div>

        <div className="library-grid">
          <div className="library-column">
            <div className="library-column-heading">
              <h3>{t('overview.library.skills')}</h3>
              <span className="count">{skillEntries.length}</span>
            </div>
            {skillEntries.length === 0 ? (
              <p className="empty">{t('overview.skills.empty')}</p>
            ) : (
              <ul className="library-list">
                {skillEntries.slice(0, 5).map(([name, entry]) => (
                  <li key={name}>
                    <strong>{name}</strong>
                    <span>
                      {t('overview.library.versions', {
                        count: Object.keys(entry.versions).length,
                      })}
                    </span>
                    <small>
                      {entry.description ||
                        Object.keys(entry.versions).join(', ')}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="secondary library-open"
              type="button"
              onClick={() => onNavigate?.('skills')}
              disabled={!onNavigate}
            >
              {t('app.actions.viewAll')}
            </button>
          </div>

          <div className="library-column">
            <div className="library-column-heading">
              <h3>{t('overview.library.packages')}</h3>
              <span className="count">{packageEntries.length}</span>
            </div>
            {packageEntries.length === 0 ? (
              <p className="empty">{t('overview.packages.empty')}</p>
            ) : (
              <ul className="library-list">
                {packageEntries.slice(0, 5).map(([name, entry]) => {
                  const versions = Object.entries(entry.versions);
                  return (
                    <li key={name}>
                      <strong>{name}</strong>
                      <span>
                        {t('overview.library.versions', {
                          count: versions.length,
                        })}
                      </span>
                      <small>
                        {entry.description ||
                          versions
                            .slice(0, 2)
                            .map(([, value]) =>
                              compositionText(value, t, {
                                skills: 'overview.composition.skills',
                                packages: 'overview.composition.packages',
                              }),
                            )
                            .join(' · ')}
                      </small>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              className="secondary library-open"
              type="button"
              onClick={() => onNavigate?.('packages')}
              disabled={!onNavigate}
            >
              {t('app.actions.viewAll')}
            </button>
          </div>
        </div>
      </section>

      {issueCount > 0 ? (
        <section className="panel issues">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t('overview.issues.eyebrow')}</p>
              <h2>{t('overview.issues.title')}</h2>
            </div>
            <span className="count warn">{issueCount}</span>
          </div>
          {snapshot.doctor.issues.map((issue, index) => (
            <div className="issue-row" key={`${issue.code}-${index}`}>
              <code>{issue.code}</code>
              <span>{formatDoctorIssue(issue, translator)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
