import { contextBridge, ipcRenderer } from 'electron';
import type { ApplyOptions, DesktopApi, DesktopSnapshot } from '../shared.js';

const api: DesktopApi = {
  getSnapshot: () =>
    ipcRenderer.invoke('skillink:snapshot') as Promise<DesktopSnapshot>,
  apply: (options: ApplyOptions = {}) =>
    ipcRenderer.invoke('skillink:apply', options),
};

contextBridge.exposeInMainWorld('skillink', api);
