import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  LanguagePackSchema,
  type LanguagePack,
} from '@skillink/shared';

export interface BundledLanguagePackLocation {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

const versionCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

export interface SyncBundledLanguagePackOptions {
  bundledPath: string;
  installedPath: string;
  install: (sourcePath: string) => Promise<unknown>;
  log?: (message: string) => void;
}

export function bundledLanguagePackPath(
  location: BundledLanguagePackLocation,
): string {
  return location.isPackaged
    ? path.join(location.resourcesPath, 'locales', 'zh-CN.json')
    : path.resolve(location.appPath, '../../locales/zh-CN.json');
}

/**
 * The bundled zh-CN pack is a sample, but users can edit or replace it. Only
 * refresh an installed copy that still identifies itself as the bundled pack
 * and is missing messages or older than the version shipped with Skillink.
 */
export function shouldRefreshBundledLanguagePack(
  installed: LanguagePack,
  bundled: LanguagePack,
): boolean {
  if (
    installed.locale.toLowerCase() !== bundled.locale.toLowerCase() ||
    installed.name !== bundled.name ||
    installed.nativeName !== bundled.nativeName
  ) {
    return false;
  }

  const hasMissingMessage = Object.keys(bundled.messages).some(
    (key) => !Object.prototype.hasOwnProperty.call(installed.messages, key),
  );

  return (
    hasMissingMessage ||
    versionCollator.compare(bundled.version, installed.version) > 0
  );
}

async function readPack(filePath: string): Promise<LanguagePack | undefined> {
  try {
    return LanguagePackSchema.parse(
      JSON.parse(await readFile(filePath, 'utf8')),
    );
  } catch {
    return undefined;
  }
}

/**
 * Updates an outdated copy of the bundled language pack before the renderer
 * starts. Installer upgrades intentionally leave user language packs alone, so
 * this keeps bundled UI text current without overwriting custom packs. Failure
 * must never prevent the application from starting.
 */
export async function syncBundledLanguagePack(
  options: SyncBundledLanguagePackOptions,
): Promise<boolean> {
  try {
    const bundled = await readPack(options.bundledPath);
    if (!bundled) {
      return false;
    }

    const installed = await readPack(options.installedPath);
    if (!installed || !shouldRefreshBundledLanguagePack(installed, bundled)) {
      return false;
    }

    await options.install(options.bundledPath);
    options.log?.(
      `Refreshed bundled language pack ${bundled.locale} at ${options.installedPath}.`,
    );
    return true;
  } catch (error) {
    options.log?.(
      `Unable to refresh bundled language pack: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}
