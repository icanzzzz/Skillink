import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ApplyReport,
  GcReport,
  ImportSkillResult,
  LanguageState,
  LocaleInstallReport,
  PackageLock,
  PackageVersion,
  SkillPackageScanReport,
  TargetRoute,
} from '@skillink/shared';
import {
  AddTargetRequestSchema,
  ApplyRequestSchema,
  CopyPackageRequestSchema,
  CreatePackageRequestSchema,
  GcRequestSchema,
  ImportSkillRequestSchema,
  LanguageInstallRequestSchema,
  LanguageRemoveRequestSchema,
  LanguageUseRequestSchema,
  PackageRemoveRequestSchema,
  PackageTagRequestSchema,
  RouteAddRequestSchema,
  RouteEnableRequestSchema,
  RouteRemoveRequestSchema,
  ScanSkillsRequestSchema,
  SkillRemoveRequestSchema,
  SkillTagRequestSchema,
  TargetEnableRequestSchema,
  TargetRemoveRequestSchema,
} from '../ipc-schemas.js';
import { createCliAdapter } from './cli-adapter.js';
import { localizeError } from './error-localization.js';
import {
  buildAddTargetArgs,
  buildApplyArgs,
  buildCopyPackageArgs,
  buildCreatePackageArgs,
  buildGcArgs,
  buildImportSkillArgs,
  buildLanguageInstallArgs,
  buildLanguageListArgs,
  buildLanguageRemoveArgs,
  buildLanguageUseArgs,
  buildPackageRemoveArgs,
  buildPackageTagArgs,
  buildRemoveTargetArgs,
  buildRouteAddArgs,
  buildRouteEnableArgs,
  buildRouteRemoveArgs,
  buildScanSkillsArgs,
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

async function chooseLanguagePack(
  event: Electron.IpcMainInvokeEvent,
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Skillink language pack', extensions: ['json'] }],
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

async function localizeIpcError(error: unknown): Promise<Error> {
  return localizeError(error, () =>
    cli.invoke<LanguageState>(buildLanguageListArgs()),
  );
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
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event, getMainWindow(), senderPolicy());
      try {
        return await listener(event, ...args);
      } catch (error) {
        if (channel === 'skillink:language-state') {
          throw error;
        }
        throw await localizeIpcError(error);
      }
    });
  };

  handle('skillink:snapshot', () => cli.snapshot());
  handle('skillink:runtime-status', () => cli.runtimeStatus());
  handle('skillink:choose-folder', (event) => chooseFolder(event));
  handle('skillink:language-state', () =>
    cli.invoke<LanguageState>(buildLanguageListArgs()),
  );
  handle('skillink:choose-language-pack', (event) =>
    chooseLanguagePack(event),
  );

  handle('skillink:language-install', async (_event, input: unknown) => {
    const request = LanguageInstallRequestSchema.parse(input);
    return cli.invoke<LocaleInstallReport>(
      buildLanguageInstallArgs(request),
    );
  });

  handle('skillink:language-use', async (_event, input: unknown) => {
    const request = LanguageUseRequestSchema.parse(input);
    await cli.invoke(buildLanguageUseArgs(request.locale));
  });

  handle('skillink:language-remove', async (_event, input: unknown) => {
    const request = LanguageRemoveRequestSchema.parse(input);
    await cli.invoke(buildLanguageRemoveArgs(request.locale));
  });

  handle('skillink:apply', async (_event, input: unknown) => {
    const request = ApplyRequestSchema.parse(input ?? {});
    return cli.invoke<ApplyReport>(buildApplyArgs(request));
  });

  handle('skillink:scan-skills', async (_event, input: unknown) => {
    const request = ScanSkillsRequestSchema.parse(input);
    return cli.invoke<SkillPackageScanReport>(buildScanSkillsArgs(request));
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
}
