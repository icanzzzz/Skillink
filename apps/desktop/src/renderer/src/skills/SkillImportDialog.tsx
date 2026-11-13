import {
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import type {
  ImportSkillResult,
  SkillFile,
  SkillPackageScanReport,
} from '@skillink/shared';
import { useI18n } from '../i18n.js';
import { errorMessage } from '../format.js';
import { Modal } from '../Modal.js';
import { SkillBatchCard } from './SkillBatchCard.js';
import {
  isAlreadyInstalled,
  resetBatchName,
  resolveSkillBatchName,
  toSkillBatchItem,
  type SkillBatchItem,
} from './skill-batch.js';

export interface ImportSkillFormInput {
  sourceDir: string;
  name?: string;
  version?: string;
}

export interface SkillImportDialogProps {
  open: boolean;
  skills?: SkillFile;
  busy?: boolean;
  onClose: () => void;
  onBrowse?: () => Promise<string | null> | string | null;
  onScanSkills?: (sourceDir: string) => Promise<SkillPackageScanReport>;
  onImportSkill?: (input: ImportSkillFormInput) => Promise<ImportSkillResult>;
  onResolveDroppedPath?: (file: File) => string;
}

function canInstall(item: SkillBatchItem): boolean {
  return (
    item.status !== 'installing' &&
    item.status !== 'installed' &&
    item.status !== 'blocked' &&
    resolveSkillBatchName(item) !== ''
  );
}

export function SkillImportDialog({
  open,
  skills,
  busy = false,
  onClose,
  onBrowse,
  onScanSkills,
  onImportSkill,
  onResolveDroppedPath,
}: SkillImportDialogProps) {
  const { t } = useI18n();
  const [sourceDir, setSourceDir] = useState('');
  const [batch, setBatch] = useState<SkillBatchItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const scanRequest = useRef(0);

  async function scan(directory: string): Promise<void> {
    const trimmed = directory.trim();
    if (!trimmed || !onScanSkills) {
      return;
    }

    const request = ++scanRequest.current;
    setScanning(true);
    setScanError(null);
    setScanned(false);
    setBatch([]);
    try {
      const report = await onScanSkills(trimmed);
      if (request !== scanRequest.current) {
        return;
      }
      setBatch(report.packages.map(toSkillBatchItem));
      setScanned(true);
    } catch (cause) {
      if (request !== scanRequest.current) {
        return;
      }
      setBatch([]);
      setScanned(true);
      setScanError(errorMessage(cause));
    } finally {
      if (request === scanRequest.current) {
        setScanning(false);
      }
    }
  }

  async function browse(): Promise<void> {
    try {
      const selected = await onBrowse?.();
      if (typeof selected === 'string') {
        setSourceDir(selected);
        await scan(selected);
      }
    } catch (cause) {
      setScanError(errorMessage(cause));
    }
  }

  function changeSource(value: string): void {
    scanRequest.current += 1;
    setScanning(false);
    setSourceDir(value);
    setBatch([]);
    setScanned(false);
    setScanError(null);
  }

  function submitScan(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void scan(sourceDir);
  }

  function resolveDroppedPath(file: File): string {
    try {
      return onResolveDroppedPath?.(file)?.trim() ?? '';
    } catch {
      return '';
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (!busy) {
      setDragOver(true);
    }
  }

  function handleDragLeave(): void {
    setDragOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    if (busy) {
      return;
    }
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    const path = resolveDroppedPath(file);
    if (path === '') {
      return;
    }
    setSourceDir(path);
    void scan(path);
  }

  function closeDialog(): void {
    scanRequest.current += 1;
    setScanning(false);
    setSourceDir('');
    setBatch([]);
    setScanned(false);
    setScanError(null);
    setDragOver(false);
    onClose();
  }

  function updateItem(
    itemSourceDir: string,
    changes: Partial<SkillBatchItem>,
  ): void {
    setBatch((current) =>
      current.map((item) =>
        item.sourceDir === itemSourceDir ? { ...item, ...changes } : item,
      ),
    );
  }

  async function installItem(item: SkillBatchItem): Promise<void> {
    if (!onImportSkill || !canInstall(item)) {
      return;
    }

    if (item.directoryLinks.length > 0) {
      updateItem(item.sourceDir, { status: 'blocked', error: undefined });
      return;
    }

    updateItem(item.sourceDir, {
      status: 'installing',
      error: undefined,
      result: undefined,
    });

    try {
      const result = await onImportSkill({
        sourceDir: item.sourceDir,
        name: resolveSkillBatchName(item),
        version: item.version.trim() || undefined,
      });
      setBatch((current) =>
        current.map((entry) =>
          entry.sourceDir === item.sourceDir
            ? { ...resetBatchName(entry), result, error: undefined }
            : entry,
        ),
      );
    } catch (cause) {
      updateItem(item.sourceDir, {
        status: 'error',
        error: errorMessage(cause),
      });
    }
  }

  async function installAll(): Promise<void> {
    for (const item of batch) {
      if (canInstall(item)) {
        await installItem(item);
      }
    }
  }

  const installable = batch.filter(canInstall).length;

  return (
    <Modal
      open={open}
      title={t('skills.import.heading')}
      eyebrow={t('skills.import.eyebrow')}
      size="lg"
      closeLabel={t('common.close')}
      onClose={closeDialog}
      footer={
        <button className="secondary" type="button" onClick={closeDialog}>
          {t('common.done')}
        </button>
      }
    >
      <p className="hint">{t('skills.batch.hint')}</p>

      <div
        className={`drop-zone${dragOver ? ' is-over' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p>{t(dragOver ? 'skills.import.dropActive' : 'skills.import.dropHint')}</p>
        <button
          className="primary"
          type="button"
          onClick={() => void browse()}
          disabled={busy || scanning || !onBrowse}
        >
          {t('skills.import.chooseFolder')}
        </button>
      </div>

      <details className="manual-path">
        <summary>{t('skills.import.manualPath')}</summary>
        <form className="form-grid scan-form" onSubmit={submitScan}>
          <label className="field">
            <span>{t('skills.form.sourceFolder')}</span>
            <input
              value={sourceDir}
              onChange={(event) => changeSource(event.target.value)}
              placeholder={t('common.required')}
              required
            />
          </label>
          <div className="form-actions">
            <button
              className="secondary"
              type="submit"
              disabled={busy || scanning || !onScanSkills}
            >
              {t('skills.form.scan')}
            </button>
          </div>
        </form>
      </details>

      {scanError ? (
        <div className="error-banner" role="alert">
          {scanError}
        </div>
      ) : null}

      {scanning ? (
        <p className="empty">{t('skills.batch.scanning')}</p>
      ) : null}

      {!scanning && scanned && batch.length === 0 ? (
        <p className="empty">{t('skills.batch.empty')}</p>
      ) : null}

      {batch.length > 0 ? (
        <>
          <div className="install-summary">
            <p className="hint">
              {t('skills.batch.found', { count: installable })}
            </p>
            <button
              className="primary"
              type="button"
              disabled={busy || scanning || installable === 0 || !onImportSkill}
              onClick={() => void installAll()}
            >
              {t('skills.import.installAll')}
            </button>
          </div>
          <div className="install-list">
            {batch.map((item) => (
              <SkillBatchCard
                key={item.sourceDir}
                item={item}
                busy={busy || scanning}
                alreadyInstalled={
                  skills
                    ? isAlreadyInstalled(
                        skills,
                        resolveSkillBatchName(item),
                        item.version.trim(),
                      )
                    : false
                }
                onChange={(changes) =>
                  updateItem(item.sourceDir, changes)
                }
                onConfirm={() => void installItem(item)}
              />
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
