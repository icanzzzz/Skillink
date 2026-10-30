import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import {
  apply,
  doctor,
  readRouteFile,
  readSkillsFile,
  status,
} from '@skillink/core';
import { getSkillinkPaths } from '@skillink/shared';
import type { ApplyOptions, DesktopSnapshot } from '../shared.js';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'Skillink',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  }
}

async function getSnapshot(): Promise<DesktopSnapshot> {
  const paths = getSkillinkPaths();
  const [library, route, statusReport, doctorReport] = await Promise.all([
    readSkillsFile(paths),
    readRouteFile(paths),
    status({ paths }),
    doctor({ paths }),
  ]);

  return {
    home: paths.home,
    library,
    route,
    status: statusReport,
    doctor: doctorReport,
  };
}

app.whenReady().then(() => {
  ipcMain.handle('skillink:snapshot', () => getSnapshot());
  ipcMain.handle('skillink:apply', async (_event, options: ApplyOptions = {}) => {
    const paths = getSkillinkPaths();
    return apply({
      paths,
      dryRun: Boolean(options.dryRun),
      prune: Boolean(options.prune),
      targetId: options.targetId,
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
