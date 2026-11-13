import { app, BrowserWindow, Menu, dialog } from 'electron';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { ControlPlaneState } from '@skillink/shared';
import {
  bundledLanguagePackPath,
  syncBundledLanguagePack,
} from './bundled-language.js';
import { createCliAdapter } from './cli-adapter.js';
import { buildControlPlaneListArgs } from './cli-commands.js';
import { isDevToolsShortcut } from './devtools.js';
import { registerIpcHandlers } from './ipc.js';

let mainWindow: BrowserWindow | null = null;

/**
 * Electron 是 GUI 子系统程序，主进程的 stdout/stderr 不会出现在终端里，
 * 启动期异常会表现为「双击没反应」。这里把错误落盘到 %TEMP% 并弹窗，
 * 保证任何启动失败都有可见的落点。
 */
function reportStartupFailure(scope: string, error: unknown): void {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const text = `[${new Date().toISOString()}] ${scope}\n${message}\n\n`;

  let logPath = '';
  try {
    logPath = path.join(app.getPath('temp'), 'skillink-startup-error.log');
    appendFileSync(logPath, text, 'utf8');
  } catch {
    logPath = '';
  }

  console.error(`[skillink] startup failure (${scope}):`, error);
  try {
    dialog.showErrorBox(
      `Skillink failed to start (${scope})`,
      logPath ? `${message}\n\nLog: ${logPath}` : message,
    );
  } catch {
    // showErrorBox 在 ready 之前失败时忽略，错误已尽力落盘。
  }
}

process.on('uncaughtException', (error) => {
  reportStartupFailure('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  reportStartupFailure('unhandledRejection', reason);
});


async function refreshBundledLanguagePack(): Promise<void> {
  const cli = createCliAdapter();

  try {
    const state = await cli.invoke<ControlPlaneState>(
      buildControlPlaneListArgs(),
    );
    if (!state.active) {
      return;
    }
    const installedPath = path.join(state.active, 'locales', 'zh-cn.json');

    await syncBundledLanguagePack({
      bundledPath: bundledLanguagePackPath({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      }),
      installedPath,
      install: (sourcePath) =>
        cli.invoke(['locale', 'install', sourcePath, '--force']),
      log: (message) => console.log(message),
    });
  } catch (error) {
    console.warn(
      `Unable to refresh bundled language pack: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'Skillink',
    ...(app.isPackaged
      ? {}
      : { icon: path.join(app.getAppPath(), 'build', 'icon.png') }),
    backgroundColor: '#f3ede1',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (!isDevToolsShortcut(input)) {
        return;
      }

      event.preventDefault();
      window.webContents.toggleDevTools();
    });
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  }

  window.webContents.on(
    'did-fail-load',
    (_event, code, description, url) => {
      reportStartupFailure(
        'did-fail-load',
        new Error(`${description} (${code}) ${url}`),
      );
    },
  );

  if (process.env.SKILLINK_SMOKE === '1') {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents
          .executeJavaScript('document.body.innerText')
          .then((text: string) => {
            console.log(
              `SKILLINK_SMOKE_TEXT:${text.replaceAll(/\s+/g, ' ').slice(0, 1200)}`,
            );
            app.quit();
          });
      }, 800);
    });
  }
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    await refreshBundledLanguagePack();
    registerIpcHandlers(() => mainWindow);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    reportStartupFailure('whenReady', error);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
