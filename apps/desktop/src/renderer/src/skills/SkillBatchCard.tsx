import type { ImportSkillResult } from '@skillink/shared';
import { useI18n } from '../i18n.js';
import {
  resolveSkillBatchName,
  type SkillBatchItem,
} from './skill-batch.js';

export interface SkillBatchCardProps {
  item: SkillBatchItem;
  busy?: boolean;
  alreadyInstalled?: boolean;
  onChange?: (changes: Partial<SkillBatchItem>) => void;
  onConfirm?: () => void;
}

function folderName(sourceDir: string): string {
  return sourceDir.split(/[\\/]+/u).filter(Boolean).at(-1) ?? sourceDir;
}

export function resultLabel(
  result: ImportSkillResult,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return result.created
    ? t('skills.batch.installedResult', {
        name: result.name,
        version: result.version,
      })
    : t('skills.batch.presentResult', {
        name: result.name,
        version: result.version,
      });
}

export function SkillBatchCard({
  item,
  busy = false,
  alreadyInstalled = false,
  onChange,
  onConfirm,
}: SkillBatchCardProps) {
  const { t } = useI18n();
  const name = resolveSkillBatchName(item);
  const blocked = item.status === 'blocked';
  const installed = item.status === 'installed';
  const canConfirm =
    !busy &&
    !blocked &&
    !installed &&
    item.status !== 'installing' &&
    name !== '';

  const buttonLabel =
    item.status === 'installing'
      ? t('skills.batch.installing')
      : installed
        ? t('skills.batch.installed')
        : blocked
          ? t('skills.batch.cancelled')
          : t('skills.batch.confirm');

  return (
    <article className={`package-card install-card install-card-${item.status}`}>
      <div className="package-title">
        <strong>{name || folderName(item.sourceDir)}</strong>
        <span>{t('skills.badge')}</span>
      </div>
      <p className="path-value install-path">{item.sourceDir}</p>
      {item.description ? <p>{item.description}</p> : null}

      <div className="form-grid install-fields">
        <label className="field">
          <span>{t('skills.form.name')}</span>
          <input
            value={item.name}
            readOnly={!onChange}
            onChange={(event) => onChange?.({ name: event.target.value })}
            placeholder={t('common.required')}
            required={name === ''}
          />
        </label>
        <label className="field">
          <span>{t('skills.form.version')}</span>
          <input
            value={item.version}
            readOnly={!onChange}
            onChange={(event) => onChange?.({ version: event.target.value })}
            placeholder={
              item.defaultVersion.trim() ||
              t('skills.form.versionPlaceholder')
            }
          />
        </label>
      </div>

      {alreadyInstalled && !blocked && !installed ? (
        <p className="field-note">{t('skills.batch.alreadyInstalled')}</p>
      ) : null}

      {blocked ? (
        <div className="error-banner install-alert" role="alert">
          <strong>{t('skills.batch.directoryLinkTitle')}</strong>
          <p>{t('skills.batch.directoryLink')}</p>
          <ul className="install-link-list">
            {item.directoryLinks.map((linkPath) => (
              <li key={linkPath}>
                <code className="path-value">{linkPath}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.error && !blocked ? (
        <div className="error-banner install-alert" role="alert">
          {item.error}
        </div>
      ) : null}

      {item.result ? (
        <p className="install-result">{resultLabel(item.result, t)}</p>
      ) : null}

      <div className="form-actions install-actions">
        <button
          className="primary"
          type="button"
          disabled={!canConfirm || !onConfirm}
          onClick={onConfirm}
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
}
