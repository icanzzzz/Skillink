import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared.js';

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('skillink:snapshot'),
  apply: (options = {}) => ipcRenderer.invoke('skillink:apply', options),
  chooseFolder: () => ipcRenderer.invoke('skillink:choose-folder'),
  scanSkills: (input) => ipcRenderer.invoke('skillink:scan-skills', input),
  importSkill: (input) => ipcRenderer.invoke('skillink:import-skill', input),
  createPackage: (input) => ipcRenderer.invoke('skillink:create-package', input),
  removePackage: (input) => ipcRenderer.invoke('skillink:remove-package', input),
  packageTag: (input) => ipcRenderer.invoke('skillink:package-tag', input),
  skillTag: (input) => ipcRenderer.invoke('skillink:skill-tag', input),
  skillRemove: (input) => ipcRenderer.invoke('skillink:skill-remove', input),
  addTarget: (input) => ipcRenderer.invoke('skillink:add-target', input),
  removeTarget: (input) => ipcRenderer.invoke('skillink:remove-target', input),
  targetEnable: (input) => ipcRenderer.invoke('skillink:target-enable', input),
  targetMode: (input) => ipcRenderer.invoke('skillink:target-mode', input),
  routeAdd: (input) => ipcRenderer.invoke('skillink:route-add', input),
  routeRemove: (input) => ipcRenderer.invoke('skillink:route-remove', input),
  routeEnable: (input) => ipcRenderer.invoke('skillink:route-enable', input),
  gc: (input = {}) => ipcRenderer.invoke('skillink:gc', input),
  getLanguageState: () => ipcRenderer.invoke('skillink:language-state'),
  getRuntimeStatus: () => ipcRenderer.invoke('skillink:runtime-status'),
  chooseLanguagePack: () => ipcRenderer.invoke('skillink:choose-language-pack'),
  installLanguagePack: (input) =>
    ipcRenderer.invoke('skillink:language-install', input),
  useLanguage: (locale) => ipcRenderer.invoke('skillink:language-use', { locale }),
  removeLanguage: (locale) =>
    ipcRenderer.invoke('skillink:language-remove', { locale }),
};

contextBridge.exposeInMainWorld('skillink', api);
