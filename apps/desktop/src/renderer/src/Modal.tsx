import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  size?: ModalSize;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Only the topmost dialog may handle Escape or trap Tab. Nested dialogs, such
 * as a confirmation opened from another dialog, must not close their parent.
 */
const modalStack: symbol[] = [];

export function isTopmostModal(id: symbol): boolean {
  return modalStack[modalStack.length - 1] === id;
}

export function pushModal(id: symbol): void {
  modalStack.push(id);
}

export function popModal(id: symbol): void {
  const index = modalStack.lastIndexOf(id);
  if (index !== -1) {
    modalStack.splice(index, 1);
  }
}

/**
 * Accessible modal shell shared by every create, import, copy, confirm, and
 * language dialog. Keeps focus inside the dialog, closes on Escape, and
 * restores focus to the trigger when it closes.
 */
export function Modal({
  open,
  title,
  eyebrow,
  size = 'md',
  closeLabel = 'Close',
  onClose,
  children,
  footer,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const triggerRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef<symbol | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }

    const modalId = Symbol('modal');
    modalIdRef.current = modalId;
    pushModal(modalId);

    triggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent): void {
      if (!isTopmostModal(modalId)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => {
      const initial =
        dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        dialogRef.current;
      initial?.focus();
    }, 0);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
      popModal(modalId);
      modalIdRef.current = null;
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          modalIdRef.current !== null &&
          isTopmostModal(modalIdRef.current)
        ) {
          onClose();
        }
      }}
    >
      <div
        className="modal"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div className="modal-heading">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button modal-close"
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
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
        </header>

        <div className="modal-body">{children}</div>

        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
