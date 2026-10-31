import { useEffect, useState } from 'react';
import type {
  ApplyReport,
  GcReport,
  ImportSkillResult,
  MessageKey,
  SkillPackageScanReport,
} from '@skillink/shared';
import type {
  AddTargetRequest,
  CopyPackageRequest,
  CreatePackageRequest,
  ImportSkillRequest,
  PackageRemoveRequest,
  PackageTagRequest,
  RouteAddRequest,
  RouteEnableRequest,
  RouteRemoveRequest,
  SkillRemoveRequest,
  SkillTagRequest,
  TargetEnableRequest,
  TargetRemoveRequest,
} from '../../ipc-schemas.js';
import type { DesktopApi, DesktopSnapshot } from '../../shared.js';
import { DoctorView } from './DoctorView.js';
import { useI18n } from './i18n.js';
import { LanguageDialog, LanguageTrigger } from './LanguageDialog.js';
import { GitUnavailableNotice } from './GitUnavailableNotice.js';
import { PackagesView } from './PackagesView.js';
import { SkillsView } from './SkillsView.js';
import { SnapshotView } from './SnapshotView.js';
import { TargetsView } from './TargetsView.js';

type ViewId =
  | 'overview'
  | 'targets'
  | 'skills'
  | 'packages'
  | 'doctor';

const NAV_ITEMS: Array<{ id: ViewId; labelKey: MessageKey }> = [
  { id: 'overview', labelKey: 'app.nav.overview' },
  { id: 'targets', labelKey: 'app.nav.targets' },
  { id: 'skills', labelKey: 'app.nav.skills' },
  { id: 'packages', labelKey: 'app.nav.packages' },
  { id: 'doctor', labelKey: 'app.nav.doctor' },
];

const BRAND_ICON = new URL('./assets/icon.png', import.meta.url).href;

const VIEW_TITLES: Record<ViewId, MessageKey> = {
  overview: 'app.titles.overview',
  targets: 'app.titles.targets',
  skills: 'app.titles.skills',
  packages: 'app.titles.packages',
  doctor: 'app.titles.doctor',
};

function NavIcon({ view }: { view: ViewId }) {
  const props = {
    className: 'nav-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (view) {
    case 'overview':
      return (
        <svg {...props}>
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.6" />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.6" />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.6" />
          <rect x="14" y="14" width="6.5" height="6.5" rx="1.6" />
        </svg>
      );
    case 'targets':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="7.5" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </svg>
      );
    case 'skills':
      return (
        <svg {...props}>
          <path d="M12 3.2l1.7 4.9 4.9 1.7-4.9 1.7L12 16.4l-1.7-4.9-4.9-1.7 4.9-1.7L12 3.2Z" />
          <path d="M18.6 15.2l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8.8-2.3Z" />
        </svg>
      );
    case 'packages':
      return (
        <svg {...props}>
          <path d="M20.5 8.4 12 3.5 3.5 8.4v7.2L12 20.5l8.5-4.9V8.4Z" />
          <path d="M3.7 8.5 12 13.8l8.3-5.3M12 20.4v-6.6" />
        </svg>
      );
    case 'doctor':
      return (
        <svg {...props}>
          <path d="M3 12.5h3.6L8.8 8l3.1 8 2-4h6.1" />
        </svg>
      );
    default:
      return null;
  }
}

export interface AppProps {
  api?: DesktopApi;
}

