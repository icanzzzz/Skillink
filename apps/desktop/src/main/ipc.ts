import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  addRouteEntry,
  addTarget,
  apply,
  doctor,
  gc,
  importFolder,
  listHistory,
  readRouteFile,
  readSkillsFile,
  removeLibraryVersion,
  removeRouteEntry,
  restoreHistorySnapshot,
  setLibraryTag,
  status,
} from '@skillink/core';
import { getSkillinkPaths } from '@skillink/shared';
import {
  AddTargetRequestSchema,
  ApplyRequestSchema,
  GcRequestSchema,
  ImportFolderRequestSchema,
  LibraryRemoveRequestSchema,
  LibraryTagRequestSchema,
  RollbackRequestSchema,
  RouteAddRequestSchema,
  RouteRemoveRequestSchema,
} from '../ipc-schemas.js';
import type { DesktopSnapshot } from '../shared.js';

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

async function chooseFolder(event: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function registerIpcHandlers(): void {
  ipcMain.handle('skillink:snapshot', () => getSnapshot());
  ipcMain.handle('skillink:choose-folder', (event) => chooseFolder(event));

  ipcMain.handle('skillink:apply', async (_event, input: unknown) => {
    const request = ApplyRequestSchema.parse(input ?? {});
    return apply({
      paths: getSkillinkPaths(),
      dryRun: request.dryRun,
      prune: request.prune,
      targetId: request.targetId,
    });
  });

  ipcMain.handle('skillink:import-folder', async (_event, input: unknown) => {
    const request = ImportFolderRequestSchema.parse(input);
    return importFolder({
      sourceDir: request.sourceDir,
      name: request.name,
      version: request.version,
      home: getSkillinkPaths().home,
    });
  });

  ipcMain.handle('skillink:add-target', async (_event, input: unknown) => {
    const request = AddTargetRequestSchema.parse(input);
    return addTarget({
      paths: getSkillinkPaths(),
      path: request.path,
      id: request.id,
      label: request.label,
      mode: request.mode,
    });
  });

  ipcMain.handle('skillink:route-add', async (_event, input: unknown) => {
    const request = RouteAddRequestSchema.parse(input);
    return addRouteEntry({
      paths: getSkillinkPaths(),
      targetId: request.targetId,
      name: request.name,
      requested: request.requested,
    });
  });

  ipcMain.handle('skillink:route-remove', async (_event, input: unknown) => {
    const request = RouteRemoveRequestSchema.parse(input);
    return removeRouteEntry({
      paths: getSkillinkPaths(),
      targetId: request.targetId,
      name: request.name,
    });
  });

  ipcMain.handle('skillink:library-tag', async (_event, input: unknown) => {
    const request = LibraryTagRequestSchema.parse(input);
    await setLibraryTag(
      getSkillinkPaths(),
      request.name,
      request.version,
      request.tag,
    );
  });

  ipcMain.handle('skillink:library-remove', async (_event, input: unknown) => {
    const request = LibraryRemoveRequestSchema.parse(input);
    await removeLibraryVersion(getSkillinkPaths(), request.name, request.version);
  });

  ipcMain.handle('skillink:gc', async (_event, input: unknown) => {
    const request = GcRequestSchema.parse(input ?? {});
    return gc(getSkillinkPaths(), request);
  });

  ipcMain.handle('skillink:history', () => listHistory(getSkillinkPaths()));

  ipcMain.handle('skillink:rollback', async (_event, input: unknown) => {
    const request = RollbackRequestSchema.parse(input);
    await restoreHistorySnapshot(getSkillinkPaths(), request.id);
  });
}
