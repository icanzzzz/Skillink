import { useState } from 'react';
import { useI18n } from '../i18n.js';

export interface TagEditorProps {
  label: string;
  tags: Record<string, string>;
  currentVersion: string;
  busy?: boolean;
  onApplyTag: (tag: string) => void;
}

export function TagEditor({
  label,
  tags,
  currentVersion,
  busy = false,
  onApplyTag,
}: TagEditorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const entries = Object.entries(tags);

  function submit(): void {
    const tag = draft.trim();
    if (tag === '') {
      return;
    }
    onApplyTag(tag);
    setOpen(false);
    setDraft('');
  }

  return (
    <div className="tag-editor" role="group" aria-label={label}>
      {entries.map(([tag, taggedVersion]) =>
        taggedVersion === currentVersion ? (
          <span className="tag is-active" key={tag}>
            <code>{tag}</code>
            <span>{taggedVersion}</span>
            <span>{t('packages.tag.current')}</span>
          </span>
        ) : (
          <button
            className="tag tag-button"
            type="button"
            key={tag}
            disabled={busy}
            onClick={() => onApplyTag(tag)}
          >
            <code>{tag}</code>
            <span>{taggedVersion}</span>
          </button>
        ),
      )}
      {open ? (
        <form
          className="tag-add"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            aria-label={t('packages.tag.name')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
          />
          <button
            className="secondary"
            type="submit"
            disabled={busy || draft.trim() === ''}
          >
            {t('common.confirm')}
          </button>
        </form>
      ) : (
        <button
          className="secondary tag-add"
          type="button"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          {t('packages.tag.new')}
        </button>
      )}
    </div>
  );
}
