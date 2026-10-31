import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc.js';

let mainWindow: BrowserWindow | null = null;

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

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  }

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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers(() => mainWindow);
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
