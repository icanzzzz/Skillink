import { useState, type FormEvent } from 'react';
import {
  parseNameVersionSpec,
  type PackageFile,
  type SkillFile,
} from '@skillink/shared';
import { useConfirm } from './Feedback.js';
import { useI18n } from './i18n.js';
import { compositionText } from './format.js';
import { Modal } from './Modal.js';

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
  onCreatePackage?: (
    input: CreatePackageFormInput,
  ) => Promise<boolean> | boolean | void;
  onCopyPackage?: (
    input: CopyPackageFormInput,
  ) => Promise<boolean> | boolean | void;
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
    const parsed = parseNameVersionSpec(spec);
    if (!parsed) {
      continue;
    }
    result[parsed.name] = parsed.version;
  }

  return result;
}

function parseNames(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export interface CreatePackageDialogProps {
  open: boolean;
  busy?: boolean;
  skills: SkillFile;
  onClose: () => void;
  onCreatePackage?: (
    input: CreatePackageFormInput,
  ) => Promise<boolean> | boolean | void;
}

export function CreatePackageDialog({
  open,
  busy = false,
  skills,
  onClose,
  onCreatePackage,
}: CreatePackageDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [packagesText, setPackagesText] = useState('');
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

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onCreatePackage || !canCreate) {
      return;
    }

    const input: CreatePackageFormInput = {
      name: name.trim(),
      version: version.trim(),
      description: description.trim() || undefined,
      skills: createSkills,
      packages: createPackages,
    };
    void (async () => {
      const result = await onCreatePackage(input);
      if (result !== false) {
        onClose();
      }
    })();
  }

  return (
    <Modal
      open={open}
      title={t('packages.create')}
      eyebrow={t('packages.eyebrow')}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <p className="hint">{t('packages.hint')}</p>
      <form className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>{t('packages.form.name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('packages.form.namePlaceholder')}
            required
            data-autofocus
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
        {skillVersions.length > 0 ? (
          <p className="empty field-wide">
            {t('packages.availableSkills')}{' '}
            <code>{skillVersions.join(', ')}</code>
          </p>
        ) : null}
        <div className="form-actions field-wide">
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
            disabled={busy || !onCreatePackage || !canCreate}
          >
            {t('packages.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export interface CopyPackageDialogProps {
  open: boolean;
  busy?: boolean;
  preset?: {
    sourceName: string;
    sourceVersion: string;
  };
  onClose: () => void;
  onCopyPackage?: (
    input: CopyPackageFormInput,
  ) => Promise<boolean> | boolean | void;
}

export function CopyPackageDialog({
  open,
  busy = false,
  preset,
  onClose,
  onCopyPackage,
}: CopyPackageDialogProps) {
  const { t } = useI18n();
  const [copySource, setCopySource] = useState({
    name: preset?.sourceName ?? '',
    version: preset?.sourceVersion ?? '',
  });
  const [copyTargetName, setCopyTargetName] = useState(
    preset?.sourceName ?? '',
  );
  const [copyTargetVersion, setCopyTargetVersion] = useState('');
  const [copyDescription, setCopyDescription] = useState('');
  const [copySkillsText, setCopySkillsText] = useState('');
  const [copyPackagesText, setCopyPackagesText] = useState('');
  const [dropSkills, setDropSkills] = useState('');
  const [dropPackages, setDropPackages] = useState('');

  const canCopy =
    copySource.name.trim() !== '' &&
    copySource.version.trim() !== '' &&
    copyTargetName.trim() !== '' &&
    copyTargetVersion.trim() !== '';

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onCopyPackage || !canCopy) {
      return;
    }

    const input: CopyPackageFormInput = {
      sourceName: copySource.name.trim(),
      sourceVersion: copySource.version.trim(),
      targetName: copyTargetName.trim(),
      targetVersion: copyTargetVersion.trim(),
      description: copyDescription.trim() || undefined,
      skillOverrides: parseDependencies(copySkillsText),
      packageOverrides: parseDependencies(copyPackagesText),
      dropSkills: parseNames(dropSkills),
      dropPackages: parseNames(dropPackages),
    };
    void (async () => {
      const result = await onCopyPackage(input);
      if (result !== false) {
        onClose();
      }
    })();
  }

  return (
    <Modal
      open={open}
      title={t('packages.copy')}
      eyebrow={t('packages.copy.eyebrow')}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <p className="hint">{t('packages.copyHint')}</p>
      <form className="form-grid" onSubmit={submit}>
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
            data-autofocus
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
        <div className="form-actions field-wide">
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
            disabled={busy || !onCopyPackage || !canCopy}
          >
            {t('packages.copy')}
          </button>
        </div>
      </form>
    </Modal>
  );
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
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [copyPreset, setCopyPreset] = useState<{
    sourceName: string;
    sourceVersion: string;
  } | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const entries = Object.entries(packages.packages);

  function tagKey(packageName: string, packageVersion: string): string {
    return `${packageName}@${packageVersion}`;
  }

  async function removePackage(
    packageName: string,
    packageVersion: string,
  ): Promise<void> {
    const confirmed = await confirm({
      title: t('packages.confirm.removeTitle'),
      message: t('packages.confirm.remove', {
        name: packageName,
        version: packageVersion,
      }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemove?.({ name: packageName, version: packageVersion });
    }
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('packages.eyebrow')}</p>
            <h2>{t('packages.heading')}</h2>
          </div>
          <div className="panel-heading-tools">
            <span className="count">{entries.length}</span>
            <button
              className="secondary"
              type="button"
              onClick={() => setCopyPreset({ sourceName: '', sourceVersion: '' })}
              disabled={busy || !onCopyPackage}
            >
              {t('packages.copy')}
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={busy || !onCreatePackage}
            >
              {t('packages.create')}
            </button>
          </div>
        </div>
        <p className="hint">{t('packages.hint')}</p>

        {entries.length === 0 ? (
          <p className="empty">{t('packages.empty')}</p>
        ) : (
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
                            <span>
                              {compositionText(value, t, {
                                skills: 'packages.composition.skills',
                                packages: 'packages.composition.packages',
                              })}
                            </span>
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
                              onClick={() => {
                                onTag?.({
                                  name: packageName,
                                  version: packageVersion,
                                  tag: (tagDrafts[key] ?? '').trim(),
                                });
                                setTagDrafts((current) => ({
                                  ...current,
                                  [key]: '',
                                }));
                              }}
                            >
                              {t('packages.tag')}
                            </button>
                            <button
                              className="secondary"
                              type="button"
                              disabled={busy || !onCopyPackage}
                              onClick={() =>
                                setCopyPreset({
                                  sourceName: packageName,
                                  sourceVersion: packageVersion,
                                })
                              }
                            >
                              {t('packages.actions.copy')}
                            </button>
                            <button
                              className="danger"
                              type="button"
                              disabled={busy || !onRemove}
                              onClick={() =>
                                void removePackage(
                                  packageName,
                                  packageVersion,
                                )
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

      {createOpen ? (
        <CreatePackageDialog
          open
          busy={busy}
          skills={skills}
          onClose={() => setCreateOpen(false)}
          onCreatePackage={onCreatePackage}
        />
      ) : null}

      {copyPreset ? (
        <CopyPackageDialog
          open
          busy={busy}
          preset={copyPreset}
          onClose={() => setCopyPreset(null)}
          onCopyPackage={onCopyPackage}
        />
      ) : null}
    </main>
  );
}
