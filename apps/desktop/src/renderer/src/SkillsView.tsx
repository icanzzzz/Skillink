import { useRef, useState, type FormEvent } from 'react';
import type {
  GcReport,
  ImportSkillResult,
  SkillEntry,
  SkillFile,
  SkillPackageCandidate,
  SkillPackageScanReport,
} from '@skillink/shared';
import { useConfirm } from './Feedback.js';
import { useI18n } from './i18n.js';
import { errorMessage, formatBytes } from './format.js';
import { Modal } from './Modal.js';

export interface ImportSkillFormInput {
  sourceDir: string;
  name?: string;
  version?: string;
}

export interface SkillTagFormInput {
  name: string;
  version: string;
  tag: string;
}

export interface SkillVersionInput {
  name: string;
  version: string;
}

export interface SkillsViewProps {
  skills: SkillFile;
  gcReport?: GcReport | null;
  busy?: boolean;
  onBrowse?: () => Promise<string | null> | string | null;
  onScanSkills?: (sourceDir: string) => Promise<SkillPackageScanReport>;
  onImportSkill?: (input: ImportSkillFormInput) => Promise<ImportSkillResult>;
  onTag?: (input: SkillTagFormInput) => void;
  onRemove?: (input: SkillVersionInput) => void;
  onGc?: (input: { dryRun: boolean }) => void;
}

export type SkillBatchStatus =
  | 'pending'
  | 'installing'
  | 'installed'
  | 'blocked'
  | 'error';

export interface SkillBatchItem {
  sourceDir: string;
  /** Name entered by the user; empty means use the scanned name. */
  name: string;
  /** Name detected during scanning, shown as the name placeholder. */
  autoName?: string;
  version: string;
  /** Version used when the field is empty, shown without build metadata. */
  defaultVersion?: string;
  description?: string;
  directoryLinks: string[];
  status: SkillBatchStatus;
  error?: string;
  result?: ImportSkillResult;
}

export function resolveSkillBatchName(
  item: Pick<SkillBatchItem, 'name' | 'autoName'>,
): string {
  return item.name.trim() || item.autoName?.trim() || '';
}

export interface SkillBatchCardProps {
  item: SkillBatchItem;
  busy?: boolean;
  onChange?: (changes: Partial<SkillBatchItem>) => void;
  onConfirm?: () => void;
}

function folderName(sourceDir: string): string {
  return sourceDir.split(/[\\/]+/u).filter(Boolean).at(-1) ?? sourceDir;
}

function versionMain(version: string | undefined): string {
  const trimmed = version?.trim() ?? '';
  return trimmed.split('+')[0] ?? trimmed;
}

function toBatchItem(candidate: SkillPackageCandidate): SkillBatchItem {
  return {
    sourceDir: candidate.sourceDir,
    name: '',
    autoName: candidate.name ?? '',
    version: candidate.version ?? '',
    defaultVersion: versionMain(candidate.version),
    ...(candidate.description
      ? { description: candidate.description }
      : {}),
    directoryLinks: candidate.directoryLinks,
    status: 'pending',
  };
}

