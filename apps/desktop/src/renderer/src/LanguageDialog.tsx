import { useEffect, useState, type ReactNode } from 'react';
import { installPickedLanguage, useI18n } from './i18n.js';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

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

  function install(): void {
    void run(async () => {
      await installPickedLanguage({ chooseLanguagePack, installLanguagePack });
    });
  }

  return (
    <div
      className="language-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="language-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-title"
      >
        <header className="language-header">
          <div>
            <p className="eyebrow">{t('language.eyebrow')}</p>
            <h2 id="language-title">{t('language.title')}</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            {t('language.close')}
          </button>
        </header>

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
                      onClick={() => void run(() => useLanguage(pack.locale))}
                    >
                      {t('language.use')}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={busy || pack.builtIn}
                      onClick={() =>
                        void run(() => removeLanguage(pack.locale))
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

        <footer className="language-footer">
          <button
            className="primary"
            type="button"
            onClick={install}
            disabled={busy}
          >
            {t('language.install')}
          </button>
        </footer>
      </div>
    </div>
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
