import { useState, type FormEvent } from 'react';
import type {
  ApplyReport,
  StatusEntry,
  TargetMode,
  TargetRoute,
  TargetSkillSummary,
  Translator,
} from '@skillink/shared';
import { useI18n } from './i18n.js';
import {
  EMPTY_ASSIGNMENT_DRAFT,
  createRouteAddInput,
  createRouteEnableInput,
  createRouteRemoveInput,
  setAssignmentName,
  setAssignmentVersion,
  toggleAssignmentTarget,
  type AssignmentDraft,
  type RouteAddFormInput,
  type RouteEnableFormInput,
  type RouteRemoveFormInput,
} from './targetAssignment.js';

export type {
  RouteAddFormInput,
  RouteEnableFormInput,
  RouteRemoveFormInput,
} from './targetAssignment.js';

export interface AddTargetFormInput {
  path: string;
  id?: string;
  label?: string;
  mode?: TargetMode;
}

export interface TargetRemoveFormInput {
  id: string;
}

export interface TargetEnableFormInput {
  id: string;
  enabled: boolean;
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
  onApply?: () => void;
  onPreview?: () => void;
}

function statusLabel(state: string, t: Translator['t']): string {
  if (state === '—') {
    return state;
  }
  return t(`status.${state.replace(/-/g, '_')}`, {}, state);
}

function operationKindLabel(kind: string, t: Translator['t']): string {
  return t(`apply.kind.${kind.replace(/-/g, '_')}`, {}, kind);
}

export function invokeTargetsAction(action?: () => void): void {
  action?.();
}

