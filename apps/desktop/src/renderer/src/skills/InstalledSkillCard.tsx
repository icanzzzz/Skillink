import { useState } from 'react';
import {
  preferredVersion,
  sortVersionsDesc,
  type SkillEntry,
} from '@skillink/shared';
import { useConfirm } from '../Feedback.js';
import { useI18n } from '../i18n.js';
import { formatBytes } from '../format.js';
import { TagEditor } from '../ui/TagEditor.js';

export interface SkillTagFormInput {
  name: string;
  version: string;
  tag: string;
}

export interface SkillVersionInput {
  name: string;
  version: string;
}

export interface InstalledSkillCardProps {
  name: string;
  entry: SkillEntry;
  busy?: boolean;
  onTag?: (input: SkillTagFormInput) => void;
  onRemove?: (input: SkillVersionInput) => void;
}

export function InstalledSkillCard({
  name,
  entry,
  busy = false,
  onTag,
  onRemove,
}: InstalledSkillCardProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const versions = sortVersionsDesc(Object.keys(entry.versions));
  const fallbackVersion = preferredVersion(versions) ?? '';
  const [selectedVersion, setSelectedVersion] = useState(fallbackVersion);
  const activeVersion = entry.versions[selectedVersion]
    ? selectedVersion
    : fallbackVersion;
  const activeInfo = activeVersion ? entry.versions[activeVersion] : undefined;

  if (!activeInfo) {
    return null;
  }

  async function removeVersion(): Promise<void> {
    const confirmed = await confirm({
      title: t('skills.confirm.removeTitle'),
      message: t('skills.confirm.remove', { name, version: activeVersion }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemove?.({ name, version: activeVersion });
    }
  }

  return (
    <article className="package-card skill-card">
      <div className="package-title">
        <strong>{name}</strong>
        <span>{t('skills.badge')}</span>
      </div>
      {entry.description ? <p>{entry.description}</p> : null}

      <div
        className="version-tabs"
        role="group"
        aria-label={t('skills.form.version')}
      >
        {versions.map((skillVersion) => (
          <button
            className={`version-tab${
              skillVersion === activeVersion ? ' is-active' : ''
            }`}
            type="button"
            key={skillVersion}
            aria-pressed={skillVersion === activeVersion}
            onClick={() => setSelectedVersion(skillVersion)}
          >
            {skillVersion}
          </button>
        ))}
      </div>

      <div className="version-detail">
        <div className="version-row">
          <span>{t('skills.files', { count: activeInfo.fileCount })}</span>
          <span>{formatBytes(activeInfo.size)}</span>
        </div>
        <TagEditor
          label={t('skills.tagAriaLabel', {
            name,
            version: activeVersion,
          })}
          tags={entry.tags ?? {}}
          currentVersion={activeVersion}
          busy={busy || !onTag}
          onApplyTag={(tag) => onTag?.({ name, version: activeVersion, tag })}
        />
        <div className="version-actions">
          <button
            className="link-button is-danger"
            type="button"
            disabled={busy || !onRemove}
            onClick={() => {
              void removeVersion();
            }}
          >
            {t('common.remove')}
          </button>
        </div>
      </div>
    </article>
  );
}
