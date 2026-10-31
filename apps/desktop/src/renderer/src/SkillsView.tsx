import { useRef, useState, type FormEvent } from 'react';
import type {
  GcReport,
  ImportSkillResult,
  SkillFile,
  SkillPackageCandidate,
  SkillPackageScanReport,
} from '@skillink/shared';
import { useI18n } from './i18n.js';

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
  name: string;
  version: string;
  description?: string;
  directoryLinks: string[];
  status: SkillBatchStatus;
  error?: string;
  result?: ImportSkillResult;
}

export interface SkillBatchCardProps {
  item: SkillBatchItem;
  busy?: boolean;
  onChange?: (changes: Partial<SkillBatchItem>) => void;
  onConfirm?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function folderName(sourceDir: string): string {
  return sourceDir.split(/[\\/]+/u).filter(Boolean).at(-1) ?? sourceDir;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toBatchItem(candidate: SkillPackageCandidate): SkillBatchItem {
  return {
    sourceDir: candidate.sourceDir,
    name: candidate.name ?? '',
    version: candidate.version ?? '',
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
  const blocked = item.status === 'blocked';
  const installed = item.status === 'installed';
  const canConfirm =
    !busy &&
    !blocked &&
    !installed &&
    item.status !== 'installing' &&
    item.name.trim() !== '';

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
        <strong>{item.name.trim() || folderName(item.sourceDir)}</strong>
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
            placeholder={t('skills.form.namePlaceholder')}
            required
          />
        </label>
        <label className="field">
          <span>{t('skills.form.version')}</span>
          <input
            value={item.version}
            readOnly={!onChange}
            onChange={(event) => onChange?.({ version: event.target.value })}
            placeholder={t('skills.form.versionPlaceholder')}
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
  const [sourceDir, setSourceDir] = useState('');
  const [batch, setBatch] = useState<SkillBatchItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const scanRequest = useRef(0);
  const entries = Object.entries(skills.skills);

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
    if (
      !item ||
      !onImportSkill ||
      item.status === 'installing' ||
      item.status === 'installed' ||
      item.status === 'blocked' ||
      item.name.trim() === ''
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
        name: item.name.trim(),
        version: item.version.trim() || undefined,
      });
      updateItem(itemSourceDir, {
        status: 'installed',
        name: result.name,
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

  function tagKey(skillName: string, skillVersion: string): string {
    return `${skillName}@${skillVersion}`;
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('skills.import.eyebrow')}</p>
            <h2>{t('skills.import.heading')}</h2>
          </div>
          {batch.length > 0 ? (
            <span className="count">{batch.length}</span>
          ) : null}
        </div>

        <p className="hint">{t('skills.batch.hint')}</p>

        <form className="form-grid scan-form" onSubmit={submitScan}>
          <label className="field">
            <span>{t('skills.form.sourceFolder')}</span>
            <div className="input-row">
              <input
                value={sourceDir}
                onChange={(event) => changeSource(event.target.value)}
                placeholder={t('skills.form.sourcePlaceholder')}
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
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('skills.eyebrow')}</p>
            <h2>{t('skills.heading')}</h2>
          </div>
          <span className="count">{entries.length}</span>
        </div>

        {entries.length === 0 ? (
          <p className="empty">{t('skills.empty')}</p>
        ) : (
          <div className="package-grid">
            {entries.map(([skillName, entry]) => (
              <article className="package-card" key={skillName}>
                <div className="package-title">
                  <strong>{skillName}</strong>
                  <span>{t('skills.badge')}</span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}

                <div className="tag-list">
                  {Object.entries(entry.tags ?? {}).map(
                    ([tag, taggedVersion]) => (
                      <span className="tag" key={tag}>
                        <code>{tag}</code>
                        <span>{taggedVersion}</span>
                      </span>
                    ),
                  )}
                </div>

                <div className="version-list">
                  {Object.entries(entry.versions).map(
                    ([skillVersion, info]) => {
                      const key = tagKey(skillName, skillVersion);
                      return (
                        <div className="version-block" key={skillVersion}>
                          <div className="version-row">
                            <code>{skillVersion}</code>
                            <span>
                              {t('skills.files', { count: info.fileCount })}
                            </span>
                            <span>{formatBytes(info.size)}</span>
                          </div>
                          <div className="version-actions">
                            <input
                              aria-label={t('skills.tagAriaLabel', {
                                name: skillName,
                                version: skillVersion,
                              })}
                              value={tagDrafts[key] ?? ''}
                              onChange={(event) =>
                                setTagDrafts((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              placeholder={t('skills.tagPlaceholder')}
                            />
                            <button
                              className="secondary"
                              type="button"
                              disabled={
                                busy ||
                                !onTag ||
                                !(tagDrafts[key] ?? '').trim()
                              }
                              onClick={() =>
                                onTag?.({
                                  name: skillName,
                                  version: skillVersion,
                                  tag: (tagDrafts[key] ?? '').trim(),
                                })
                              }
                            >
                              {t('skills.tag')}
                            </button>
                            <button
                              className="danger"
                              type="button"
                              disabled={busy || !onRemove}
                              onClick={() =>
                                onRemove?.({
                                  name: skillName,
                                  version: skillVersion,
                                })
                              }
                            >
                              {t('common.remove')}
                            </button>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </article>
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
              onClick={() => onGc?.({ dryRun: true })}
              disabled={busy || !onGc}
            >
              {t('skills.storage.dryRun')}
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => onGc?.({ dryRun: false })}
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
    </main>
  );
}
