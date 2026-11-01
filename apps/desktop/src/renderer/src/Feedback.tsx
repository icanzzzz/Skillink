import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from './i18n.js';
import { Modal } from './Modal.js';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  tone: ToastTone;
  message: string;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

export interface ToastApi {
  pushToast(input: ToastInput): void;
  dismissToast(id: number): void;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'default' | 'danger';
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const NOOP_TOAST: ToastApi = {
  pushToast: () => undefined,
  dismissToast: () => undefined,
};

const DEFAULT_CONFIRM: ConfirmFn = async () => false;

const ToastContext = createContext<ToastApi>(NOOP_TOAST);
const ConfirmContext = createContext<ConfirmFn>(DEFAULT_CONFIRM);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

let nextToastId = 1;

export interface UiProviderProps {
  children: ReactNode;
}

/**
 * Provides consistent success/error feedback and styled destructive-action
 * confirmations for the whole renderer.
 */
export function UiProvider({ children }: UiProviderProps) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmOptions, setConfirmOptions] =
    useState<ConfirmOptions | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const pendingConfirm = useRef<((value: boolean) => void) | null>(null);

  const dismissToast = useCallback((id: number): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (input: ToastInput): void => {
      const id = nextToastId++;
      setToasts((current) => [...current.slice(-2), { ...input, id }]);
      const duration =
        input.durationMs ?? (input.tone === 'error' ? 7000 : 3500);
      if (duration <= 0) {
        return;
      }
      const timer = setTimeout(() => dismissToast(id), duration);
      timers.current.set(id, timer);
    },
    [dismissToast],
  );

  const confirm = useCallback<ConfirmFn>((options) => {
    pendingConfirm.current?.(false);
    return new Promise<boolean>((resolve) => {
      pendingConfirm.current = resolve;
      setConfirmOptions(options);
    });
  }, []);

  const settleConfirm = useCallback((value: boolean): void => {
    const resolve = pendingConfirm.current;
    pendingConfirm.current = null;
    setConfirmOptions(null);
    resolve?.(value);
  }, []);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) {
        clearTimeout(timer);
      }
      activeTimers.clear();
    };
  }, []);

  const toastValue = useMemo<ToastApi>(
    () => ({ pushToast, dismissToast }),
    [pushToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={toastValue}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        <div
          className="toast-viewport"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => (
            <div
              className="toast"
              data-tone={toast.tone}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              key={toast.id}
            >
              <span className="toast-indicator" aria-hidden="true" />
              <span className="toast-message">{toast.message}</span>
              <button
                className="toast-dismiss"
                type="button"
                aria-label={t('toast.dismiss')}
                title={t('toast.dismiss')}
                onClick={() => dismissToast(toast.id)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <Modal
          open={confirmOptions !== null}
          title={confirmOptions?.title ?? ''}
          size="sm"
          closeLabel={confirmOptions?.cancelLabel ?? t('common.cancel')}
          onClose={() => settleConfirm(false)}
          footer={
            confirmOptions ? (
              <>
                <button
                  className="secondary"
                  type="button"
                  data-autofocus
                  onClick={() => settleConfirm(false)}
                >
                  {confirmOptions.cancelLabel}
                </button>
                <button
                  className={
                    confirmOptions.tone === 'danger' ? 'danger' : 'primary'
                  }
                  type="button"
                  onClick={() => settleConfirm(true)}
                >
                  {confirmOptions.confirmLabel}
                </button>
              </>
            ) : null
          }
        >
          {confirmOptions ? (
            <p className="confirm-message">{confirmOptions.message}</p>
          ) : null}
        </Modal>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
