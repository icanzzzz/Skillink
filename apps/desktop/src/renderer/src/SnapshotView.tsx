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

export function SnapshotView({ snapshot }: { snapshot: DesktopSnapshot }) {
  const packages = Object.entries(snapshot.library.packages);
  const versionCount = packages.reduce(
    (total, [, entry]) => total + Object.keys(entry.versions).length,
    0,
  );
  const targetCount = snapshot.route.targets.length;
  const okLinks = snapshot.status.entries.filter((entry) => entry.state === 'ok').length;
  const issueCount = snapshot.doctor.issues.length;

  return (
    <main className="snapshot">
      <section className="hero">
        <div>
          <p className="eyebrow">LOCAL-FIRST PACKAGE CONTROL</p>
          <h1>Skillink</h1>
          <p className="lede">
            Version any folder, keep one public library, and project packages into
            the target directories you choose.
          </p>
        </div>
        <div className={snapshot.doctor.ok ? 'health ok' : 'health warn'}>
          {snapshot.doctor.ok ? 'healthy' : `${issueCount} issues`}
        </div>
      </section>

      <section className="stats">
        <article className="stat">
          <span className="stat-label">Public library</span>
          <strong>{packages.length} packages</strong>
          <span>{versionCount} versions</span>
        </article>
        <article className="stat">
          <span className="stat-label">Targets</span>
          <strong>{targetCount} targets</strong>
          <span>{snapshot.route.targets.filter((target) => target.enabled).length} enabled</span>
        </article>
        <article className="stat">
          <span className="stat-label">Links</span>
          <strong>{okLinks} healthy</strong>
          <span>{snapshot.status.entries.length} checked</span>
        </article>
        <article className="stat">
          <span className="stat-label">Control plane</span>
          <strong className="path-value">{snapshot.home}</strong>
          <span>route.json + skills.json</span>
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
            </div>
            {snapshot.route.targets.map((target) => (
              <div className="table-row" key={target.id}>
                <span>
                  <strong>{target.label ?? target.id}</strong>
                  <small>{target.id}</small>
                </span>
                <span className="path-value">{target.path}</span>
                <span>{target.mode}</span>
                <span>{Object.keys(target.skills).length}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PUBLIC LIBRARY</p>
            <h2>Packages</h2>
          </div>
          <span className="count">{packages.length}</span>
        </div>

        {packages.length === 0 ? (
          <p className="empty">
            No packages yet. Import any folder with <code>skillink add &lt;folder&gt;</code>.
          </p>
        ) : (
          <div className="package-grid">
            {packages.map(([name, entry]) => (
              <article className="package-card" key={name}>
                <div className="package-title">
                  <strong>{name}</strong>
                  <span>{entry.kind}</span>
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
