import { useEffect, useState, type FormEvent } from 'react';
import type { PackageFile, TargetRoute } from '@skillink/shared';
import {
  packageOptions,
  versionChoices,
  type PackageOption,
} from '../library.js';
import { Modal } from '../Modal.js';
import { useI18n } from '../i18n.js';
import { VersionSelect } from '../ui/VersionSelect.js';
import {
  EMPTY_ROUTE_DRAFT,
  createRouteDraft,
  routeDraftIssue,
  selectRoutePackage,
  setRouteRequested,
  toRouteAddInput,
  type RouteAddFormInput,
  type RouteDraft,
} from './route-draft.js';

export interface AssignPackageDialogProps {
  open: boolean;
  busy?: boolean;
  target: TargetRoute | null;
  packages: PackageFile;
  onClose: () => void;
  onAssign?: (
    input: RouteAddFormInput,
  ) => Promise<boolean | void> | boolean | void;
}

function buildDraft(
  target: TargetRoute | null,
  packages: PackageFile,
): RouteDraft {
  if (!target) {
    return EMPTY_ROUTE_DRAFT;
  }

  return createRouteDraft(
    target.id,
    packageOptions(packages),
    Object.keys(target.packages),
  );
}

function previewCount(
  option: PackageOption | undefined,
  requested: string,
): number | null {
  if (!option) {
    return null;
  }

  const version = option.versions.includes(requested)
    ? requested
    : option.tags[requested];
  if (version === undefined) {
    return null;
  }

  return option.skillCount[version] ?? null;
}

/**
 * Assigns one package version (or tag) to a target. Replaces the former
 * free-text form with two selectors and a direct-skill preview.
 */
export function AssignPackageDialog({
  open,
  busy = false,
  target,
  packages,
  onClose,
  onAssign,
}: AssignPackageDialogProps) {
  const { t } = useI18n();
  const options = packageOptions(packages);
  const targetId = target?.id ?? null;
  const assigned = target ? Object.keys(target.packages) : [];
  const [draft, setDraft] = useState<RouteDraft>(() =>
    buildDraft(target, packages),
  );

  useEffect(() => {
    if (open) {
      setDraft(buildDraft(target, packages));
    }
    // Only a new target or a refreshed package library resets the selection.
  }, [open, targetId, packages]);

  const selected = options.find((option) => option.name === draft.name);
  const choices = selected ? versionChoices(selected, true) : [];
  const issue = routeDraftIssue(draft, assigned);
  const count = previewCount(selected, draft.requested);
  const canAssign = options.length > 0 && issue === null && !busy;

  function choosePackage(name: string): void {
    const option = options.find((candidate) => candidate.name === name);
    if (option) {
      setDraft((current) => selectRoutePackage(current, option));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const input = toRouteAddInput(draft);
    if (!canAssign || !input) {
      return;
    }

    const result = await onAssign?.(input);
    if (result !== false) {
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      title={t('targets.assign.heading')}
      eyebrow={t('targets.assign.eyebrow')}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      {options.length === 0 ? (
        <p className="empty">{t('targets.assign.empty')}</p>
      ) : null}

      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        {options.length > 0 ? (
          <label className="field">
            <span>{t('targets.form.package')}</span>
            <select
              value={draft.name}
              onChange={(event) => choosePackage(event.target.value)}
              disabled={busy}
              data-autofocus
            >
              {options.map((option) => {
                const already = assigned.includes(option.name);
                return (
                  <option
                    value={option.name}
                    key={option.name}
                    disabled={already}
                  >
                    {already
                      ? `${option.name} — ${t('targets.assign.alreadyAssigned')}`
                      : option.name}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}

        {selected ? (
          <VersionSelect
            label={t('targets.form.versionOrTag')}
            name={selected.name}
            options={choices}
            value={draft.requested}
            onChange={(value) =>
              setDraft((current) => setRouteRequested(current, value))
            }
            disabled={busy}
          />
        ) : null}

        {count === null ? null : (
          <p className="assign-preview">
            {t('targets.assign.directSkills', { count })}
          </p>
        )}

        <div className="form-actions">
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
            disabled={!canAssign}
          >
            {t('targets.form.assign')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
