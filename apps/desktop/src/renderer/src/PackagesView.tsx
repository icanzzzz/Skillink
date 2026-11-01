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

function formatDependencies(dependencies: Record<string, string>): string {
  return Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version}`)
    .join('\n');
}

export interface CreatePackageDialogProps {
  open: boolean;
  busy?: boolean;
  skills: SkillFile;
  preset?: CreatePackageFormInput;
  onClose: () => void;
  onCreatePackage?: (
    input: CreatePackageFormInput,
  ) => Promise<boolean> | boolean | void;
}

export function CreatePackageDialog({
  open,
  busy = false,
  skills,
  preset,
  onClose,
  onCreatePackage,
}: CreatePackageDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(preset?.name ?? '');
  const [version, setVersion] = useState(preset?.version ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [skillsText, setSkillsText] = useState(() =>
    formatDependencies(preset?.skills ?? {}),
  );
  const [packagesText, setPackagesText] = useState(() =>
    formatDependencies(preset?.packages ?? {}),
  );
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
      <p className="hint">
        {preset
          ? t('packages.copyHint', {
              name: preset.name,
              version: preset.version,
            })
          : t('packages.hint')}
      </p>
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

export function PackagesView({
  packages,
  skills,
  busy = false,
  onCreatePackage,
  onTag,
  onRemove,
}: PackagesViewProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [createPreset, setCreatePreset] = useState<CreatePackageFormInput>();
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const entries = Object.entries(packages.packages);

  function tagKey(packageName: string, packageVersion: string): string {
    return `${packageName}@${packageVersion}`;
  }

  function openCreate(preset?: CreatePackageFormInput): void {
    setCreatePreset(preset);
    setCreateOpen(true);
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
              className="primary"
              type="button"
              onClick={() => openCreate()}
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
                              disabled={busy || !onCreatePackage}
                              onClick={() =>
                                openCreate({
                                  name: packageName,
                                  version: packageVersion,
                                  description: entry.description,
                                  skills: value.skills,
                                  packages: value.packages,
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
          key={
            createPreset
              ? `${createPreset.name}@${createPreset.version}`
              : 'new'
          }
          open
          busy={busy}
          skills={skills}
          preset={createPreset}
          onClose={() => setCreateOpen(false)}
          onCreatePackage={onCreatePackage}
        />
      ) : null}
    </main>
  );
}
