import { useState, type FormEvent } from 'react';
import type { GcReport } from '@skillink/shared';
import type { SkillFile } from '@skillink/shared';
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
  onImportSkill?: (input: ImportSkillFormInput) => void;
  onTag?: (input: SkillTagFormInput) => void;
  onRemove?: (input: SkillVersionInput) => void;
  onGc?: (input: { dryRun: boolean }) => void;
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

export function SkillsView({
  skills,
  gcReport = null,
  busy = false,
  onBrowse,
  onImportSkill,
  onTag,
  onRemove,
  onGc,
}: SkillsViewProps) {
  const { t } = useI18n();
  const [sourceDir, setSourceDir] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const entries = Object.entries(skills.skills);

  async function browse(): Promise<void> {
    const selected = await onBrowse?.();
    if (typeof selected === 'string') {
      setSourceDir(selected);
    }
  }

  function submitImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onImportSkill || sourceDir.trim() === '') {
      return;
    }

    onImportSkill({
      sourceDir: sourceDir.trim(),
      name: name.trim() || undefined,
      version: version.trim() || undefined,
    });
    setName('');
    setVersion('');
  }

  function tagKey(skillName: string, skillVersion: string): string {
    return `${skillName}@${skillVersion}`;
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('skills.eyebrow')}</p>
            <h2>{t('skills.heading')}</h2>
          </div>
          <span className="count">{entries.length}</span>
        </div>

        <form className="form-grid import-form" onSubmit={submitImport}>
          <label className="field field-wide">
            <span>{t('skills.form.sourceFolder')}</span>
            <div className="input-row">
              <input
                value={sourceDir}
                onChange={(event) => setSourceDir(event.target.value)}
                placeholder={t('skills.form.sourcePlaceholder')}
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
            <span>{t('skills.form.name')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('skills.form.namePlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('skills.form.version')}</span>
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder={t('skills.form.versionPlaceholder')}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !onImportSkill}
            >
              {t('skills.form.import')}
            </button>
          </div>
        </form>
      </section>

      {entries.length === 0 ? (
        <section className="panel">
          <p className="empty">{t('skills.empty')}</p>
        </section>
      ) : (
        <section className="panel">
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
        </section>
      )}

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
