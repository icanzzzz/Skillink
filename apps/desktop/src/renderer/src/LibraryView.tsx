import { useState, type FormEvent } from 'react';
import type { GcReport } from '@skillink/core';
import type { SkillsFile } from '@skillink/shared';

export interface ImportFolderFormInput {
  sourceDir: string;
  name?: string;
  version?: string;
}

export interface LibraryTagFormInput {
  name: string;
  version: string;
  tag: string;
}

export interface LibraryVersionInput {
  name: string;
  version: string;
}

export interface LibraryViewProps {
  library: SkillsFile;
  gcReport?: GcReport | null;
  busy?: boolean;
  onBrowse?: () => Promise<string | null> | string | null;
  onImport?: (input: ImportFolderFormInput) => void;
  onTag?: (input: LibraryTagFormInput) => void;
  onRemove?: (input: LibraryVersionInput) => void;
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

export function LibraryView({
  library,
  gcReport = null,
  busy = false,
  onBrowse,
  onImport,
  onTag,
  onRemove,
  onGc,
}: LibraryViewProps) {
  const [sourceDir, setSourceDir] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const packages = Object.entries(library.packages);

  async function browse(): Promise<void> {
    const selected = await onBrowse?.();
    if (typeof selected === 'string') {
      setSourceDir(selected);
    }
  }

  function submitImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onImport || sourceDir.trim() === '') {
      return;
    }

    onImport({
      sourceDir: sourceDir.trim(),
      name: name.trim() || undefined,
      version: version.trim() || undefined,
    });
    setName('');
    setVersion('');
  }

  function tagKey(packageName: string, packageVersion: string): string {
    return `${packageName}@${packageVersion}`;
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PUBLIC LIBRARY</p>
            <h2>Packages</h2>
          </div>
          <span className="count">{packages.length}</span>
        </div>

        <form className="form-grid import-form" onSubmit={submitImport}>
          <label className="field field-wide">
            <span>Source folder</span>
            <div className="input-row">
              <input
                value={sourceDir}
                onChange={(event) => setSourceDir(event.target.value)}
                placeholder="C:/Projects/my-folder"
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
            <span>Package name</span>
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
            <button className="primary" type="submit" disabled={busy || !onImport}>
              Import folder
            </button>
          </div>
        </form>
      </section>

      {packages.length === 0 ? (
        <section className="panel">
          <p className="empty">
            No packages yet. Import any folder to create the first version.
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="package-grid">
            {packages.map(([packageName, entry]) => (
              <article className="package-card" key={packageName}>
                <div className="package-title">
                  <strong>{packageName}</strong>
                  <span>{entry.kind ?? 'unknown'}</span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}

                <div className="tag-list">
                  {Object.entries(entry.tags ?? {}).map(([tag, taggedVersion]) => (
                    <span className="tag" key={tag}>
                      <code>{tag}</code>
                      <span>{taggedVersion}</span>
                    </span>
                  ))}
                </div>

                <div className="version-list">
                  {Object.entries(entry.versions).map(([packageVersion, info]) => {
                    const key = tagKey(packageName, packageVersion);
                    return (
                      <div className="version-block" key={packageVersion}>
                        <div className="version-row">
                          <code>{packageVersion}</code>
                          <span>{info.fileCount} files</span>
                          <span>{formatBytes(info.size)}</span>
                        </div>
                        <div className="version-actions">
                          <input
                            aria-label={`Tag ${packageName}@${packageVersion}`}
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
                            disabled={busy || !onTag || !(tagDrafts[key] ?? '').trim()}
                            onClick={() =>
                              onTag?.({
                                name: packageName,
                                version: packageVersion,
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
                              onRemove?.({ name: packageName, version: packageVersion })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
              {gcReport.dryRun ? 'Dry run' : 'Applied'} · {gcReport.candidates.length}{' '}
              candidates · {formatBytes(gcReport.freedBytes)}{' '}
              {gcReport.dryRun ? 'reclaimable' : 'reclaimed'}
            </p>
            {gcReport.candidates.length === 0 ? (
              <p className="empty">No unreferenced versions found.</p>
            ) : (
              gcReport.candidates.map((candidate) => (
                <div className="issue-row" key={`${candidate.name}@${candidate.version}`}>
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
