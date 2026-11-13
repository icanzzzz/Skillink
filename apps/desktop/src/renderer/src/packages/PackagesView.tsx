import { useState } from 'react';
import type { PackageFile, SkillFile } from '@skillink/shared';
import { useI18n } from '../i18n.js';
import { CreatePackageDialog } from './CreatePackageDialog.js';
import { PackageCard } from './PackageCard.js';
import type {
  CreatePackageFormInput,
  PackageTagFormInput,
  PackageVersionInput,
} from './package-draft.js';

export type {
  CreatePackageFormInput,
  PackageTagFormInput,
  PackageVersionInput,
} from './package-draft.js';

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

export function PackagesView({
  packages,
  skills,
  busy = false,
  onCreatePackage,
  onTag,
  onRemove,
}: PackagesViewProps) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [createPreset, setCreatePreset] = useState<PackageVersionInput | null>(
    null,
  );

  const entries = Object.entries(packages.packages).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  function openCreate(): void {
    setCreatePreset(null);
    setCreateOpen(true);
  }

  function copyVersion(input: PackageVersionInput): void {
    setCreatePreset(input);
    setCreateOpen(true);
  }

  function closeCreate(): void {
    setCreateOpen(false);
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
              onClick={openCreate}
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
              <PackageCard
                key={packageName}
                name={packageName}
                entry={entry}
                skills={skills}
                packages={packages}
                busy={busy}
                onTag={onTag}
                onCopy={copyVersion}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
      </section>

      {createOpen ? (
        <CreatePackageDialog
          key={
            createPreset === null
              ? 'create'
              : `${createPreset.name}@${createPreset.version}`
          }
          open
          busy={busy}
          packages={packages}
          skills={skills}
          preset={createPreset}
          onClose={closeCreate}
          {...(onCreatePackage === undefined ? {} : { onCreatePackage })}
        />
      ) : null}
    </main>
  );
}
