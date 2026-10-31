import { useState, type FormEvent } from 'react';
import type { PackageFile, SkillFile, Translator } from '@skillink/shared';
import { useI18n } from './i18n.js';

export interface CreatePackageFormInput {
  name: string;
  version: string;
  description?: string;
  skills: Record<string, string>;
  packages: Record<string, string>;
}

export interface CopyPackageFormInput {
  sourceName: string;
  sourceVersion: string;
  targetName: string;
  targetVersion: string;
  description?: string;
  skillOverrides?: Record<string, string>;
  packageOverrides?: Record<string, string>;
  dropSkills?: string[];
  dropPackages?: string[];
}

export interface PackageTagFormInput {
  name: string;
  version: string;
  tag: string;
}

export interface PackageVersionInput {
  name: string;
  version: string;
}

export interface PackagesViewProps {
  packages: PackageFile;
  skills: SkillFile;
  busy?: boolean;
  onCreatePackage?: (input: CreatePackageFormInput) => void;
  onCopyPackage?: (input: CopyPackageFormInput) => void;
  onTag?: (input: PackageTagFormInput) => void;
  onRemove?: (input: PackageVersionInput) => void;
}

function parseDependencies(value: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of value.split('\n')) {
    const spec = line.trim();
    if (!spec) {
      continue;
    }
    const separator = spec.lastIndexOf('@');
    if (separator <= 0 || separator === spec.length - 1) {
      continue;
    }
    result[spec.slice(0, separator)] = spec.slice(separator + 1);
  }

  return result;
}

