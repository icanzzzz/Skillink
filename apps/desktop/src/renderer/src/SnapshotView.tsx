import type { DesktopSnapshot } from '../../shared.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compositionText(value: {
  skills: Record<string, string>;
  packages: Record<string, string>;
}): string {
  const parts: string[] = [];
  if (Object.keys(value.skills).length > 0) {
    parts.push(
      `skills: ${Object.entries(value.skills)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}`,
    );
  }
  if (Object.keys(value.packages).length > 0) {
    parts.push(
      `packages: ${Object.entries(value.packages)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}`,
    );
  }
  return parts.join('; ');
}

export function SnapshotView({ snapshot }: { snapshot: DesktopSnapshot }) {
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
          <p className="eyebrow">LOCAL-FIRST SKILL CONTROL</p>
          <h1>Skillink</h1>
          <p className="lede">
            Version skills once, compose them into packages, and project the
            resolved skills into the target directories you choose.
          </p>
        </div>
        <div className={snapshot.doctor.ok ? 'health ok' : 'health warn'}>
          {snapshot.doctor.ok ? 'healthy' : `${issueCount} issues`}
        </div>
      </section>

      <section className="stats">
        <article className="stat">
          <span className="stat-label">Skills</span>
          <strong>{skillEntries.length} skills</strong>
          <span>{skillVersionCount} versions</span>
        </article>
        <article className="stat">
          <span className="stat-label">Packages</span>
          <strong>{packageEntries.length} packages</strong>
          <span>{packageVersionCount} versions</span>
        </article>
        <article className="stat">
          <span className="stat-label">Targets</span>
          <strong>{targetCount} targets</strong>
          <span>
            {
              snapshot.route.targets.filter((target) => target.enabled).length
            }{' '}
            enabled
          </span>
        </article>
        <article className="stat">
          <span className="stat-label">Links</span>
          <strong>{okLinks} healthy</strong>
          <span>{snapshot.status.entries.length} checked</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ROUTES</p>
            <h2>Target directories</h2>
          </div>
          <span className="count">{targetCount}</span>
        </div>

        {targetCount === 0 ? (
          <p className="empty">
            No targets yet. Add a directory from the CLI or the target form.
          </p>
        ) : (
          <div className="table">
            <div className="table-row table-head">
              <span>Target</span>
              <span>Path</span>
              <span>Mode</span>
              <span>Packages</span>
              <span>Skills</span>
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
                      ? 'unresolved'
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
            <p className="eyebrow">PACKAGES</p>
            <h2>Compositions</h2>
          </div>
          <span className="count">{packageEntries.length}</span>
        </div>

        {packageEntries.length === 0 ? (
          <p className="empty">
            No packages yet. Create a package from installed skills.
          </p>
        ) : (
          <div className="package-grid">
            {packageEntries.map(([name, entry]) => (
              <article className="package-card" key={name}>
                <div className="package-title">
                  <strong>{name}</strong>
                  <span>package</span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}
                <div className="version-list">
                  {Object.entries(entry.versions).map(([version, value]) => (
                    <div className="version-row" key={version}>
                      <code>{version}</code>
                      <span>{compositionText(value)}</span>
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
            <p className="eyebrow">SKILLS</p>
            <h2>Installed skills</h2>
          </div>
          <span className="count">{skillEntries.length}</span>
        </div>

        {skillEntries.length === 0 ? (
          <p className="empty">
            No skills yet. Import a folder containing <code>SKILL.md</code>.
          </p>
        ) : (
          <div className="package-grid">
            {skillEntries.map(([name, entry]) => (
              <article className="package-card" key={name}>
                <div className="package-title">
                  <strong>{name}</strong>
                  <span>skill</span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}
                <div className="version-list">
                  {Object.entries(entry.versions).map(([version, info]) => (
                    <div className="version-row" key={version}>
                      <code>{version}</code>
                      <span>{info.fileCount} files</span>
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
              <p className="eyebrow">DOCTOR</p>
              <h2>Needs attention</h2>
            </div>
            <span className="count warn">{issueCount}</span>
          </div>
          {snapshot.doctor.issues.map((issue, index) => (
            <div className="issue-row" key={`${issue.code}-${index}`}>
              <code>{issue.code}</code>
              <span>{issue.message}</span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