export function SkillBatchCard({
  item,
  busy = false,
  onChange,
  onConfirm,
}: SkillBatchCardProps) {
  const { t } = useI18n();
  const name = resolveSkillBatchName(item);
  const blocked = item.status === 'blocked';
  const installed = item.status === 'installed';
  const canConfirm =
    !busy &&
    !blocked &&
    !installed &&
    item.status !== 'installing' &&
    name !== '';

  const buttonLabel =
    item.status === 'installing'
      ? t('skills.batch.installing')
      : installed
        ? t('skills.batch.installed')
        : blocked
          ? t('skills.batch.cancelled')
          : t('skills.batch.confirm');

  return (
    <article className={`package-card install-card install-card-${item.status}`}>
      <div className="package-title">
        <strong>{name || folderName(item.sourceDir)}</strong>
        <span>{t('skills.badge')}</span>
      </div>
      <p className="path-value install-path">{item.sourceDir}</p>
      {item.description ? <p>{item.description}</p> : null}

      <div className="form-grid install-fields">
        <label className="field">
          <span>{t('skills.form.name')}</span>
          <input
            value={item.name}
            readOnly={!onChange}
            onChange={(event) => onChange?.({ name: event.target.value })}
            placeholder={item.autoName?.trim() || t('common.required')}
            required={!item.autoName?.trim()}
          />
        </label>
        <label className="field">
          <span>{t('skills.form.version')}</span>
          <input
            value={item.version}
            readOnly={!onChange}
            onChange={(event) => onChange?.({ version: event.target.value })}
            placeholder={
              item.defaultVersion?.trim() || t('skills.form.versionPlaceholder')
            }
          />
        </label>
      </div>

      {blocked ? (
        <div className="error-banner install-alert" role="alert">
          <strong>{t('skills.batch.directoryLinkTitle')}</strong>
          <p>{t('skills.batch.directoryLink')}</p>
          <ul className="install-link-list">
            {item.directoryLinks.map((linkPath) => (
              <li key={linkPath}>
                <code className="path-value">{linkPath}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.error && !blocked ? (
        <div className="error-banner install-alert" role="alert">
          {item.error}
        </div>
      ) : null}

      {item.result ? (
        <p className="install-result">
          {item.result.created
            ? t('skills.batch.installedResult', {
                name: item.result.name,
                version: item.result.version,
              })
            : t('skills.batch.presentResult', {
                name: item.result.name,
                version: item.result.version,
              })}
        </p>
      ) : null}

      <div className="form-actions install-actions">
        <button
          className="primary"
          type="button"
          disabled={!canConfirm || !onConfirm}
          onClick={onConfirm}
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
}

export interface InstalledSkillCardProps {
  name: string;
  entry: SkillEntry;
  busy?: boolean;
  onTag?: (input: SkillTagFormInput) => void;
  onRemove?: (input: SkillVersionInput) => void;
}

export function InstalledSkillCard({
  name,
  entry,
  busy = false,
  onTag,
  onRemove,
}: InstalledSkillCardProps) {
  const { t } = useI18n();
  const versions = Object.keys(entry.versions);
  const [selectedVersion, setSelectedVersion] = useState(versions[0] ?? '');
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const activeVersion = entry.versions[selectedVersion]
    ? selectedVersion
    : versions[0] ?? '';
  const activeInfo = activeVersion ? entry.versions[activeVersion] : undefined;

  if (!activeInfo) {
    return null;
  }

  const tagDraft = tagDrafts[activeVersion] ?? '';
  const tags = Object.entries(entry.tags ?? {});

  function changeTag(value: string): void {
    setTagDrafts((current) => ({ ...current, [activeVersion]: value }));
  }

  function submitTag(): void {
    const tag = tagDraft.trim();
    if (!onTag || tag === '') {
      return;
    }
    onTag({ name, version: activeVersion, tag });
    setTagDrafts((current) => ({ ...current, [activeVersion]: '' }));
  }

  return (
    <article className="package-card skill-card">
      <div className="package-title">
        <strong>{name}</strong>
        <span>{t('skills.badge')}</span>
      </div>
      {entry.description ? <p>{entry.description}</p> : null}

      {tags.length > 0 ? (
        <div className="tag-list">
          {tags.map(([tag, taggedVersion]) => (
            <button
              className={`tag tag-button${
                taggedVersion === activeVersion ? ' is-active' : ''
              }`}
              type="button"
              key={tag}
              onClick={() => {
                if (entry.versions[taggedVersion]) {
                  setSelectedVersion(taggedVersion);
                }
              }}
            >
              <code>{tag}</code>
              <span>{taggedVersion}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="version-tabs"
        role="group"
        aria-label={t('skills.form.version')}
      >
        {versions.map((skillVersion) => (
          <button
            className={`version-tab${
              skillVersion === activeVersion ? ' is-active' : ''
            }`}
            type="button"
            key={skillVersion}
            aria-pressed={skillVersion === activeVersion}
            onClick={() => setSelectedVersion(skillVersion)}
          >
            {skillVersion}
          </button>
        ))}
      </div>

      <div className="version-detail">
        <div className="version-row">
          <span>{t('skills.files', { count: activeInfo.fileCount })}</span>
          <span>{formatBytes(activeInfo.size)}</span>
        </div>
        <div className="version-actions">
          <input
            aria-label={t('skills.tagAriaLabel', {
              name,
              version: activeVersion,
            })}
            value={tagDraft}
            onChange={(event) => changeTag(event.target.value)}
            placeholder={t('common.required')}
          />
          <button
            className="secondary"
            type="button"
            disabled={busy || !onTag || tagDraft.trim() === ''}
            onClick={submitTag}
          >
            {t('skills.tag')}
          </button>
          <button
            className="danger"
            type="button"
            disabled={busy || !onRemove}
            onClick={() => onRemove?.({ name, version: activeVersion })}
          >
            {t('common.remove')}
          </button>
        </div>
      </div>
    </article>
  );
}

export interface SkillImportDialogProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onBrowse?: () => Promise<string | null> | string | null;
  onScanSkills?: (sourceDir: string) => Promise<SkillPackageScanReport>;
  onImportSkill?: (input: ImportSkillFormInput) => Promise<ImportSkillResult>;
}

export function SkillImportDialog({
  open,
  busy = false,
  onClose,
  onBrowse,
  onScanSkills,
  onImportSkill,
}: SkillImportDialogProps) {
  const { t } = useI18n();
  const [sourceDir, setSourceDir] = useState('');
  const [batch, setBatch] = useState<SkillBatchItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
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
      setBatch(report.packages.map(toBatchItem));
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

  function closeDialog(): void {
    scanRequest.current += 1;
    setScanning(false);
    setSourceDir('');
    setBatch([]);
    setScanned(false);
    setScanError(null);
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

  async function confirmItem(itemSourceDir: string): Promise<void> {
    const item = batch.find((entry) => entry.sourceDir === itemSourceDir);
    if (!item || !onImportSkill) {
      return;
    }

    const name = resolveSkillBatchName(item);
    if (
      item.status === 'installing' ||
      item.status === 'installed' ||
      item.status === 'blocked' ||
      name === ''
    ) {
      return;
    }

    if (item.directoryLinks.length > 0) {
      updateItem(itemSourceDir, { status: 'blocked', error: undefined });
      return;
    }

    updateItem(itemSourceDir, {
      status: 'installing',
      error: undefined,
      result: undefined,
    });

    try {
      const result = await onImportSkill({
        sourceDir: item.sourceDir,
        name,
        version: item.version.trim() || undefined,
      });
      updateItem(itemSourceDir, {
        status: 'installed',
        name: item.name.trim() ? result.name : '',
        autoName: result.name,
        version: result.version,
        result,
        error: undefined,
      });
    } catch (cause) {
      updateItem(itemSourceDir, {
        status: 'error',
        error: errorMessage(cause),
      });
    }
  }

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

      <form className="form-grid scan-form" onSubmit={submitScan}>
        <label className="field">
          <span>{t('skills.form.sourceFolder')}</span>
          <div className="input-row">
            <input
              value={sourceDir}
              onChange={(event) => changeSource(event.target.value)}
              placeholder={t('common.required')}
              required
            />
            <button
              className="secondary"
              type="button"
              onClick={() => void browse()}
              disabled={busy || scanning || !onBrowse}
            >
              {t('common.browse')}
            </button>
          </div>
        </label>
        <div className="form-actions">
          <button
            className="primary"
            type="submit"
            disabled={busy || scanning || !onScanSkills}
          >
            {t('skills.form.scan')}
          </button>
        </div>
      </form>

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
          <p className="hint">{t('skills.batch.found', { count: batch.length })}</p>
          <div className="install-list">
            {batch.map((item) => (
              <SkillBatchCard
                key={item.sourceDir}
                item={item}
                busy={busy || scanning}
                onChange={(changes) =>
                  updateItem(item.sourceDir, changes)
                }
                onConfirm={() => void confirmItem(item.sourceDir)}
              />
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

export function SkillsView({
  skills,
  gcReport = null,
  busy = false,
  onBrowse,
  onScanSkills,
  onImportSkill,
  onTag,
  onRemove,
  onGc,
}: SkillsViewProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [importOpen, setImportOpen] = useState(false);
  const entries = Object.entries(skills.skills);

  async function removeSkill(input: SkillVersionInput): Promise<void> {
    const confirmed = await confirm({
      title: t('skills.confirm.removeTitle'),
      message: t('skills.confirm.remove', {
        name: input.name,
        version: input.version,
      }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemove?.(input);
    }
  }

  async function runGc(dryRun: boolean): Promise<void> {
    if (!dryRun) {
      const confirmed = await confirm({
        title: t('skills.confirm.gcTitle'),
        message: t('skills.confirm.gc'),
        confirmLabel: t('skills.storage.apply'),
        cancelLabel: t('common.cancel'),
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    onGc?.({ dryRun });
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('skills.eyebrow')}</p>
            <h2>{t('skills.heading')}</h2>
          </div>
          <div className="panel-heading-tools">
            <span className="count">{entries.length}</span>
            <button
              className="primary"
              type="button"
              onClick={() => setImportOpen(true)}
              disabled={busy || !onScanSkills}
            >
              {t('skills.actions.import')}
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="empty">{t('skills.empty')}</p>
        ) : (
          <div className="package-grid">
            {entries.map(([skillName, entry]) => (
              <InstalledSkillCard
                key={skillName}
                name={skillName}
                entry={entry}
                busy={busy}
                onTag={onTag}
                onRemove={
                  onRemove
                    ? (input) => void removeSkill(input)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('skills.storage.eyebrow')}</p>
            <h2>{t('skills.storage.title')}</h2>
          </div>
          <div className="row-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => void runGc(true)}
              disabled={busy || !onGc}
            >
              {t('skills.storage.dryRun')}
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => void runGc(false)}
              disabled={busy || !onGc}
            >
              {t('skills.storage.apply')}
            </button>
          </div>
        </div>

        {gcReport ? (
          <div className="gc-report">
            <p>
              {gcReport.dryRun
                ? t('skills.gc.dryRun')
                : t('skills.gc.applied')}{' '}
              · {t('skills.gc.candidates', { count: gcReport.candidates.length })}{' '}
              · {formatBytes(gcReport.freedBytes)}{' '}
              {gcReport.dryRun
                ? t('skills.gc.reclaimable')
                : t('skills.gc.reclaimed')}
            </p>
            {gcReport.candidates.length === 0 ? (
              <p className="empty">{t('skills.gc.empty')}</p>
            ) : (
              gcReport.candidates.map((candidate) => (
                <div
                  className="issue-row"
                  key={`${candidate.name}@${candidate.version}`}
                >
                  <code>{`${candidate.name}@${candidate.version}`}</code>
                  <span className="path-value">{candidate.path}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      <SkillImportDialog
        open={importOpen}
        busy={busy}
        onClose={() => setImportOpen(false)}
        onBrowse={onBrowse}
        onScanSkills={onScanSkills}
        onImportSkill={onImportSkill}
      />
    </main>
  );
}
