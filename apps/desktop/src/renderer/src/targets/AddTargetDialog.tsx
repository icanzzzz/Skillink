import { useId, useState, type FormEvent } from 'react';
import { deriveTargetIdDefault, type TargetMode } from '@skillink/shared';
import { Modal } from '../Modal.js';
import { useI18n } from '../i18n.js';

export interface AddTargetFormInput {
  path: string;
  id?: string;
  label?: string;
  mode?: TargetMode;
}

export type AddTargetSubmit = (
  input: AddTargetFormInput,
) => Promise<boolean> | boolean | void;

export interface AddTargetDialogProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onBrowse?: () => Promise<string | null> | string | null;
  onSubmit?: AddTargetSubmit;
}

function derivedId(path: string, label: string): string {
  if (path.trim() === '' && label.trim() === '') {
    return '';
  }
  return deriveTargetIdDefault({ path, label });
}

/**
 * Adds a target from a folder. The target id is written into the field as a
 * visible default derived from the path (or label) until the user edits it.
 */
export function AddTargetDialog({
  open,
  busy = false,
  onClose,
  onBrowse,
  onSubmit,
}: AddTargetDialogProps) {
  const { t } = useI18n();
  const formId = useId();
  const [targetPath, setTargetPath] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [mode, setMode] = useState<TargetMode>('link');

  function updatePath(value: string): void {
    setTargetPath(value);
    if (!idEdited) {
      setTargetId(derivedId(value, targetLabel));
    }
  }

  function updateLabel(value: string): void {
    setTargetLabel(value);
    if (!idEdited) {
      setTargetId(derivedId(targetPath, value));
    }
  }

  async function browse(): Promise<void> {
    const selected = await onBrowse?.();
    if (typeof selected === 'string') {
      updatePath(selected);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!onSubmit || targetPath.trim() === '') {
      return;
    }

    const result = await onSubmit({
      path: targetPath.trim(),
      id: targetId.trim() || undefined,
      label: targetLabel.trim() || undefined,
      mode,
    });
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
      footer={
        <>
          <button
            className="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            className="primary"
            type="submit"
            form={formId}
            disabled={busy || !onSubmit || targetPath.trim() === ''}
          >
            {t('targets.form.addTarget')}
          </button>
        </>
      }
    >
      <form
        className="form-grid target-form"
        id={formId}
        onSubmit={(event) => void submit(event)}
      >
        <label className="field field-wide">
          <span>{t('targets.form.directoryPath')}</span>
          <div className="input-row">
            <input
              value={targetPath}
              onChange={(event) => updatePath(event.target.value)}
              placeholder={t('common.required')}
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
            onChange={(event) => {
              setIdEdited(true);
              setTargetId(event.target.value);
            }}
            placeholder={t('common.optional')}
          />
        </label>
        <label className="field">
          <span>{t('targets.form.label')}</span>
          <input
            value={targetLabel}
            onChange={(event) => updateLabel(event.target.value)}
            placeholder={t('common.optional')}
          />
        </label>
        <label className="field">
          <span>{t('targets.form.mode')}</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as TargetMode)}
          >
            <option value="link">{t('targets.mode.link')}</option>
            <option value="copy">{t('targets.mode.copy')}</option>
          </select>
        </label>
      </form>
    </Modal>
  );
}