function confirmRemoval(message: string): boolean {
  return typeof window === 'undefined' ? true : window.confirm(message);
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
  const { t } = useI18n();
  const [targetPath, setTargetPath] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [mode, setMode] = useState<TargetMode>('link');
  const [assignment, setAssignment] =
    useState<AssignmentDraft>(EMPTY_ASSIGNMENT_DRAFT);

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

  function beginAssignment(targetIdValue: string): void {
    setAssignment((current) =>
      toggleAssignmentTarget(current, targetIdValue),
    );
  }

  function submitRoute(
    event: FormEvent<HTMLFormElement>,
    targetIdValue: string,
  ): void {
    event.preventDefault();
    const input = createRouteAddInput(assignment, targetIdValue);
    if (!onRouteAdd || !input) {
      return;
    }

    onRouteAdd(input);
    setAssignment(EMPTY_ASSIGNMENT_DRAFT);
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
            <p className="eyebrow">{t('targets.form.targetEyebrow')}</p>
            <h2>{t('targets.form.addTarget')}</h2>
          </div>
        </div>

        <form className="form-grid" onSubmit={submitTarget}>
          <label className="field field-wide">
            <span>{t('targets.form.directoryPath')}</span>
            <div className="input-row">
              <input
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                placeholder={t('targets.form.pathPlaceholder')}
                required
              />
              <button
                className="secondary"
                type="button"
                onClick={() => void browse()}
                disabled={busy || !onBrowse}
              >
                {t('common.browse')}
              </button>
            </div>
          </label>
          <label className="field">
            <span>{t('targets.form.targetId')}</span>
            <input
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder={t('targets.form.targetIdPlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('targets.form.label')}</span>
            <input
              value={targetLabel}
              onChange={(event) => setTargetLabel(event.target.value)}
              placeholder={t('targets.form.labelPlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('targets.form.mode')}</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as TargetMode)}
            >
              <option value="link">{t('targets.mode.link')}</option>
              <option value="copy" disabled>
                {t('targets.mode.copy')}
              </option>
            </select>
          </label>
          <div className="form-actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !onAddTarget}
            >
              {t('targets.form.addTarget')}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('targets.routes.eyebrow')}</p>
            <h2>{t('targets.routes.title')}</h2>
          </div>
          <div className="row-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => invokeTargetsAction(onPreview)}
              disabled={busy || !onPreview}
            >
              {t('targets.previewApply')}
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => invokeTargetsAction(onApply)}
              disabled={busy || !onApply}
            >
              {t('app.actions.applyRoutes')}
            </button>
          </div>
        </div>

        {targets.length === 0 ? (
          <p className="empty">{t('targets.routes.empty')}</p>
        ) : (
          <div className="target-grid">
            {targets.map((target) => {
              const packageEntries = Object.entries(target.packages);
              const count = packageEntries.length;
              const resolved = skillsByTarget.get(target.id);
              const assigning = assignment.targetId === target.id;
              const state = targetStatus(target.id);
              return (
                <article
                  className="target-card"
                  data-target-id={target.id}
                  key={target.id}
                >
                  <div className="target-card-heading">
                    <div className="target-card-title">
                      <strong>{target.label ?? target.id}</strong>
                      <small>{target.id}</small>
                    </div>
                    <span className="target-card-status" data-state={state}>
                      {statusLabel(state, t)}
                    </span>
                  </div>

                  <p className="path-value target-card-path">
                    {target.path}
                  </p>

                  <div className="target-card-meta">
                    <span className="target-chip">
                      {t(`targets.mode.${target.mode}`, {}, target.mode)}
                    </span>
                    <span className="target-chip">
                      {t('targets.counts.packages', { count })}
                    </span>
                    {resolved && !resolved.error ? (
                      <span className="target-chip">
                        {t('targets.counts.skills', {
                          count: resolved.skills.length,
                        })}
                      </span>
                    ) : null}
                    {resolved?.error ? (
                      <span className="target-chip target-chip-warn">
                        {t('status.unresolved')}
                      </span>
                    ) : null}
                  </div>

                  <div className="target-packages">
                    {packageEntries.length === 0 ? (
                      <p className="target-package-empty">
                        {t('targets.packages.empty')}
                      </p>
                    ) : (
                      packageEntries.map(([name, lock]) => (
                        <div className="target-package-row" key={name}>
                          <span className="target-package-name">
                            <code>{name}</code>
                            <small>@{lock.resolved}</small>
                          </span>
                          <span className="target-package-state">
                            {lock.enabled === false
                              ? t('status.disabled')
                              : t('status.enabled')}
                          </span>
                          <span className="target-package-actions row-actions">
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy || !onRouteEnable}
                              onClick={() => {
                                if (
                                  lock.enabled !== false &&
                                  !confirmRemoval(
                                    t('targets.confirm.disableRoute', {
                                      name,
                                      target: target.label ?? target.id,
                                    }),
                                  )
                                ) {
                                  return;
                                }
                                onRouteEnable?.(
                                  createRouteEnableInput(
                                    target.id,
                                    name,
                                    lock,
                                  ),
                                );
                              }}
                            >
                              {lock.enabled === false
                                ? t('targets.actions.enableRoute')
                                : t('targets.actions.disableRoute')}
                            </button>
                            <button
                              className="danger"
                              type="button"
                              disabled={busy || !onRemoveRoute}
                              onClick={() => {
                                if (
                                  confirmRemoval(
                                    t('targets.confirm.removeRoute', {
                                      name,
                                      target: target.label ?? target.id,
                                    }),
                                  )
                                ) {
                                  onRemoveRoute?.(
                                    createRouteRemoveInput(target.id, name),
                                  );
                                }
                              }}
                            >
                              {t('targets.actions.removeRoute')}
                            </button>
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {assigning ? (
                    <form
                      className="target-package-form form-grid"
                      onSubmit={(event) => submitRoute(event, target.id)}
                    >
                      <label className="field">
                        <span>{t('targets.form.package')}</span>
                        <input
                          value={assignment.name}
                          onChange={(event) =>
                            setAssignment((current) =>
                              setAssignmentName(current, event.target.value),
                            )
                          }
                          placeholder={t('targets.form.packagePlaceholder')}
                          required
                          autoFocus
                        />
                      </label>
                      <label className="field">
                        <span>{t('targets.form.versionOrTag')}</span>
                        <input
                          value={assignment.version}
                          onChange={(event) =>
                            setAssignment((current) =>
                              setAssignmentVersion(
                                current,
                                event.target.value,
                              ),
                            )
                          }
                          placeholder={t('targets.form.versionPlaceholder')}
                          required
                        />
                      </label>
                      <div className="form-actions">
                        <button
                          className="primary"
                          type="submit"
                          disabled={busy || !onRouteAdd}
                        >
                          {t('targets.form.assign')}
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setAssignment(EMPTY_ASSIGNMENT_DRAFT)}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div className="target-card-actions row-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || !onRouteAdd}
                      onClick={() => beginAssignment(target.id)}
                    >
                      {t('targets.form.assignPackage')}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || !onTargetEnable}
                      onClick={() => {
                        if (
                          target.enabled &&
                          !confirmRemoval(
                            t('targets.confirm.disableTarget', {
                              name: target.label ?? target.id,
                            }),
                          )
                        ) {
                          return;
                        }
                        onTargetEnable?.({
                          id: target.id,
                          enabled: !target.enabled,
                        });
                      }}
                    >
                      {target.enabled
                        ? t('targets.actions.disableTarget')
                        : t('targets.actions.enableTarget')}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={busy || !onRemoveTarget}
                      onClick={() => {
                        if (
                          confirmRemoval(
                            t('targets.confirm.removeTarget', {
                              name: target.label ?? target.id,
                            }),
                          )
                        ) {
                          onRemoveTarget?.({ id: target.id });
                        }
                      }}
                    >
                      {t('targets.actions.removeTarget')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {applyReport ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t('targets.apply.eyebrow')}</p>
              <h2>
                {applyReport.dryRun
                  ? t('targets.apply.preview')
                  : t('targets.apply.result')}
              </h2>
            </div>
            <span className="count">
              {t('targets.apply.operations', {
                count: applyReport.operations.length,
              })}{' '}
              ·{' '}
              {t('targets.apply.conflicts', {
                count: applyReport.conflicts.length,
              })}
            </span>
          </div>
          <p className="empty">
            {applyReport.dryRun
              ? t('targets.apply.dryRun')
              : t('targets.apply.applied')}
            {applyReport.ok
              ? ` · ${t('targets.apply.ok')}`
              : ` · ${t('targets.apply.needsAttention')}`}
          </p>
          {applyReport.operations.map((operation, index) => (
            <div
              className="issue-row"
              key={`${operation.kind}-${operation.name ?? operation.targetId}-${index}`}
            >
              <code>{operationKindLabel(operation.kind, t)}</code>
              <span>{operation.name ?? operation.targetId}</span>
              <span className="path-value">{operation.path}</span>
            </div>
          ))}
          {applyReport.conflicts.map((conflict, index) => (
            <div className="issue-row" key={`conflict-${index}`}>
              <code>{t('targets.apply.conflict')}</code>
              <span>{conflict.name}</span>
              <span>{conflict.reason}</span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
