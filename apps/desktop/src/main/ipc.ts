import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ApplyReport,
  GcReport,
  ImportSkillResult,
  PackageLock,
  PackageVersion,
  SnapshotReport,
  TargetRoute,
} from '@skillink/shared';
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
  RouteEnableRequestSchema,
  RouteRemoveRequestSchema,
  SkillRemoveRequestSchema,
  SkillTagRequestSchema,
  TargetEnableRequestSchema,
  TargetRemoveRequestSchema,
} from '../ipc-schemas.js';
import { createCliAdapter } from './cli-adapter.js';
import {
  buildAddTargetArgs,
  buildApplyArgs,
  buildCopyPackageArgs,
  buildCreatePackageArgs,
  buildGcArgs,
  buildImportSkillArgs,
  buildPackageRemoveArgs,
  buildPackageTagArgs,
  buildRemoveTargetArgs,
  buildRollbackArgs,
  buildRouteAddArgs,
  buildRouteEnableArgs,
  buildRouteRemoveArgs,
  buildSkillRemoveArgs,
  buildSkillTagArgs,
  buildTargetEnableArgs,
} from './cli-commands.js';
import { assertTrustedSender, type SenderPolicy } from './sender-policy.js';

const cli = createCliAdapter();

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

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  const handle = (
    channel: string,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, getMainWindow(), senderPolicy());
      return listener(event, ...args);
    });
  };

  handle('skillink:snapshot', () =>
    cli.snapshot() satisfies Promise<SnapshotReport>,
  );
  handle('skillink:choose-folder', (event) => chooseFolder(event));

  handle('skillink:apply', async (_event, input: unknown) => {
    const request = ApplyRequestSchema.parse(input ?? {});
    return cli.invoke<ApplyReport>(buildApplyArgs(request));
  });

  handle('skillink:import-skill', async (_event, input: unknown) => {
    const request = ImportSkillRequestSchema.parse(input);
    return cli.invoke<ImportSkillResult>(buildImportSkillArgs(request));
  });

  handle('skillink:create-package', async (_event, input: unknown) => {
    const request = CreatePackageRequestSchema.parse(input);
    return cli.invoke<PackageVersion>(buildCreatePackageArgs(request));
  });

  handle('skillink:copy-package', async (_event, input: unknown) => {
    const request = CopyPackageRequestSchema.parse(input);
    return cli.invoke<PackageVersion>(buildCopyPackageArgs(request));
  });

  handle('skillink:remove-package', async (_event, input: unknown) => {
    const request = PackageRemoveRequestSchema.parse(input);
    await cli.invoke(buildPackageRemoveArgs(request));
  });

  handle('skillink:package-tag', async (_event, input: unknown) => {
    const request = PackageTagRequestSchema.parse(input);
    await cli.invoke(buildPackageTagArgs(request));
  });

  handle('skillink:skill-tag', async (_event, input: unknown) => {
    const request = SkillTagRequestSchema.parse(input);
    await cli.invoke(buildSkillTagArgs(request));
  });

  handle('skillink:skill-remove', async (_event, input: unknown) => {
    const request = SkillRemoveRequestSchema.parse(input);
    await cli.invoke(buildSkillRemoveArgs(request));
  });

  handle('skillink:add-target', async (_event, input: unknown) => {
    const request = AddTargetRequestSchema.parse(input);
    return cli.invoke<TargetRoute>(buildAddTargetArgs(request));
  });

  handle('skillink:route-add', async (_event, input: unknown) => {
    const request = RouteAddRequestSchema.parse(input);
    return cli.invoke<PackageLock>(buildRouteAddArgs(request));
  });

  handle('skillink:route-remove', async (_event, input: unknown) => {
    const request = RouteRemoveRequestSchema.parse(input);
    return cli.invoke<boolean>(buildRouteRemoveArgs(request));
  });

  handle('skillink:route-enable', async (_event, input: unknown) => {
    const request = RouteEnableRequestSchema.parse(input);
    return cli.invoke<PackageLock>(buildRouteEnableArgs(request));
  });

  handle('skillink:remove-target', async (_event, input: unknown) => {
    const request = TargetRemoveRequestSchema.parse(input);
    return cli.invoke<TargetRoute>(buildRemoveTargetArgs(request));
  });

  handle('skillink:target-enable', async (_event, input: unknown) => {
    const request = TargetEnableRequestSchema.parse(input);
    return cli.invoke<TargetRoute>(buildTargetEnableArgs(request));
  });

  handle('skillink:gc', async (_event, input: unknown) => {
    const request = GcRequestSchema.parse(input ?? {});
    return cli.invoke<GcReport>(buildGcArgs(request));
  });

  handle('skillink:rollback', async (_event, input: unknown) => {
    const request = RollbackRequestSchema.parse(input);
    await cli.invoke(buildRollbackArgs(request));
  });
}
