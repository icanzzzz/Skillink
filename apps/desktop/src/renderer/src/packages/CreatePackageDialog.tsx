import { useId, useState, type FormEvent } from 'react';
import type { PackageFile, SkillFile } from '@skillink/shared';
import {
  packageOptions,
  skillOptions,
  versionChoices,
} from '../library.js';
import { Modal } from '../Modal.js';
import { useI18n } from '../i18n.js';
import { useToast } from '../Feedback.js';
import { errorMessage } from '../format.js';
import { ChoiceList, type ChoiceItem } from '../ui/ChoiceList.js';
import { VersionSelect } from '../ui/VersionSelect.js';
import {
  copyPackageDraft,
  createPackageDraft,
  packageDraftIssues,
  setDraftDescription,
  setDraftName,
  setDraftNameMode,
  setDraftPackageVersion,
  setDraftSkillVersion,
  setDraftVersion,
  toCreatePackageInput,
  toggleDraftPackage,
  toggleDraftSkill,
  type CreatePackageFormInput,
  type PackageDraft,
  type PackageNameMode,
} from './package-draft.js';

export interface CreatePackageDialogProps {
  open: boolean;
  busy?: boolean;
  packages: PackageFile;
  skills: SkillFile;
  preset?: { name: string; version: string } | null;
  onClose: () => void;
  onCreatePackage?: (
    input: CreatePackageFormInput,
  ) => Promise<boolean | void> | boolean | void;
}

