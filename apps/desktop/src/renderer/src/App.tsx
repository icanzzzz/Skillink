import { useEffect, useState } from 'react';
import type { GcReport, HistoryEntry } from '@skillink/core';
import type {
  AddTargetRequest,
  ImportFolderRequest,
  LibraryRemoveRequest,
  LibraryTagRequest,
  RouteAddRequest,
} from '../../ipc-schemas.js';
import type { DesktopApi, DesktopSnapshot } from '../../shared.js';
import { DoctorView } from './DoctorView.js';
import { HistoryView } from './HistoryView.js';
import { LibraryView } from './LibraryView.js';
import { SnapshotView } from './SnapshotView.js';
import { TargetsView } from './TargetsView.js';

type ViewId = 'overview' | 'targets' | 'library' | 'history' | 'doctor';

const NAV_ITEMS: Array<{ id: ViewId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'targets', label: 'Targets' },
  { id: 'library', label: 'Library' },
  { id: 'history', label: 'History' },
  { id: 'doctor', label: 'Doctor' },
];

const VIEW_TITLES: Record<ViewId, string> = {
  overview: 'Overview',
  targets: 'Targets',
  library: 'Public library',
  history: 'History',
  doctor: 'Doctor',
};

export interface AppProps {
  api?: DesktopApi;
}

export function App({ api }: AppProps) {
  const client = api ?? (typeof window !== 'undefined' ? window.skillink : undefined);
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

  function importFolder(input: ImportFolderRequest): void {
    void runAction(async () => {
      await client!.importFolder(input);
    });
  }

  function libraryTag(input: LibraryTagRequest): void {
    void runAction(async () => {
      await client!.libraryTag(input);
    });
  }

  function libraryRemove(input: LibraryRemoveRequest): void {
    void runAction(async () => {
      await client!.libraryRemove(input);
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
            <span>filesystem package manager</span>
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
            <button
              className="primary"
              onClick={applyRoutes}
              disabled={busy}
            >
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
              busy={busy}
              onBrowse={() => client?.chooseFolder() ?? null}
              onAddTarget={addTarget}
              onRouteAdd={routeAdd}
              onApply={applyRoutes}
            />
          ) : view === 'library' ? (
            <LibraryView
              library={snapshot.library}
              gcReport={gcReport}
              busy={busy}
              onBrowse={() => client?.chooseFolder() ?? null}
              onImport={importFolder}
              onTag={libraryTag}
              onRemove={libraryRemove}
              onGc={runGc}
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
