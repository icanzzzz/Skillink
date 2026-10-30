import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared.js';

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('skillink:snapshot'),
  apply: (options = {}) => ipcRenderer.invoke('skillink:apply', options),
  chooseFolder: () => ipcRenderer.invoke('skillink:choose-folder'),
  importFolder: (input) => ipcRenderer.invoke('skillink:import-folder', input),
  addTarget: (input) => ipcRenderer.invoke('skillink:add-target', input),
  routeAdd: (input) => ipcRenderer.invoke('skillink:route-add', input),
  routeRemove: (input) => ipcRenderer.invoke('skillink:route-remove', input),
  libraryTag: (input) => ipcRenderer.invoke('skillink:library-tag', input),
  libraryRemove: (input) => ipcRenderer.invoke('skillink:library-remove', input),
  gc: (input = {}) => ipcRenderer.invoke('skillink:gc', input),
  history: () => ipcRenderer.invoke('skillink:history'),
  rollback: (input) => ipcRenderer.invoke('skillink:rollback', input),
};

contextBridge.exposeInMainWorld('skillink', api);
