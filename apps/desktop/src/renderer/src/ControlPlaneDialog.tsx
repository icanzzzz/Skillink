import { useEffect, useState, type ReactNode } from 'react';
import type { ControlPlaneState } from '@skillink/shared';
import type { DesktopApi } from '../../shared.js';
import { useToast } from './Feedback.js';
import { useI18n } from './i18n.js';
import { Modal } from './Modal.js';

export interface ControlPlaneDialogProps {
  open: boolean;
  api?: DesktopApi;
  state: ControlPlaneState | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

export function ControlPlaneDialog({
  open,
  api,
  state,
  onClose,
  onChanged,
}: ControlPlaneDialogProps): ReactNode {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const client =
    api ?? (typeof window !== 'undefined' ? window.skillink : undefined);

  const controlPlanes = state?.controlPlanes ?? [];
  const active = state?.active ?? null;
  const envOverride = state?.activeSource === 'env';

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(path: string): Promise<void> {
    if (!client) {
      return;
    }
    await run(async () => {
      await client.useControlPlane(path);
      pushToast({ tone: 'success', message: t('toast.controlPlane.switched') });
      await onChanged();
    });
  }

  async function add(): Promise<void> {
    if (!client) {
      return;
    }
    await run(async () => {
      const folder = await client.chooseFolder();
      if (!folder) {
        return;
      }
      await client.addControlPlane(folder);
      pushToast({ tone: 'success', message: t('toast.controlPlane.added') });
      await onChanged();
    });
  }

  return (
    <Modal
      open={open}
      title={t('controlPlane.title')}
      eyebrow={t('controlPlane.eyebrow')}
      closeLabel={t('common.close')}
      onClose={onClose}
      footer={
        <>
          <button
            className="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.close')}
          </button>
          <button
            className="primary"
            type="button"
            onClick={() => void add()}
            disabled={busy || envOverride}
          >
            {t('controlPlane.add')}
          </button>
        </>
      }
    >
      <p className="hint">{t('controlPlane.hint')}</p>

      {envOverride ? (
        <p className="control-plane-override" role="note">
          {t('controlPlane.envOverride')}
        </p>
      ) : null}

      {controlPlanes.length === 0 ? (
        <p className="empty">{t('controlPlane.empty')}</p>
      ) : (
        <div className="control-plane-list">
          {controlPlanes.map((path) => {
            const isActive = path === active;
            const selectable = !isActive && !envOverride && !busy;
            return (
              <div
                className={
                  isActive ? 'control-plane-row active' : 'control-plane-row'
                }
                key={path}
                role={selectable ? 'button' : undefined}
                tabIndex={selectable ? 0 : -1}
                onClick={selectable ? () => void switchTo(path) : undefined}
                onKeyDown={
                  selectable
                    ? (event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void switchTo(path);
                        }
                      }
                    : undefined
                }
              >
                <div className="control-plane-info">
                  <code>{path}</code>
                </div>
                <div className="control-plane-badges">
                  {isActive ? (
                    <span className="control-plane-badge current">
                      {t('controlPlane.current')}
                    </span>
                  ) : null}
                </div>
                <div className="row-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || isActive || envOverride}
                    onClick={(event) => {
                      event.stopPropagation();
                      void switchTo(path);
                    }}
                  >
                    {t('controlPlane.switch')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="hint">{t('controlPlane.addHint')}</p>

      {error ? (
        <p className="control-plane-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
