import { useState, type FormEvent } from 'react';
import type { GcReport } from '@skillink/shared';
import type { SkillFile } from '@skillink/shared';

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
            <p className="eyebrow">SKILLS</p>
            <h2>Installed skills</h2>
          </div>
          <span className="count">{entries.length}</span>
        </div>

        <form className="form-grid import-form" onSubmit={submitImport}>
          <label className="field field-wide">
            <span>Source folder (must contain SKILL.md)</span>
            <div className="input-row">
              <input
                value={sourceDir}
                onChange={(event) => setSourceDir(event.target.value)}
                placeholder="C:/Projects/my-skill"
                required
              />
              <button
                className="secondary"
                type="button"
                onClick={() => void browse()}
                disabled={busy || !onBrowse}
              >
                Browse
              </button>
            </div>
          </label>
          <label className="field">
            <span>Skill name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="folder name"
            />
          </label>
          <label className="field">
            <span>Version</span>
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="0.0.0+hash"
            />
          </label>
          <div className="form-actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !onImportSkill}
            >
              Import skill
            </button>
          </div>
        </form>
      </section>

      {entries.length === 0 ? (
        <section className="panel">
          <p className="empty">
            No skills yet. Import a folder that contains SKILL.md.
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="package-grid">
            {entries.map(([skillName, entry]) => (
              <article className="package-card" key={skillName}>
                <div className="package-title">
                  <strong>{skillName}</strong>
                  <span>skill</span>
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
                            <span>{info.fileCount} files</span>
                            <span>{formatBytes(info.size)}</span>
                          </div>
                          <div className="version-actions">
                            <input
                              aria-label={`Tag ${skillName}@${skillVersion}`}
                              value={tagDrafts[key] ?? ''}
                              onChange={(event) =>
                                setTagDrafts((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              placeholder="tag"
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
                              Tag
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
                              Remove
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
            <p className="eyebrow">STORAGE</p>
            <h2>Garbage collection</h2>
          </div>
          <div className="row-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => onGc?.({ dryRun: true })}
              disabled={busy || !onGc}
            >
              GC dry run
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => onGc?.({ dryRun: false })}
              disabled={busy || !onGc}
            >
              Apply GC
            </button>
          </div>
        </div>

        {gcReport ? (
          <div className="gc-report">
            <p>
              {gcReport.dryRun ? 'Dry run' : 'Applied'} ·{' '}
              {gcReport.candidates.length} candidates ·{' '}
              {formatBytes(gcReport.freedBytes)}{' '}
              {gcReport.dryRun ? 'reclaimable' : 'reclaimed'}
            </p>
            {gcReport.candidates.length === 0 ? (
              <p className="empty">No unreferenced skill versions found.</p>
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
