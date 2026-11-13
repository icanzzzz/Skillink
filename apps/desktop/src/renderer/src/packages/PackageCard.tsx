import { useState } from 'react';
import type { PackageEntry, PackageFile, SkillFile } from '@skillink/shared';
import { preferredVersion, sortVersionsDesc } from '@skillink/shared';
import { useConfirm } from '../Feedback.js';
import { useI18n } from '../i18n.js';
import { TagEditor } from '../ui/TagEditor.js';
import type {
  PackageTagFormInput,
  PackageVersionInput,
} from './package-draft.js';

export interface PackageCardProps {
  name: string;
  entry: PackageEntry;
  skills: SkillFile;
  packages: PackageFile;
  busy?: boolean;
  onTag?: (input: PackageTagFormInput) => void;
  onCopy: (input: PackageVersionInput) => void;
  onRemove?: (input: PackageVersionInput) => void;
}

/**
 * One package with its version tabs, composition, tag editor and per-version
 * actions. Tabs are local UI state so the card needs no external selection.
 */
export function PackageCard({
  name,
  entry,
  busy = false,
  onTag,
  onCopy,
  onRemove,
}: PackageCardProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const versions = sortVersionsDesc(Object.keys(entry.versions));
  const [shownVersion, setShownVersion] = useState<string | null>(null);
  const activeVersion =
    shownVersion !== null && versions.includes(shownVersion)
      ? shownVersion
      : (preferredVersion(versions) ?? '');
  const composition = entry.versions[activeVersion];
  const skillRows = Object.entries(composition?.skills ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const packageRows = Object.entries(composition?.packages ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  async function removeVersion(version: string): Promise<void> {
    const confirmed = await confirm({
      title: t('packages.confirm.removeTitle'),
      message: t('packages.confirm.remove', { name, version }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemove?.({ name, version });
    }
  }

  return (
    <article className="package-card">
      <div className="package-title">
        <strong>{name}</strong>
        <span>{t('packages.badge')}</span>
      </div>
      {entry.description ? <p>{entry.description}</p> : null}

      <div className="version-tabs" role="tablist">
        {versions.map((version) => (
          <button
            className={`version-tab${version === activeVersion ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={version === activeVersion}
            key={version}
            onClick={() => setShownVersion(version)}
          >
            {version}
          </button>
        ))}
      </div>

      {composition === undefined ? null : (
        <div className="version-detail">
          <div className="version-block">
            <p className="composition-legend">
              <span>{t('packages.composition.skills')}</span>
              <strong>{skillRows.length}</strong>
              {packageRows.length === 0 ? null : (
                <>
                  <span>{t('packages.composition.packages')}</span>
                  <strong>{packageRows.length}</strong>
                </>
              )}
            </p>
            <ul className="composition-list">
              {skillRows.map(([skillName, version]) => (
                <li className="composition-row" key={`skill:${skillName}`}>
                  <span className="composition-name">{skillName}</span>
                  <code className="composition-version">{version}</code>
                </li>
              ))}
              {packageRows.map(([packageName, version]) => (
                <li
                  className="composition-row is-package"
                  key={`package:${packageName}`}
                >
                  <span className="composition-name">{packageName}</span>
                  <span className="composition-badge">
                    {t('packages.badge')}
                  </span>
                  <code className="composition-version">{version}</code>
                </li>
              ))}
            </ul>
            <TagEditor
              label={t('packages.tag.label')}
              tags={entry.tags ?? {}}
              currentVersion={activeVersion}
              busy={busy}
              onApplyTag={(tag) => {
                onTag?.({ name, version: activeVersion, tag });
              }}
            />
            <div className="version-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => onCopy({ name, version: activeVersion })}
              >
                {t('packages.actions.copy')}
              </button>
              <button
                className="mini-button is-danger"
                type="button"
                disabled={busy || !onRemove}
                onClick={() => {
                  void removeVersion(activeVersion);
                }}
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