function parseNames(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function compositionText(
  value: {
    skills: Record<string, string>;
    packages: Record<string, string>;
  },
  t: Translator['t'],
): string {
  const parts: string[] = [];
  if (Object.keys(value.skills).length > 0) {
    parts.push(
      `${t('packages.composition.skills')}: ${Object.entries(value.skills)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}`,
    );
  }
  if (Object.keys(value.packages).length > 0) {
    parts.push(
      `${t('packages.composition.packages')}: ${Object.entries(value.packages)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}`,
    );
  }
  return parts.join('; ');
}

export function PackagesView({
  packages,
  skills,
  busy = false,
  onCreatePackage,
  onCopyPackage,
  onTag,
  onRemove,
}: PackagesViewProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [packagesText, setPackagesText] = useState('');
  const [copySource, setCopySource] = useState({ name: '', version: '' });
  const [copyTargetName, setCopyTargetName] = useState('');
  const [copyTargetVersion, setCopyTargetVersion] = useState('');
  const [copyDescription, setCopyDescription] = useState('');
  const [copySkillsText, setCopySkillsText] = useState('');
  const [copyPackagesText, setCopyPackagesText] = useState('');
  const [dropSkills, setDropSkills] = useState('');
  const [dropPackages, setDropPackages] = useState('');
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const entries = Object.entries(packages.packages);
  const skillVersions = Object.entries(skills.skills).flatMap(
    ([skillName, entry]) =>
      Object.keys(entry.versions).map(
        (skillVersion) => `${skillName}@${skillVersion}`,
      ),
  );

  const createSkills = parseDependencies(skillsText);
  const createPackages = parseDependencies(packagesText);
  const canCreate =
    name.trim() !== '' &&
    version.trim() !== '' &&
    Object.keys(createSkills).length + Object.keys(createPackages).length > 0;
  const canCopy =
    copySource.name.trim() !== '' &&
    copySource.version.trim() !== '' &&
    copyTargetName.trim() !== '' &&
    copyTargetVersion.trim() !== '';

  function submitCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onCreatePackage || !canCreate) {
      return;
    }

    onCreatePackage({
      name: name.trim(),
      version: version.trim(),
      description: description.trim() || undefined,
      skills: createSkills,
      packages: createPackages,
    });
    setName('');
    setVersion('');
    setDescription('');
    setSkillsText('');
    setPackagesText('');
  }

  function submitCopy(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onCopyPackage || !canCopy) {
      return;
    }

    onCopyPackage({
      sourceName: copySource.name.trim(),
      sourceVersion: copySource.version.trim(),
      targetName: copyTargetName.trim(),
      targetVersion: copyTargetVersion.trim(),
      description: copyDescription.trim() || undefined,
      skillOverrides: parseDependencies(copySkillsText),
      packageOverrides: parseDependencies(copyPackagesText),
      dropSkills: parseNames(dropSkills),
      dropPackages: parseNames(dropPackages),
    });
    setCopyTargetVersion('');
    setCopyDescription('');
    setCopySkillsText('');
    setCopyPackagesText('');
    setDropSkills('');
    setDropPackages('');
  }

  function tagKey(packageName: string, packageVersion: string): string {
    return `${packageName}@${packageVersion}`;
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('packages.eyebrow')}</p>
            <h2>{t('packages.heading')}</h2>
          </div>
          <span className="count">{entries.length}</span>
        </div>
        <p className="hint">{t('packages.hint')}</p>

        <form className="form-grid" onSubmit={submitCreate}>
          <label className="field">
            <span>{t('packages.form.name')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('packages.form.namePlaceholder')}
              required
            />
          </label>
          <label className="field">
            <span>{t('packages.form.version')}</span>
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder={t('packages.form.versionPlaceholder')}
              required
            />
          </label>
          <label className="field field-wide">
            <span>{t('packages.form.description')}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('packages.form.descriptionPlaceholder')}
            />
          </label>
          <label className="field field-wide">
            <span>{t('packages.form.skills')}</span>
            <textarea
              value={skillsText}
              onChange={(event) => setSkillsText(event.target.value)}
              placeholder={t('packages.form.skillsPlaceholder')}
              rows={3}
            />
          </label>
          <label className="field field-wide">
            <span>{t('packages.form.packages')}</span>
            <textarea
              value={packagesText}
              onChange={(event) => setPackagesText(event.target.value)}
              placeholder={t('packages.form.packagesPlaceholder')}
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !onCreatePackage || !canCreate}
            >
              {t('packages.create')}
            </button>
          </div>
        </form>
        {skillVersions.length > 0 ? (
          <p className="empty">
            {t('packages.availableSkills')}{' '}
            <code>{skillVersions.join(', ')}</code>
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('packages.copy.eyebrow')}</p>
            <h2>{t('packages.copy')}</h2>
          </div>
        </div>
        <p className="hint">{t('packages.copyHint')}</p>

        <form className="form-grid" onSubmit={submitCopy}>
          <label className="field">
            <span>{t('packages.copy.sourceName')}</span>
            <input
              value={copySource.name}
              onChange={(event) =>
                setCopySource((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder={t('packages.form.namePlaceholder')}
              required
            />
          </label>
          <label className="field">
            <span>{t('packages.copy.sourceVersion')}</span>
            <input
              value={copySource.version}
              onChange={(event) =>
                setCopySource((current) => ({
                  ...current,
                  version: event.target.value,
                }))
              }
              placeholder={t('packages.form.versionPlaceholder')}
              required
            />
          </label>
          <label className="field">
            <span>{t('packages.copy.targetName')}</span>
            <input
              value={copyTargetName}
              onChange={(event) => setCopyTargetName(event.target.value)}
              placeholder={t('packages.form.namePlaceholder')}
              required
            />
          </label>
          <label className="field">
            <span>{t('packages.copy.targetVersion')}</span>
            <input
              value={copyTargetVersion}
              onChange={(event) => setCopyTargetVersion(event.target.value)}
              placeholder={t('packages.copy.targetVersionPlaceholder')}
              required
            />
          </label>
          <label className="field field-wide">
            <span>{t('packages.copy.skillOverrides')}</span>
            <textarea
              value={copySkillsText}
              onChange={(event) => setCopySkillsText(event.target.value)}
              placeholder={t('packages.copy.skillOverridesPlaceholder')}
              rows={2}
            />
          </label>
          <label className="field field-wide">
            <span>{t('packages.copy.packageOverrides')}</span>
            <textarea
              value={copyPackagesText}
              onChange={(event) => setCopyPackagesText(event.target.value)}
              placeholder={t('packages.copy.packageOverridesPlaceholder')}
              rows={2}
            />
          </label>
          <label className="field">
            <span>{t('packages.copy.dropSkills')}</span>
            <input
              value={dropSkills}
              onChange={(event) => setDropSkills(event.target.value)}
              placeholder={t('packages.copy.dropSkillsPlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('packages.copy.dropPackages')}</span>
            <input
              value={dropPackages}
              onChange={(event) => setDropPackages(event.target.value)}
              placeholder={t('packages.copy.dropPackagesPlaceholder')}
            />
          </label>
          <label className="field field-wide">
            <span>{t('packages.form.description')}</span>
            <input
              value={copyDescription}
              onChange={(event) => setCopyDescription(event.target.value)}
              placeholder={t('packages.copy.descriptionPlaceholder')}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !onCopyPackage || !canCopy}
            >
              {t('packages.copy')}
            </button>
          </div>
        </form>
      </section>

      {entries.length === 0 ? (
        <section className="panel">
          <p className="empty">{t('packages.empty')}</p>
        </section>
      ) : (
        <section className="panel">
          <div className="package-grid">
            {entries.map(([packageName, entry]) => (
              <article className="package-card" key={packageName}>
                <div className="package-title">
                  <strong>{packageName}</strong>
                  <span>{t('packages.badge')}</span>
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
                    ([packageVersion, value]) => {
                      const key = tagKey(packageName, packageVersion);
                      return (
                        <div className="version-block" key={packageVersion}>
                          <div className="version-row">
                            <code>{packageVersion}</code>
                            <span>{compositionText(value, t)}</span>
                          </div>
                          <div className="version-actions">
                            <input
                              aria-label={t('packages.tagAriaLabel', {
                                name: packageName,
                                version: packageVersion,
                              })}
                              value={tagDrafts[key] ?? ''}
                              onChange={(event) =>
                                setTagDrafts((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              placeholder={t('packages.tagPlaceholder')}
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
                                  name: packageName,
                                  version: packageVersion,
                                  tag: (tagDrafts[key] ?? '').trim(),
                                })
                              }
                            >
                              {t('packages.tag')}
                            </button>
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy || !onCopyPackage}
                              onClick={() => {
                                setCopySource({
                                  name: packageName,
                                  version: packageVersion,
                                });
                                setCopyTargetName(packageName);
                              }}
                            >
                              {t('packages.actions.copy')}
                            </button>
                            <button
                              className="danger"
                              type="button"
                              disabled={busy || !onRemove}
                              onClick={() =>
                                onRemove?.({
                                  name: packageName,
                                  version: packageVersion,
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
    </main>
  );
}
