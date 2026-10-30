import { useEffect, useState } from 'react';
import type { GcReport, HistoryEntry } from '@skillink/core';
import type {
  AddTargetRequest,
  CopyPackageRequest,
  CreatePackageRequest,
  ImportSkillRequest,
  PackageRemoveRequest,
  PackageTagRequest,
  RouteAddRequest,
  SkillRemoveRequest,
  SkillTagRequest,
} from '../../ipc-schemas.js';
import type { DesktopApi, DesktopSnapshot } from '../../shared.js';
import { DoctorView } from './DoctorView.js';
import { HistoryView } from './HistoryView.js';
import { PackagesView } from './PackagesView.js';
import { SkillsView } from './SkillsView.js';
import { SnapshotView } from './SnapshotView.js';
import { TargetsView } from './TargetsView.js';

type ViewId =
  | 'overview'
  | 'targets'
  | 'skills'
  | 'packages'
  | 'history'
  | 'doctor';

const NAV_ITEMS: Array<{ id: ViewId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'targets', label: 'Targets' },
  { id: 'skills', label: 'Skills' },
  { id: 'packages', label: 'Packages' },
  { id: 'history', label: 'History' },
  { id: 'doctor', label: 'Doctor' },
];

const VIEW_TITLES: Record<ViewId, string> = {
  overview: 'Overview',
  targets: 'Targets',
  skills: 'Installed skills',
  packages: 'Package compositions',
  history: 'History',
  doctor: 'Doctor',
};

export interface AppProps {
  api?: DesktopApi;
}

export function App({ api }: AppProps) {
  const client =
    api ?? (typeof window !== 'undefined' ? window.skillink : undefined);
  const [view, setView] = useState<ViewId>('overview');
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [gcReport, setGcReport] = useState<GcReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    if (!client) {
      setError('Skillink IPC bridge is unavailable.');
      return;
    }

    try {
      const [nextSnapshot, nextHistory] = await Promise.all([
        client.getSnapshot(),
        client.history(),
      ]);
      setSnapshot(nextSnapshot);
      setHistory(nextHistory);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function runAction(action: () => Promise<void>): Promise<void> {
    if (!client) {
      return;
    }

    setBusy(true);
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

  function routeAdd(input: RouteAddRequest): void {
    void runAction(async () => {
      await client!.routeAdd(input);
    });
  }

  function importSkill(input: ImportSkillRequest): void {
    void runAction(async () => {
      await client!.importSkill(input);
    });
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

  function rollback(id: string, applyAfter: boolean): void {
    void runAction(async () => {
      await client!.rollback({ id });
      if (applyAfter) {
        await client!.apply({});
      }
    });
  }

  function applyRoutes(): void {
    void runAction(async () => {
      await client!.apply({});
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <strong>Skillink</strong>
            <span>skill and package manager</span>
          </div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span>Control plane</span>
          <code>{snapshot?.home ?? '~/.agents/skillink'}</code>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2>{VIEW_TITLES[view]}</h2>
          </div>
          <div className="topbar-actions">
            {busy ? <span className="busy">Working…</span> : null}
            <button className="primary" onClick={applyRoutes} disabled={busy}>
              Apply routes
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
              busy={busy}
              onBrowse={() => client?.chooseFolder() ?? null}
              onAddTarget={addTarget}
              onRouteAdd={routeAdd}
              onApply={applyRoutes}
            />
          ) : view === 'skills' ? (
            <SkillsView
              skills={snapshot.skills}
              gcReport={gcReport}
              busy={busy}
              onBrowse={() => client?.chooseFolder() ?? null}
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
          ) : view === 'history' ? (
            <HistoryView entries={history} busy={busy} onRollback={rollback} />
          ) : (
            <DoctorView
              report={snapshot.doctor}
              busy={busy}
              onRefresh={() => void refresh()}
              onApply={applyRoutes}
            />
          )
        ) : (
          <div className="loading">Loading Skillink…</div>
        )}
      </section>
    </div>
  );
}
