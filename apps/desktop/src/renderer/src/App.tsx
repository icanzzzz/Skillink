import { useEffect, useState } from 'react';
import type { DesktopApi, DesktopSnapshot } from '../../shared.js';
import { SnapshotView } from './SnapshotView.js';

export interface AppProps {
  api?: DesktopApi;
}

export function App({ api }: AppProps) {
  const client = api ?? (typeof window !== 'undefined' ? window.skillink : undefined);
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    if (!client) {
      setError('Skillink IPC bridge is unavailable.');
      return;
    }

    try {
      setSnapshot(await client.getSnapshot());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function applyRoutes(): Promise<void> {
    if (!client) {
      return;
    }

    setBusy(true);
    try {
      await client.apply({});
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
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
          <a className="nav-item active" href="#overview">
            Overview
          </a>
          <a className="nav-item" href="#targets">
            Targets
          </a>
          <a className="nav-item" href="#library">
            Library
          </a>
          <a className="nav-item" href="#doctor">
            Doctor
          </a>
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
            <h2>Overview</h2>
          </div>
          <div className="topbar-actions">
            {busy ? <span className="busy">Applying…</span> : null}
            <button className="primary" onClick={() => void applyRoutes()} disabled={busy}>
              Apply routes
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {snapshot ? (
          <SnapshotView snapshot={snapshot} />
        ) : (
          <div className="loading">Loading Skillink…</div>
        )}
      </section>
    </div>
  );
}
