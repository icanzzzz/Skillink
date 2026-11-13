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
          {name === target.id ? null : <small>{target.id}</small>}
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
          <ul className="target-package-list">
            {packageEntries.map(([packageName, lock]) => {
              const enabled = lock.enabled !== false;
              return (
                <li className="target-package-row" key={packageName}>
                  <span className="target-package-name">{packageName}</span>
                  <code className="target-package-version">
                    {lock.resolved}
                  </code>
                  <button
                    className="mini-button"
                    type="button"
                    disabled={busy || !onToggleRoute}
                    aria-label={
                      enabled
                        ? t('targets.actions.disableRoute')
                        : t('targets.actions.enableRoute')
                    }
                    title={
                      enabled
                        ? t('targets.actions.disableRoute')
                        : t('targets.actions.enableRoute')
                    }
                    aria-pressed={enabled}
                    onClick={() => onToggleRoute?.(packageName, lock.enabled)}
                  >
                    {enabled
                      ? t('targets.row.disable')
                      : t('targets.row.enable')}
                  </button>
                  <button
                    className="mini-button is-danger"
                    type="button"
                    disabled={busy || !onRemoveRoute}
                    aria-label={t('targets.actions.removeRoute')}
                    title={t('targets.actions.removeRoute')}
                    onClick={() => onRemoveRoute?.(packageName)}
                  >
                    {t('targets.row.remove')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="target-card-actions row-actions">
        <button
          className="primary"
          type="button"
          disabled={busy || !onAssign}
          onClick={onAssign}
        >
          {t('targets.form.assignPackage')}
        </button>
        <button
          className="mini-button"
          type="button"
          disabled={busy || !onSwitchMode}
          onClick={onSwitchMode}
        >
          {target.mode === 'link'
            ? t('targets.actions.switchToCopy')
            : t('targets.actions.switchToLink')}
        </button>
        <button
          className="mini-button"
          type="button"
          disabled={busy || !onToggleEnabled}
          onClick={onToggleEnabled}
        >
          {target.enabled
            ? t('targets.actions.disableTarget')
            : t('targets.actions.enableTarget')}
        </button>
        <button
          className="mini-button is-danger target-card-remove"
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
