import { useState, type FormEvent } from 'react';
import type {
  ApplyReport,
  StatusEntry,
  TargetMode,
  TargetRoute,
  TargetSkillSummary,
  Translator,
} from '@skillink/shared';
import { useConfirm } from './Feedback.js';
import { useI18n } from './i18n.js';
import { Modal } from './Modal.js';
import {
  EMPTY_ASSIGNMENT_DRAFT,
  createRouteAddInput,
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

export type AddTargetSubmit = (
  input: AddTargetFormInput,
) => Promise<boolean> | boolean | void;

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
  onAddTarget?: AddTargetSubmit;
  onRemoveTarget?: (input: TargetRemoveFormInput) => void;
  onTargetEnable?: (input: TargetEnableFormInput) => void;
  onRouteAdd?: (
    input: RouteAddFormInput,
  ) => Promise<boolean> | boolean | void;
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

export interface AddTargetFormProps {
  busy?: boolean;
  onBrowse?: () => Promise<string | null> | string | null;
  onSubmit?: (input: AddTargetFormInput) => void;
  onCancel?: () => void;
}

export function AddTargetForm({
  busy = false,
  onBrowse,
  onSubmit,
  onCancel,
}: AddTargetFormProps) {
  const { t } = useI18n();
  const [targetPath, setTargetPath] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [mode, setMode] = useState<TargetMode>('link');

  async function browse(): Promise<void> {
    const selected = await onBrowse?.();
    if (typeof selected === 'string') {
      setTargetPath(selected);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onSubmit || targetPath.trim() === '') {
      return;
    }

    onSubmit({
      path: targetPath.trim(),
      id: targetId.trim() || undefined,
      label: targetLabel.trim() || undefined,
      mode,
    });
  }

  return (
    <form className="form-grid" onSubmit={submit}>
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
          className="secondary"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          {t('common.cancel')}
        </button>
        <button
          className="primary"
          type="submit"
          disabled={busy || !onSubmit}
        >
          {t('targets.form.addTarget')}
        </button>
      </div>
    </form>
  );
}

export interface AddTargetDialogProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onBrowse?: () => Promise<string | null> | string | null;
  onSubmit?: AddTargetSubmit;
}

export function AddTargetDialog({
  open,
  busy = false,
  onClose,
  onBrowse,
  onSubmit,
}: AddTargetDialogProps) {
  const { t } = useI18n();

  async function submit(input: AddTargetFormInput): Promise<void> {
    const result = await onSubmit?.(input);
    if (result !== false) {
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      title={t('targets.form.addTarget')}
      eyebrow={t('targets.form.targetEyebrow')}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <AddTargetForm
        busy={busy}
        onBrowse={onBrowse}
        onCancel={onClose}
        onSubmit={(input) => void submit(input)}
      />
    </Modal>
  );
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
  const confirm = useConfirm();
  const [addTargetOpen, setAddTargetOpen] = useState(false);
  const [assignment, setAssignment] =
    useState<AssignmentDraft>(EMPTY_ASSIGNMENT_DRAFT);

  function beginAssignment(targetIdValue: string): void {
    setAssignment((current) =>
      toggleAssignmentTarget(current, targetIdValue),
    );
  }

  async function submitRoute(
    event: FormEvent<HTMLFormElement>,
    targetIdValue: string,
  ): Promise<void> {
    event.preventDefault();
    const input = createRouteAddInput(assignment, targetIdValue);
    if (!onRouteAdd || !input) {
      return;
    }

    const result = await onRouteAdd(input);
    if (result !== false) {
      setAssignment(EMPTY_ASSIGNMENT_DRAFT);
    }
  }

  async function toggleTarget(target: TargetRoute): Promise<void> {
    if (target.enabled) {
      const confirmed = await confirm({
        title: t('targets.actions.disableTarget'),
        message: t('targets.confirm.disableTarget', {
          name: target.label ?? target.id,
        }),
        confirmLabel: t('targets.actions.disableTarget'),
        cancelLabel: t('common.cancel'),
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    onTargetEnable?.({
      id: target.id,
      enabled: !target.enabled,
    });
  }

  async function removeTarget(target: TargetRoute): Promise<void> {
    const confirmed = await confirm({
      title: t('targets.actions.removeTarget'),
      message: t('targets.confirm.removeTarget', {
        name: target.label ?? target.id,
      }),
      confirmLabel: t('targets.actions.removeTarget'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemoveTarget?.({ id: target.id });
    }
  }

  async function toggleRoute(
    target: TargetRoute,
    name: string,
    enabled: boolean | undefined,
  ): Promise<void> {
    if (enabled !== false) {
      const confirmed = await confirm({
        title: t('targets.actions.disableRoute'),
        message: t('targets.confirm.disableRoute', {
          name,
          target: target.label ?? target.id,
        }),
        confirmLabel: t('targets.actions.disableRoute'),
        cancelLabel: t('common.cancel'),
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    onRouteEnable?.({
      targetId: target.id,
      name,
      enabled: enabled === false,
    });
  }

  async function removeRoute(
    target: TargetRoute,
    name: string,
  ): Promise<void> {
    const confirmed = await confirm({
      title: t('targets.actions.removeRoute'),
      message: t('targets.confirm.removeRoute', {
        name,
        target: target.label ?? target.id,
      }),
      confirmLabel: t('targets.actions.removeRoute'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemoveRoute?.(createRouteRemoveInput(target.id, name));
    }
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
            <p className="eyebrow">{t('targets.routes.eyebrow')}</p>
            <h2>{t('targets.routes.title')}</h2>
          </div>
          <div className="panel-heading-tools">
            <span className="count">{targets.length}</span>
            <button
              className="secondary"
              type="button"
              onClick={() => setAddTargetOpen(true)}
              disabled={busy || !onAddTarget}
            >
              {t('targets.form.addTarget')}
            </button>
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
                              onClick={() =>
                                void toggleRoute(target, name, lock.enabled)
                              }
                            >
                              {lock.enabled === false
                                ? t('targets.actions.enableRoute')
                                : t('targets.actions.disableRoute')}
                            </button>
                            <button
                              className="danger"
                              type="button"
                              disabled={busy || !onRemoveRoute}
                              onClick={() => void removeRoute(target, name)}
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
                      onSubmit={(event) => void submitRoute(event, target.id)}
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
                      onClick={() => void toggleTarget(target)}
                    >
                      {target.enabled
                        ? t('targets.actions.disableTarget')
                        : t('targets.actions.enableTarget')}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={busy || !onRemoveTarget}
                      onClick={() => void removeTarget(target)}
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
        </section>
      ) : null}

      <AddTargetDialog
        open={addTargetOpen}
        busy={busy}
        onClose={() => setAddTargetOpen(false)}
        onBrowse={onBrowse}
        onSubmit={onAddTarget}
      />
    </main>
  );
}
