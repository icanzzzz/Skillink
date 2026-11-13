import { useState } from 'react';
import {
  createEmptyPackageFile,
  type ApplyReport,
  type PackageFile,
  type StatusEntry,
  type TargetMode,
  type TargetRoute,
  type TargetSkillSummary,
  type Translator,
} from '@skillink/shared';
import { useConfirm } from '../Feedback.js';
import { useI18n } from '../i18n.js';
import {
  AddTargetDialog,
  type AddTargetFormInput,
  type AddTargetSubmit,
} from './AddTargetDialog.js';
import { AssignPackageDialog } from './AssignPackageDialog.js';
import { TargetCard } from './TargetCard.js';
import type {
  RouteAddFormInput,
  RouteEnableFormInput,
  RouteRemoveFormInput,
  TargetEnableFormInput,
  TargetModeFormInput,
  TargetRemoveFormInput,
} from './route-draft.js';

export type { AddTargetFormInput, AddTargetSubmit };
export type {
  RouteAddFormInput,
  RouteEnableFormInput,
  RouteRemoveFormInput,
  TargetEnableFormInput,
  TargetModeFormInput,
  TargetRemoveFormInput,
} from './route-draft.js';

export interface TargetsViewProps {
  targets: TargetRoute[];
  statusEntries?: StatusEntry[];
  targetSkills?: TargetSkillSummary[];
  applyReport?: ApplyReport | null;
  busy?: boolean;
  packages?: PackageFile;
  onBrowse?: () => Promise<string | null> | string | null;
  onAddTarget?: AddTargetSubmit;
  onRemoveTarget?: (input: TargetRemoveFormInput) => void;
  onTargetEnable?: (input: TargetEnableFormInput) => void;
  onTargetMode?: (input: TargetModeFormInput) => void;
  onRouteAdd?: (
    input: RouteAddFormInput,
  ) => Promise<boolean> | boolean | void;
  onRemoveRoute?: (input: RouteRemoveFormInput) => void;
  onRouteEnable?: (input: RouteEnableFormInput) => void;
  onApply?: () => void;
  onPreview?: () => void;
}

function operationKindLabel(kind: string, t: Translator['t']): string {
  return t(`apply.kind.${kind.replace(/-/g, '_')}`, {}, kind);
}

const EMPTY_PACKAGES = createEmptyPackageFile();

export function invokeTargetsAction(action?: () => void): void {
  action?.();
}

export function TargetsView({
  targets,
  statusEntries = [],
  targetSkills = [],
  applyReport = null,
  busy = false,
  packages = EMPTY_PACKAGES,
  onBrowse,
  onAddTarget,
  onRemoveTarget,
  onTargetEnable,
  onTargetMode,
  onRouteAdd,
  onRemoveRoute,
  onRouteEnable,
  onApply,
  onPreview,
}: TargetsViewProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [addTargetOpen, setAddTargetOpen] = useState(false);
  const [assigningTargetId, setAssigningTargetId] = useState<string | null>(
    null,
  );

  const assigningTarget =
    targets.find((target) => target.id === assigningTargetId) ?? null;

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

  async function switchMode(target: TargetRoute): Promise<void> {
    const nextMode: TargetMode = target.mode === 'link' ? 'copy' : 'link';
    const nextLabel =
      nextMode === 'copy'
        ? t('targets.actions.switchToCopy')
        : t('targets.actions.switchToLink');
    const confirmed = await confirm({
      title: nextLabel,
      message: t('targets.confirm.switchMode', {
        name: target.label ?? target.id,
        mode: t(`targets.mode.${nextMode}`, {}, nextMode),
      }),
      confirmLabel: nextLabel,
      cancelLabel: t('common.cancel'),
    });
    if (confirmed) {
      onTargetMode?.({ id: target.id, mode: nextMode });
    }
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
      onRemoveRoute?.({ targetId: target.id, name });
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
            <span className="toolbar-sep" aria-hidden="true" />
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
            {targets.map((target) => (
              <TargetCard
                key={target.id}
                target={target}
                status={targetStatus(target.id)}
                resolved={skillsByTarget.get(target.id)}
                busy={busy}
                onAssign={
                  onRouteAdd
                    ? () => setAssigningTargetId(target.id)
                    : undefined
                }
                onSwitchMode={
                  onTargetMode ? () => void switchMode(target) : undefined
                }
                onToggleEnabled={
                  onTargetEnable ? () => void toggleTarget(target) : undefined
                }
                onRemoveTarget={
                  onRemoveTarget
                    ? () => void removeTarget(target)
                    : undefined
                }
                onToggleRoute={
                  onRouteEnable
                    ? (name, enabled) =>
                        void toggleRoute(target, name, enabled)
                    : undefined
                }
                onRemoveRoute={
                  onRemoveRoute
                    ? (name) => void removeRoute(target, name)
                    : undefined
                }
              />
            ))}
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
          <p
            className={`apply-summary${applyReport.ok ? ' is-ok' : ' is-warn'}`}
          >
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

      <AssignPackageDialog
        open={assigningTarget !== null}
        busy={busy}
        target={assigningTarget}
        packages={packages}
        onClose={() => setAssigningTargetId(null)}
        onAssign={onRouteAdd}
      />
    </main>
  );
}
