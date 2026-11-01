import { useState, type ReactNode } from 'react';
import { installPickedLanguage, useI18n } from './i18n.js';
import { useConfirm, useToast } from './Feedback.js';
import { Modal } from './Modal.js';

export interface LanguageDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LanguageDialog({
  open,
  onClose,
}: LanguageDialogProps): ReactNode {
  const {
    t,
    state,
    chooseLanguagePack,
    installLanguagePack,
    useLanguage,
    removeLanguage,
  } = useI18n();
  const confirm = useConfirm();
  const { pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    action: () => Promise<void>,
    successMessage?: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (successMessage) {
        pushToast({ tone: 'success', message: successMessage });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function install(): void {
    void run(async () => {
      const report = await installPickedLanguage({
        chooseLanguagePack,
        installLanguagePack,
      });
      if (report) {
        pushToast({
          tone: 'success',
          message: t('toast.language.installed'),
        });
      }
    });
  }

  async function removePack(locale: string, name: string): Promise<void> {
    const confirmed = await confirm({
      title: t('language.confirm.removeTitle'),
      message: t('language.confirm.remove', { name }),
      confirmLabel: t('language.remove'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      await run(
        () => removeLanguage(locale),
        t('toast.language.removed'),
      );
    }
  }

  return (
    <Modal
      open={open}
      title={t('language.title')}
      eyebrow={t('language.eyebrow')}
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
            {t('language.close')}
          </button>
          <button
            className="primary"
            type="button"
            onClick={install}
            disabled={busy}
          >
            {t('language.install')}
          </button>
        </>
      }
    >
      <p className="hint">{t('language.installHint')}</p>

      <div className="language-list">
        {state.packs.length === 0 ? (
          <p className="empty">{t('language.empty')}</p>
        ) : (
          state.packs.map((pack) => {
            const active =
              pack.locale.toLowerCase() === state.current.toLowerCase();
            return (
              <div
                className={active ? 'language-row active' : 'language-row'}
                key={pack.locale}
              >
                <div className="language-info">
                  <strong>{pack.nativeName}</strong>
                  <span>
                    {pack.name} · <code>{pack.locale}</code> · {pack.version}
                  </span>
                  <span>
                    {t('language.coverage', {
                      percent: Math.round(pack.coverage * 100),
                    })}
                  </span>
                </div>
                <div className="language-badges">
                  {pack.builtIn ? (
                    <span className="language-badge">
                      {t('language.builtIn')}
                    </span>
                  ) : null}
                  {active ? (
                    <span className="language-badge current">
                      {t('language.current')}
                    </span>
                  ) : null}
                </div>
                <div className="row-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || active}
                    onClick={() =>
                      void run(
                        () => useLanguage(pack.locale),
                        t('toast.language.changed'),
                      )
                    }
                  >
                    {t('language.use')}
                  </button>
                  <button
                    className="danger"
                    type="button"
                    disabled={busy || pack.builtIn}
                    onClick={() =>
                      void removePack(pack.locale, pack.nativeName)
                    }
                  >
                    {t('language.remove')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="hint">{t('language.removeActiveHint')}</p>

      {error ? (
        <p className="language-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function LanguageTrigger({
  onClick,
}: {
  onClick: () => void;
}): ReactNode {
  const { t, state } = useI18n();
  const active = state.packs.find(
    (pack) => pack.locale.toLowerCase() === state.current.toLowerCase(),
  );

  return (
    <button
      className="language-trigger"
      type="button"
      onClick={onClick}
      title={t('language.trigger')}
      aria-label={t('language.trigger')}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z" />
      </svg>
      <span className="language-trigger-label">{t('language.trigger')}</span>
      <strong>{active?.nativeName ?? state.current}</strong>
    </button>
  );
}
