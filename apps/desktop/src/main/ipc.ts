import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addRouteEntry,
  addTarget,
  apply,
  copyPackageVersion,
  createPackageVersion,
  doctor,
  gc,
  importSkill,
  listHistory,
  readPackageFile,
  readRouteFile,
  readSkillFile,
  removePackageVersion,
  removeRouteEntry,
  removeSkillVersion,
  restoreHistorySnapshot,
  setPackageTag,
  setSkillTag,
  status,
} from '@skillink/core';
import { getSkillinkPaths } from '@skillink/shared';
import {
  AddTargetRequestSchema,
  ApplyRequestSchema,
  CopyPackageRequestSchema,
  CreatePackageRequestSchema,
  GcRequestSchema,
  ImportSkillRequestSchema,
  PackageRemoveRequestSchema,
  PackageTagRequestSchema,
  RollbackRequestSchema,
  RouteAddRequestSchema,
  RouteRemoveRequestSchema,
  SkillRemoveRequestSchema,
  SkillTagRequestSchema,
} from '../ipc-schemas.js';
import type { DesktopSnapshot } from '../shared.js';
import { assertTrustedSender, type SenderPolicy } from './sender-policy.js';

async function getSnapshot(): Promise<DesktopSnapshot> {
  const paths = getSkillinkPaths();
  const [skills, packages, route, statusReport, doctorReport] =
    await Promise.all([
      readSkillFile(paths),
      readPackageFile(paths),
      readRouteFile(paths),
      status({ paths }),
      doctor({ paths }),
    ]);

  return {
    home: paths.home,
    skills,
    packages,
    route,
    status: statusReport,
    doctor: doctorReport,
  };
}

async function chooseFolder(
  event: Electron.IpcMainInvokeEvent,
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function senderPolicy(): SenderPolicy {
  return {
    isPackaged: app.isPackaged,
    appUrl: pathToFileURL(
      path.join(app.getAppPath(), 'out', 'renderer', 'index.html'),
    ).href,
    devServerUrl: process.env.ELECTRON_RENDERER_URL,
  };
}

function handle(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(
      event,
      BrowserWindow.fromWebContents(event.sender),
      senderPolicy(),
    );
    return listener(event, ...args);
  });
}

export function registerIpcHandlers(): void {
  handle('skillink:snapshot', () => getSnapshot());
  handle('skillink:choose-folder', (event) => chooseFolder(event));

  handle('skillink:apply', async (_event, input: unknown) => {
    const request = ApplyRequestSchema.parse(input ?? {});
    return apply({
      paths: getSkillinkPaths(),
      dryRun: request.dryRun,
      prune: request.prune,
      targetId: request.targetId,
    });
  });

  handle('skillink:import-skill', async (_event, input: unknown) => {
    const request = ImportSkillRequestSchema.parse(input);
    return importSkill({
      sourceDir: request.sourceDir,
      name: request.name,
      version: request.version,
      home: getSkillinkPaths().home,
    });
  });

  handle('skillink:create-package', async (_event, input: unknown) => {
    const request = CreatePackageRequestSchema.parse(input);
    return createPackageVersion({
      paths: getSkillinkPaths(),
      name: request.name,
      version: request.version,
      description: request.description,
      skills: request.skills,
      packages: request.packages,
    });
  });

  handle('skillink:copy-package', async (_event, input: unknown) => {
    const request = CopyPackageRequestSchema.parse(input);
    return copyPackageVersion({
      paths: getSkillinkPaths(),
      sourceName: request.sourceName,
      sourceVersion: request.sourceVersion,
      targetName: request.targetName,
      targetVersion: request.targetVersion,
      description: request.description,
      skillOverrides: request.skillOverrides,
      packageOverrides: request.packageOverrides,
      dropSkills: request.dropSkills,
      dropPackages: request.dropPackages,
    });
  });

  handle('skillink:remove-package', async (_event, input: unknown) => {
    const request = PackageRemoveRequestSchema.parse(input);
    await removePackageVersion(
      getSkillinkPaths(),
      request.name,
      request.version,
    );
  });

  handle('skillink:package-tag', async (_event, input: unknown) => {
    const request = PackageTagRequestSchema.parse(input);
    await setPackageTag(
      getSkillinkPaths(),
      request.name,
      request.version,
      request.tag,
    );
  });

  handle('skillink:skill-tag', async (_event, input: unknown) => {
    const request = SkillTagRequestSchema.parse(input);
    await setSkillTag(
      getSkillinkPaths(),
      request.name,
      request.version,
      request.tag,
    );
  });

  handle('skillink:skill-remove', async (_event, input: unknown) => {
    const request = SkillRemoveRequestSchema.parse(input);
    await removeSkillVersion(
      getSkillinkPaths(),
      request.name,
      request.version,
    );
  });

  handle('skillink:add-target', async (_event, input: unknown) => {
    const request = AddTargetRequestSchema.parse(input);
    return addTarget({
      paths: getSkillinkPaths(),
      path: request.path,
      id: request.id,
      label: request.label,
      mode: request.mode,
    });
  });

  handle('skillink:route-add', async (_event, input: unknown) => {
    const request = RouteAddRequestSchema.parse(input);
    return addRouteEntry({
      paths: getSkillinkPaths(),
      targetId: request.targetId,
      name: request.name,
      requested: request.requested,
    });
  });

  handle('skillink:route-remove', async (_event, input: unknown) => {
    const request = RouteRemoveRequestSchema.parse(input);
    return removeRouteEntry({
      paths: getSkillinkPaths(),
      targetId: request.targetId,
      name: request.name,
    });
  });

  handle('skillink:gc', async (_event, input: unknown) => {
    const request = GcRequestSchema.parse(input ?? {});
    return gc(getSkillinkPaths(), request);
  });

  handle('skillink:history', () => listHistory(getSkillinkPaths()));

  handle('skillink:rollback', async (_event, input: unknown) => {
    const request = RollbackRequestSchema.parse(input);
    await restoreHistorySnapshot(getSkillinkPaths(), request.id);
  });
}
