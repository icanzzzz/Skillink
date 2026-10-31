import { useI18n } from './i18n.js';

export interface GitUnavailableNoticeProps {
  visible: boolean;
}

export function GitUnavailableNotice({
  visible,
}: GitUnavailableNoticeProps) {
  const { t } = useI18n();

  if (!visible) {
    return null;
  }

  return (
    <p className="sidebar-warning" role="status">
      {t('app.git.missing')}
    </p>
  );
}