export function CreatePackageDialog({
  open,
  busy = false,
  packages,
  skills,
  preset = null,
  onClose,
  onCreatePackage,
}: CreatePackageDialogProps) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const formId = useId();
  const [draft, setDraft] = useState<PackageDraft>(() =>
    preset
      ? copyPackageDraft(packages, preset.name, preset.version)
      : createPackageDraft(packages),
  );

  const packageChoices = packageOptions(packages);
  const skillChoices = skillOptions(skills);
  const issues = packageDraftIssues(draft, packages);
  const versionTaken = issues.some((issue) => issue.code === 'version-taken');
  const currentEntry = packages.packages[draft.name.trim()];
  const existingVersions =
    currentEntry === undefined ? [] : Object.keys(currentEntry.versions);
  const skillCount = Object.keys(draft.skills).length;
  const packageCount = Object.keys(draft.packages).length;
  const canSubmit = onCreatePackage !== undefined && issues.length === 0;

  const skillItems: ChoiceItem[] = skillChoices.map((option) => ({
    value: option.name,
    label: option.name,
    ...(option.description === undefined
      ? {}
      : { description: option.description }),
    meta: t('overview.library.versions', { count: option.versions.length }),
  }));

  const nestedItems: ChoiceItem[] = packageChoices.map((option) => {
    const selfReference = option.name === draft.name.trim();
    return {
      value: option.name,
      label: option.name,
      ...(option.description === undefined
        ? {}
        : { description: option.description }),
      meta: t('overview.library.versions', { count: option.versions.length }),
      disabled: selfReference,
      ...(selfReference
        ? { disabledReason: t('packages.form.selfReference') }
        : {}),
    };
  });

  function chooseMode(mode: PackageNameMode): void {
    // Switching modes keeps the picked dependencies; only an explicit pick in
    // the package <select> replaces them with that package's composition.
    setDraft((current) => {
      const next = setDraftNameMode(current, mode);
      if (mode !== 'existing' || current.name.trim() !== '') {
        return next;
      }
      const first = packageChoices[0];
      return first === undefined ? next : setDraftName(next, first.name);
    });
  }

  function selectExisting(name: string): void {
    const option = packageChoices.find((entry) => entry.name === name);
    const source = option?.latestVersion;
    if (source === undefined || source === null) {
      setDraft((current) =>
        setDraftName(setDraftNameMode(current, 'existing'), name),
      );
      return;
    }
    setDraft(copyPackageDraft(packages, name, source));
  }

  function toggleSkill(name: string): void {
    const option = skillChoices.find((entry) => entry.name === name);
    if (option === undefined) {
      return;
    }
    setDraft((current) => toggleDraftSkill(current, option));
  }

  function toggleNested(name: string): void {
    if (name === draft.name.trim()) {
      return;
    }
    const option = packageChoices.find((entry) => entry.name === name);
    if (option === undefined) {
      return;
    }
    setDraft((current) => toggleDraftPackage(current, option));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input = toCreatePackageInput(draft, packages);
    if (input === null || onCreatePackage === undefined) {
      return;
    }
    void (async () => {
      try {
        const result = await onCreatePackage(input);
        if (result !== false) {
          onClose();
        }
      } catch (error) {
        pushToast({ tone: 'error', message: errorMessage(error) });
      }
    })();
  }

  return (
    <Modal
      open={open}
      title={t('packages.create')}
      eyebrow={t('packages.eyebrow')}
      size="lg"
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
            disabled={busy || !canSubmit}
          >
            {t('packages.create')}
          </button>
        </>
      }
    >
      {preset === null ? null : (
        <p className="hint">
          {t('packages.form.copyNotice', {
            spec: `${preset.name}@${preset.version}`,
          })}
        </p>
      )}

      <form className="form-grid" id={formId} onSubmit={submit}>
        <section className="form-section field-wide">
          <div
            className="segmented"
            role="group"
            aria-label={t('packages.form.nameSelect')}
          >
            <button
              type="button"
              className={
                draft.nameMode === 'existing' ? 'is-active' : undefined
              }
              aria-pressed={draft.nameMode === 'existing'}
              onClick={() => chooseMode('existing')}
            >
              {t('packages.form.modeExisting')}
            </button>
            <button
              type="button"
              className={draft.nameMode === 'new' ? 'is-active' : undefined}
              aria-pressed={draft.nameMode === 'new'}
              onClick={() => chooseMode('new')}
            >
              {t('packages.form.modeNew')}
            </button>
          </div>

          {draft.nameMode === 'existing' ? (
            packageChoices.length === 0 ? (
              <p className="empty">{t('packages.form.noExistingPackages')}</p>
            ) : (
              <label className="field">
                <span>{t('packages.form.nameSelect')}</span>
                <select
                  value={draft.name}
                  onChange={(event) => selectExisting(event.target.value)}
                >
                  {packageChoices.map((option) => (
                    <option value={option.name} key={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : (
            <label className="field">
              <span>{t('packages.form.name')}</span>
              <input
                value={draft.name}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((current) => setDraftName(current, value));
                }}
                placeholder={t('common.required')}
                data-autofocus
              />
            </label>
          )}

          <div className="field">
            <span>{t('packages.form.version')}</span>
            <input
              value={draft.version}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => setDraftVersion(current, value));
              }}
              placeholder={t('common.required')}
            />
            {existingVersions.length === 0 ? null : (
              <p className="field-note">
                {t('packages.form.existingVersions', {
                  versions: existingVersions.join(', '),
                })}
              </p>
            )}
            {versionTaken ? (
              <p className="field-error">
                {t('packages.form.versionTaken', { version: draft.version })}
              </p>
            ) : null}
          </div>

          <label className="field field-wide">
            <span>{t('packages.form.description')}</span>
            <input
              value={draft.description}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => setDraftDescription(current, value));
              }}
              placeholder={t('common.optional')}
            />
          </label>
        </section>

        <section className="form-section field-wide">
          <ChoiceList
            legend={t('packages.form.pickSkills')}
            items={skillItems}
            selected={Object.keys(draft.skills)}
            onToggle={toggleSkill}
            searchPlaceholder={t('packages.form.searchSkills')}
            emptyMessage={t('packages.form.noSkills')}
            searchable={skillItems.length > 6}
          />
          {skillCount === 0 ? null : (
            <div className="selected-versions">
              {Object.keys(draft.skills).map((name) => {
                const option = skillChoices.find(
                  (entry) => entry.name === name,
                );
                if (option === undefined) {
                  return null;
                }
                return (
                  <VersionSelect
                    key={name}
                    label={t('packages.form.version')}
                    name={name}
                    options={versionChoices(option, false)}
                    value={draft.skills[name] ?? ''}
                    onChange={(value) => {
                      setDraft((current) =>
                        setDraftSkillVersion(current, name, value),
                      );
                    }}
                    disabled={busy}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="form-section field-wide">
          <ChoiceList
            legend={t('packages.form.pickPackages')}
            items={nestedItems}
            selected={Object.keys(draft.packages)}
            onToggle={toggleNested}
            searchPlaceholder={t('packages.form.searchPackages')}
            emptyMessage={t('packages.form.noNestedPackages')}
            searchable={nestedItems.length > 6}
          />
          {packageCount === 0 ? null : (
            <div className="selected-versions">
              {Object.keys(draft.packages).map((name) => {
                const option = packageChoices.find(
                  (entry) => entry.name === name,
                );
                if (option === undefined) {
                  return null;
                }
                return (
                  <VersionSelect
                    key={name}
                    label={t('packages.form.version')}
                    name={name}
                    options={versionChoices(option, false)}
                    value={draft.packages[name] ?? ''}
                    onChange={(value) => {
                      setDraft((current) =>
                        setDraftPackageVersion(current, name, value),
                      );
                    }}
                    disabled={busy}
                  />
                );
              })}
            </div>
          )}
        </section>

        <p className="selection-summary field-wide">
          {t('packages.form.selectedCount', {
            count: skillCount + packageCount,
          })}{' '}
          ·{' '}
          {t('packages.form.summaryCounts', {
            skills: skillCount,
            packages: packageCount,
          })}
        </p>
      </form>
    </Modal>
  );
}

