import { useState } from 'react';
import type {
  GcReport,
  ImportSkillResult,
  SkillFile,
  SkillPackageScanReport,
} from '@skillink/shared';
import { useConfirm } from '../Feedback.js';
import { useI18n } from '../i18n.js';
import { formatBytes } from '../format.js';
import { InstalledSkillCard } from './InstalledSkillCard.js';
import {
  SkillImportDialog,
  type ImportSkillFormInput,
} from './SkillImportDialog.js';
import type { SkillTagFormInput, SkillVersionInput } from './InstalledSkillCard.js';

export type { ImportSkillFormInput } from './SkillImportDialog.js';
export type {
  SkillTagFormInput,
  SkillVersionInput,
} from './InstalledSkillCard.js';

export interface SkillsViewProps {
  skills: SkillFile;
  gcReport?: GcReport | null;
  busy?: boolean;
  onBrowse?: () => Promise<string | null> | string | null;
  onScanSkills?: (sourceDir: string) => Promise<SkillPackageScanReport>;
  onImportSkill?: (input: ImportSkillFormInput) => Promise<ImportSkillResult>;
  onTag?: (input: SkillTagFormInput) => void;
  onRemove?: (input: SkillVersionInput) => void;
  onGc?: (input: { dryRun: boolean }) => void;
  onResolveDroppedPath?: (file: File) => string;
}

export function SkillsView({
  skills,
  gcReport = null,
  busy = false,
  onBrowse,
  onScanSkills,
  onImportSkill,
  onTag,
  onRemove,
  onGc,
  onResolveDroppedPath,
}: SkillsViewProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [importOpen, setImportOpen] = useState(false);
  const entries = Object.entries(skills.skills);

  async function removeSkill(input: SkillVersionInput): Promise<void> {
    const confirmed = await confirm({
      title: t('skills.confirm.removeTitle'),
      message: t('skills.confirm.remove', {
        name: input.name,
        version: input.version,
      }),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (confirmed) {
      onRemove?.(input);
    }
  }

  async function runGc(dryRun: boolean): Promise<void> {
    if (!dryRun) {
      const confirmed = await confirm({
        title: t('skills.confirm.gcTitle'),
        message: t('skills.confirm.gc'),
        confirmLabel: t('skills.storage.apply'),
        cancelLabel: t('common.cancel'),
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    onGc?.({ dryRun });
  }

  return (
    <main className="view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('skills.eyebrow')}</p>
            <h2>{t('skills.heading')}</h2>
          </div>
          <div className="panel-heading-tools">
            <span className="count">{entries.length}</span>
            <button
              className="primary"
              type="button"
              onClick={() => setImportOpen(true)}
              disabled={busy || !onScanSkills}
            >
              {t('skills.actions.import')}
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="empty">{t('skills.empty')}</p>
        ) : (
          <div className="package-grid">
            {entries.map(([skillName, entry]) => (
              <InstalledSkillCard
                key={skillName}
                name={skillName}
                entry={entry}
                busy={busy}
                onTag={onTag}
                onRemove={
                  onRemove
                    ? (input) => void removeSkill(input)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

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
              onClick={() => void runGc(true)}
              disabled={busy || !onGc}
            >
              {t('skills.storage.dryRun')}
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => void runGc(false)}
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

      <SkillImportDialog
        open={importOpen}
        skills={skills}
        busy={busy}
        onClose={() => setImportOpen(false)}
        onBrowse={onBrowse}
        onScanSkills={onScanSkills}
        onImportSkill={onImportSkill}
        onResolveDroppedPath={onResolveDroppedPath}
      />
    </main>
  );
}
