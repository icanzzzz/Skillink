import { useState, type FormEvent } from 'react';
import type {
  ApplyReport,
  StatusEntry,
  TargetSkillSummary,
} from '@skillink/core';
import type { TargetMode, TargetRoute } from '@skillink/shared';

export interface AddTargetFormInput {
  path: string;
  id?: string;
  label?: string;
  mode?: TargetMode;
}

export interface RouteAddFormInput {
  targetId: string;
  name: string;
  requested: string;
}

export interface TargetRemoveFormInput {
  id: string;
}

export interface TargetEnableFormInput {
  id: string;
  enabled: boolean;
}

export interface RouteRemoveFormInput {
  targetId: string;
  name: string;
}

export interface RouteEnableFormInput {
  targetId: string;
  name: string;
  enabled: boolean;
}

export interface ApplyOptionsInput {
  prune?: boolean;
}

export interface TargetsViewProps {
  targets: TargetRoute[];
  statusEntries?: StatusEntry[];
  targetSkills?: TargetSkillSummary[];
  applyReport?: ApplyReport | null;
  busy?: boolean;
  onBrowse?: () => Promise<string | null> | string | null;
  onAddTarget?: (input: AddTargetFormInput) => void;
  onRemoveTarget?: (input: TargetRemoveFormInput) => void;
  onTargetEnable?: (input: TargetEnableFormInput) => void;
  onRouteAdd?: (input: RouteAddFormInput) => void;
  onRemoveRoute?: (input: RouteRemoveFormInput) => void;
  onRouteEnable?: (input: RouteEnableFormInput) => void;
  onApply?: (options?: ApplyOptionsInput) => void;
  onPreview?: (options?: ApplyOptionsInput) => void;
}

function packageCountLabel(count: number): string {
  return `${count} package${count === 1 ? '' : 's'}`;
}

function skillCountLabel(count: number): string {
  return `${count} skill${count === 1 ? '' : 's'}`;
}