export function App({ api }: AppProps) {
  const client =
    api ?? (typeof window !== 'undefined' ? window.skillink : undefined);
  const { t } = useI18n();
  const [view, setView] = useState<ViewId>('overview');
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [gcReport, setGcReport] = useState<GcReport | null>(null);
  const [applyReport, setApplyReport] = useState<ApplyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);

  async function refresh(): Promise<void> {
    if (!client) {
      setError(t('app.errors.bridgeUnavailable'));
      return;
    }

    try {
      const nextSnapshot = await client.getSnapshot();
      setSnapshot(nextSnapshot);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();

    if (!client) {
      return;
    }

    void client
      .getRuntimeStatus()
      .then((status) => setGitAvailable(status.gitAvailable))
      .catch(() => setGitAvailable(null));
  }, []);

  async function runAction(action: () => Promise<void>): Promise<void> {
    if (!client) {
      return;
    }

    setBusy(true);
    setApplyReport(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function addTarget(input: AddTargetRequest): void {
    void runAction(async () => {
      await client!.addTarget(input);
    });
  }

  function removeTarget(input: TargetRemoveRequest): void {
    void runAction(async () => {
      await client!.removeTarget(input);
    });
  }

  function targetEnable(input: TargetEnableRequest): void {
    void runAction(async () => {
      await client!.targetEnable(input);
    });
  }

  function routeAdd(input: RouteAddRequest): void {
    void runAction(async () => {
      await client!.routeAdd(input);
    });
  }

  function removeRoute(input: RouteRemoveRequest): void {
    void runAction(async () => {
      await client!.routeRemove(input);
    });
  }

  function routeEnable(input: RouteEnableRequest): void {
    void runAction(async () => {
      await client!.routeEnable(input);
    });
  }

  async function scanSkills(
    sourceDir: string,
  ): Promise<SkillPackageScanReport> {
    if (!client) {
      throw new Error(t('app.errors.bridgeUnavailable'));
    }

    setBusy(true);
    setError(null);
    try {
      return await client.scanSkills({ sourceDir });
    } finally {
      setBusy(false);
    }
  }

  async function importSkill(
    input: ImportSkillRequest,
  ): Promise<ImportSkillResult> {
    if (!client) {
      throw new Error(t('app.errors.bridgeUnavailable'));
    }

    setBusy(true);
    setApplyReport(null);
    setError(null);
    try {
      const result = await client.importSkill(input);
      await refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }

  function createPackage(input: CreatePackageRequest): void {
    void runAction(async () => {
      await client!.createPackage(input);
    });
  }

  function copyPackage(input: CopyPackageRequest): void {
    void runAction(async () => {
      await client!.copyPackage(input);
    });
  }

  function packageTag(input: PackageTagRequest): void {
    void runAction(async () => {
      await client!.packageTag(input);
    });
  }

  function packageRemove(input: PackageRemoveRequest): void {
    void runAction(async () => {
      await client!.removePackage(input);
    });
  }

  function skillTag(input: SkillTagRequest): void {
    void runAction(async () => {
      await client!.skillTag(input);
    });
  }

  function skillRemove(input: SkillRemoveRequest): void {
    void runAction(async () => {
      await client!.skillRemove(input);
    });
  }

  function runGc(input: { dryRun: boolean }): void {
    void runAction(async () => {
      const report = await client!.gc(input);
      setGcReport(report);
    });
  }

  function applyRoutes(): void {
    void runAction(async () => {
      const report = await client!.apply({});
      setApplyReport(report);
    });
  }

  function previewRoutes(): void {
    void runAction(async () => {
      const report = await client!.apply({ dryRun: true });
      setApplyReport(report);
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={BRAND_ICON} alt="" />
          <div>
            <strong>{t('app.brand')}</strong>
            <span>{t('app.tagline')}</span>
          </div>
        </div>

        <nav className="nav" aria-label={t('app.nav.ariaLabel')}>
          <p className="nav-label">{t('app.nav.label')}</p>
          {NAV_ITEMS.map((item) => (
            <button
              aria-current={view === item.id ? 'page' : undefined}
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
            >
              <NavIcon view={item.id} />
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <GitUnavailableNotice visible={gitAvailable === false} />
          <LanguageTrigger onClick={() => setLanguageOpen(true)} />
          <div className="sidebar-foot">
            <span>{t('app.controlPlane')}</span>
            <code>{snapshot?.home ?? '~/.agents/skillink'}</code>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t('app.eyebrow')}</p>
            <h2>{t(VIEW_TITLES[view])}</h2>
          </div>
          <div className="topbar-actions">
            {busy ? <span className="busy">{t('app.status.working')}</span> : null}
            <button
              className="primary"
              onClick={() => applyRoutes()}
              disabled={busy}
            >
              {t('app.actions.applyRoutes')}
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {snapshot ? (
          view === 'overview' ? (
            <SnapshotView snapshot={snapshot} />
          ) : view === 'targets' ? (
            <TargetsView
              targets={snapshot.route.targets}
              statusEntries={snapshot.status.entries}
              targetSkills={snapshot.targetSkills}
              applyReport={applyReport}
              busy={busy}
              onBrowse={() => client?.chooseFolder() ?? null}
              onAddTarget={addTarget}
              onRemoveTarget={removeTarget}
              onTargetEnable={targetEnable}
              onRouteAdd={routeAdd}
              onRemoveRoute={removeRoute}
              onRouteEnable={routeEnable}
              onApply={applyRoutes}
              onPreview={previewRoutes}
            />
          ) : view === 'skills' ? (
            <SkillsView
              skills={snapshot.skills}
              gcReport={gcReport}
              busy={busy}
              onBrowse={() => client?.chooseFolder() ?? null}
              onScanSkills={scanSkills}
              onImportSkill={importSkill}
              onTag={skillTag}
              onRemove={skillRemove}
              onGc={runGc}
            />
          ) : view === 'packages' ? (
            <PackagesView
              packages={snapshot.packages}
              skills={snapshot.skills}
              busy={busy}
              onCreatePackage={createPackage}
              onCopyPackage={copyPackage}
              onTag={packageTag}
              onRemove={packageRemove}
            />
          ) : (
            <DoctorView
              report={snapshot.doctor}
              busy={busy}
              onRefresh={() => void refresh()}
              onApply={applyRoutes}
            />
          )
        ) : (
          <div className="loading">{t('app.loading')}</div>
        )}
      </section>

      <LanguageDialog
        open={languageOpen}
        onClose={() => setLanguageOpen(false)}
      />
    </div>
  );
}
