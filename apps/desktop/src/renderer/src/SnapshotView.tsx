import { formatDoctorIssue } from '@skillink/shared';
import type { DesktopSnapshot } from '../../shared.js';
import { useI18n } from './i18n.js';
import { compositionText, formatBytes } from './format.js';

export function SnapshotView({ snapshot }: { snapshot: DesktopSnapshot }) {
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
        </div>
        <div className={snapshot.doctor.ok ? 'health ok' : 'health warn'}>
          {snapshot.doctor.ok
            ? t('overview.health.healthy')
            : t('overview.health.issues', { count: issueCount })}
        </div>
      </section>

      <section className="stats">
        <article className="stat">
          <span className="stat-label">{t('overview.stats.skills.label')}</span>
          <strong>
            {t('overview.stats.skills', { count: skillEntries.length })}
          </strong>
          <span>
            {t('overview.stats.versions', { count: skillVersionCount })}
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">
            {t('overview.stats.packages.label')}
          </span>
          <strong>
            {t('overview.stats.packages', { count: packageEntries.length })}
          </strong>
          <span>
            {t('overview.stats.versions', { count: packageVersionCount })}
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">{t('overview.stats.targets.label')}</span>
          <strong>{t('overview.stats.targets', { count: targetCount })}</strong>
          <span>
            {t('overview.stats.enabled', {
              count: snapshot.route.targets.filter((target) => target.enabled)
                .length,
            })}
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">{t('overview.stats.links.label')}</span>
          <strong>{t('overview.stats.links', { count: okLinks })}</strong>
          <span>
            {t('overview.stats.checked', {
              count: snapshot.status.entries.length,
            })}
          </span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('overview.routes.eyebrow')}</p>
            <h2>{t('overview.routes.title')}</h2>
          </div>
          <span className="count">{targetCount}</span>
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
            <p className="eyebrow">{t('overview.packages.eyebrow')}</p>
            <h2>{t('overview.packages.title')}</h2>
          </div>
          <span className="count">{packageEntries.length}</span>
        </div>

        {packageEntries.length === 0 ? (
          <p className="empty">{t('overview.packages.empty')}</p>
        ) : (
          <div className="package-grid">
            {packageEntries.map(([name, entry]) => (
              <article className="package-card" key={name}>
                <div className="package-title">
                  <strong>{name}</strong>
                  <span>{t('overview.badge.package')}</span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}
                <div className="version-list">
                  {Object.entries(entry.versions).map(([version, value]) => (
                    <div className="version-row" key={version}>
                      <code>{version}</code>
                      <span>
                        {compositionText(value, t, {
                          skills: 'overview.composition.skills',
                          packages: 'overview.composition.packages',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('overview.skills.eyebrow')}</p>
            <h2>{t('overview.skills.title')}</h2>
          </div>
          <span className="count">{skillEntries.length}</span>
        </div>

        {skillEntries.length === 0 ? (
          <p className="empty">{t('overview.skills.empty')}</p>
        ) : (
          <div className="package-grid">
            {skillEntries.map(([name, entry]) => (
              <article className="package-card" key={name}>
                <div className="package-title">
                  <strong>{name}</strong>
                  <span>{t('overview.badge.skill')}</span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}
                <div className="version-list">
                  {Object.entries(entry.versions).map(([version, info]) => (
                    <div className="version-row" key={version}>
                      <code>{version}</code>
                      <span>
                        {t('overview.files', { count: info.fileCount })}
                      </span>
                      <span>{formatBytes(info.size)}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
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