export function TargetsView({
  targets,
  statusEntries = [],
  targetSkills = [],
  applyReport = null,
  busy = false,
  onBrowse,
  onAddTarget,
  onRemoveTarget,
  onTargetEnable,
  onRouteAdd,
  onRemoveRoute,
  onRouteEnable,
  onApply,
  onPreview,
}: TargetsViewProps) {
  const [targetPath, setTargetPath] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [mode, setMode] = useState<TargetMode>('link');
  const [routeTarget, setRouteTarget] = useState(targets[0]?.id ?? '');
  const [routeName, setRouteName] = useState('');
  const [routeVersion, setRouteVersion] = useState('');
  const [prune, setPrune] = useState(false);

  async function browse(): Promise<void> {
    const selected = await onBrowse?.();
    if (typeof selected === 'string') {
      setTargetPath(selected);
    }
  }

  function submitTarget(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onAddTarget || targetPath.trim() === '') {
      return;
    }

    onAddTarget({
      path: targetPath.trim(),
      id: targetId.trim() || undefined,
      label: targetLabel.trim() || undefined,
      mode,
    });
    setTargetPath('');
    setTargetId('');
    setTargetLabel('');
  }

  function submitRoute(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (
      !onRouteAdd ||
      routeTarget === '' ||
      routeName.trim() === '' ||
      routeVersion.trim() === ''
    ) {
      return;
    }

    onRouteAdd({
      targetId: routeTarget,
      name: routeName.trim(),
      requested: routeVersion.trim(),
    });
    setRouteName('');
    setRouteVersion('');
  }

  const statusByTarget = new Map<string, StatusEntry[]>();
  for (const entry of statusEntries) {
    const bucket = statusByTarget.get(entry.targetId) ?? [];
    bucket.push(entry);
    statusByTarget.set(entry.targetId, bucket);
  }

  const skillsByTarget = new Map(
    targetSkills.map((summary) => [summary.targetId, summary]),
  );
  const assignments = targets.flatMap((target) =>
    Object.entries(target.packages).map(([name, lock]) => ({
      target,
      name,
      lock,
    })),
  );

  function targetStatus(targetIdValue: string): string {
    const entries = statusByTarget.get(targetIdValue);
    if (!entries || entries.length === 0) {
      return '—';
    }
    const issue = entries.find(
      (entry) => entry.state !== 'ok' && entry.state !== 'disabled',
    );
    return issue ? issue.state : 'ok';
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ROUTES</p>
            <h2>Target directories</h2>
          </div>
          <div className="row-actions">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={prune}
                onChange={(event) => setPrune(event.target.checked)}
                disabled={busy}
              />
              Prune
            </label>
            <button
              className="secondary"
              type="button"
              onClick={() => onPreview?.({ prune })}
              disabled={busy || !onPreview}
            >
              Preview apply
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => onApply?.({ prune })}
              disabled={busy || !onApply}
            >
              Apply routes
            </button>
          </div>
        </div>

        {targets.length === 0 ? (
          <p className="empty">
            No targets yet. Choose a directory that should directly contain skill
            folders.
          </p>
        ) : (
          <div className="table targets-table">
            <div className="table-row table-head">
              <span>Target</span>
              <span>Path</span>
              <span>Mode</span>
              <span>Packages</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {targets.map((target) => {
              const count = Object.keys(target.packages).length;
              const resolved = skillsByTarget.get(target.id);
              return (
                <div className="table-row" key={target.id}>
                  <span>
                    <strong>{target.label ?? target.id}</strong>
                    <small>{target.id}</small>
                  </span>
                  <span className="path-value">{target.path}</span>
                  <span>{target.mode}</span>
                  <span>
                    {packageCountLabel(count)}
                    {resolved && !resolved.error
                      ? ` · ${skillCountLabel(resolved.skills.length)}`
                      : ''}
                    {resolved?.error ? ' · unresolved' : ''}
                  </span>
                  <span>{targetStatus(target.id)}</span>
                  <span className="row-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || !onTargetEnable}
                      onClick={() =>
                        onTargetEnable?.({
                          id: target.id,
                          enabled: !target.enabled,
                        })
                      }
                    >
                      {target.enabled ? 'Disable target' : 'Enable target'}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={busy || !onRemoveTarget}
                      onClick={() => onRemoveTarget?.({ id: target.id })}
                    >
                      Remove target
                    </button>
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
            <h2>Package assignments</h2>
          </div>
          <span className="count">{assignments.length}</span>
        </div>

        {assignments.length === 0 ? (
          <p className="empty">No package assignments.</p>
        ) : (
          <div className="table">
            <div className="table-row table-head">
              <span>Target</span>
              <span>Package</span>
              <span>Version</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {assignments.map(({ target, name, lock }) => (
              <div className="table-row" key={`${target.id}/${name}`}>
                <span>{target.label ?? target.id}</span>
                <span>
                  <code>{name}</code>
                </span>
                <span>{lock.resolved}</span>
                <span>{lock.enabled === false ? 'disabled' : 'enabled'}</span>
                <span className="row-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !onRouteEnable}
                    onClick={() =>
                      onRouteEnable?.({
                        targetId: target.id,
                        name,
                        enabled: lock.enabled === false,
                      })
                    }
                  >
                    {lock.enabled === false ? 'Enable route' : 'Disable route'}
                  </button>
                  <button
                    className="danger"
                    type="button"
                    disabled={busy || !onRemoveRoute}
                    onClick={() =>
                      onRemoveRoute?.({ targetId: target.id, name })
                    }
                  >
                    Remove route
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {applyReport ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">APPLY</p>
              <h2>{applyReport.dryRun ? 'Apply preview' : 'Apply result'}</h2>
            </div>
            <span className="count">
              {applyReport.operations.length} operations ·{' '}
              {applyReport.conflicts.length} conflicts
            </span>
          </div>
          <p className="empty">
            {applyReport.dryRun ? 'dry-run' : 'applied'}
            {applyReport.ok ? ' · ok' : ' · needs attention'}
          </p>
          {applyReport.operations.map((operation, index) => (
            <div
              className="issue-row"
              key={`${operation.kind}-${operation.name ?? operation.targetId}-${index}`}
            >
              <code>{operation.kind}</code>
              <span>{operation.name ?? operation.targetId}</span>
              <span className="path-value">{operation.path}</span>
            </div>
          ))}
          {applyReport.conflicts.map((conflict, index) => (
            <div className="issue-row" key={`conflict-${index}`}>
              <code>conflict</code>
              <span>{conflict.name}</span>
              <span>{conflict.reason}</span>
            </div>
          ))}
        </section>
      ) : null}

      <div className="split">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TARGET</p>
              <h2>Add target</h2>
            </div>
          </div>

          <form className="form-grid" onSubmit={submitTarget}>
            <label className="field field-wide">
              <span>Directory path</span>
              <div className="input-row">
                <input
                  value={targetPath}
                  onChange={(event) => setTargetPath(event.target.value)}
                  placeholder="C:/Projects/ProjectA/skills"
                  required
                />
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void browse()}
                  disabled={busy || !onBrowse}
                >
                  Browse
                </button>
              </div>
            </label>
            <label className="field">
              <span>Target id</span>
              <input
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                placeholder="project-a"
              />
            </label>
            <label className="field">
              <span>Label</span>
              <input
                value={targetLabel}
                onChange={(event) => setTargetLabel(event.target.value)}
                placeholder="Project A"
              />
            </label>
            <label className="field">
              <span>Mode</span>
              <select
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as TargetMode)
                }
              >
                <option value="link">link</option>
                <option value="copy" disabled>
                  copy (coming later)
                </option>
              </select>
            </label>
            <div className="form-actions">
              <button
                className="primary"
                type="submit"
                disabled={busy || !onAddTarget}
              >
                Add target
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ROUTE</p>
              <h2>Assign package</h2>
            </div>
          </div>

          <form className="form-grid" onSubmit={submitRoute}>
            <label className="field">
              <span>Target</span>
              <select
                value={routeTarget}
                onChange={(event) => setRouteTarget(event.target.value)}
              >
                {targets.length === 0 ? (
                  <option value="">No targets</option>
                ) : null}
                {targets.map((target) => (
                  <option value={target.id} key={target.id}>
                    {target.label ?? target.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Package</span>
              <input
                value={routeName}
                onChange={(event) => setRouteName(event.target.value)}
                placeholder="frontend"
                required
              />
            </label>
            <label className="field">
              <span>Version or tag</span>
              <input
                value={routeVersion}
                onChange={(event) => setRouteVersion(event.target.value)}
                placeholder="1.0.0"
                required
              />
            </label>
            <div className="form-actions">
              <button
                className="primary"
                type="submit"
                disabled={busy || !onRouteAdd}
              >
                Assign
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
