import type { TargetRoute, TargetSkillSummary, Translator } from '@skillink/shared';
import { useI18n } from '../i18n.js';

export interface TargetCardProps {
  target: TargetRoute;
  status: string;
  resolved?: TargetSkillSummary;
  busy?: boolean;
  onAssign?: () => void;
  onSwitchMode?: () => void;
  onToggleEnabled?: () => void;
  onRemoveTarget?: () => void;
  onToggleRoute?: (name: string, enabled: boolean | undefined) => void;
  onRemoveRoute?: (name: string) => void;
}

function statusLabel(state: string, t: Translator['t']): string {
  if (state === '—') {
    return state;
  }
  return t(`status.${state.replace(/-/g, '_')}`, {}, state);
}

/**
 * One target directory: assigned packages, permissions and lifecycle actions.
 * Adding a package opens the assignment dialog from the view.
 */
export function TargetCard({
  target,
  status,
  resolved,
  busy = false,
  onAssign,
  onSwitchMode,
  onToggleEnabled,
  onRemoveTarget,
  onToggleRoute,
  onRemoveRoute,
}: TargetCardProps) {
  const { t } = useI18n();
  const packageEntries = Object.entries(target.packages);
  const count = packageEntries.length;
  const name = target.label ?? target.id;

  return (
    <article className="target-card" data-target-id={target.id}>
      <div className="target-card-heading">
        <div className="target-card-title">
          <strong>{name}</strong>
          <small>{target.id}</small>
        </div>
        <span className="target-card-status" data-state={status}>
          {statusLabel(status, t)}
        </span>
      </div>

      <p className="path-value target-card-path">{target.path}</p>

      <div className="target-card-meta">
        <span className="target-chip">
          {t(`targets.mode.${target.mode}`, {}, target.mode)}
        </span>
        <span className="target-chip">
          {t('targets.counts.packages', { count })}
        </span>
        {resolved && !resolved.error ? (
          <span className="target-chip">
            {t('targets.counts.skills', { count: resolved.skills.length })}
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
          packageEntries.map(([packageName, lock]) => (
            <div className="target-package-row" key={packageName}>
              <span className="target-package-name">
                <code>{packageName}</code>
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
                  disabled={busy || !onToggleRoute}
                  onClick={() =>
                    onToggleRoute?.(packageName, lock.enabled)
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
                  onClick={() => onRemoveRoute?.(packageName)}
                >
                  {t('targets.actions.removeRoute')}
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="target-card-actions row-actions">
        <button
          className="secondary"
          type="button"
          disabled={busy || !onAssign}
          onClick={onAssign}
        >
          {t('targets.form.assignPackage')}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy || !onSwitchMode}
          onClick={onSwitchMode}
        >
          {target.mode === 'link'
            ? t('targets.actions.switchToCopy')
            : t('targets.actions.switchToLink')}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy || !onToggleEnabled}
          onClick={onToggleEnabled}
        >
          {target.enabled
            ? t('targets.actions.disableTarget')
            : t('targets.actions.enableTarget')}
        </button>
        <button
          className="danger"
          type="button"
          disabled={busy || !onRemoveTarget}
          onClick={onRemoveTarget}
        >
          {t('targets.actions.removeTarget')}
        </button>
      </div>
    </article>
  );
}
