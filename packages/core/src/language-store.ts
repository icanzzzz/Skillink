import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  EN_MESSAGES,
  LOCALE_PATTERN,
  LanguagePackSchema,
  MAX_LANGUAGE_PACK_BYTES,
  SettingsFileSchema,
  SkillinkError,
  matchLocale,
  type LanguagePack,
  type LanguagePackSummary,
  type LanguageState,
  type LocaleInstallReport,
  type MessageCatalog,
  type MessageValue,
  type SettingsFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';

export interface InstallLanguagePackOptions {
  sourcePath: string;
  use?: boolean;
  force?: boolean;
}

export interface LanguageStateOptions {
  env?: NodeJS.ProcessEnv;
  systemLocale?: string;
}

export interface RemoveLanguagePackResult {
  removed: string;
  current: string;
}

const BUILTIN_EN: LanguagePackSummary = {
  locale: 'en',
  name: 'English',
  nativeName: 'English',
  version: '1.0.0',
  direction: 'ltr',
  messageCount: Object.keys(EN_MESSAGES).length,
  coverage: 1,
  builtIn: true,
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function invalidPack(
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown,
): SkillinkError {
  return new SkillinkError(
    'LANGUAGE_PACK_INVALID',
    message,
    details,
    cause === undefined ? undefined : { cause },
  );
}

function summarize(pack: LanguagePack): LanguagePackSummary {
  const keys = Object.keys(pack.messages);
  const knownKeys = keys.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(EN_MESSAGES, key)) {
      return false;
    }
    const value = pack.messages[key] as MessageValue | undefined;
    if (value === undefined) {
      return false;
    }
    return typeof value === 'string'
      ? value.trim().length > 0
      : value.other.trim().length > 0;
  });
  const total = Object.keys(EN_MESSAGES).length;

  return {
    locale: pack.locale,
    name: pack.name,
    nativeName: pack.nativeName,
    version: pack.version,
    direction: pack.direction,
    messageCount: keys.length,
    coverage: total === 0 ? 1 : knownKeys.length / total,
    builtIn: false,
  };
}

function packPath(paths: SkillinkPaths, locale: string): string {
  return path.join(paths.localesDir, `${locale.toLowerCase()}.json`);
}

async function readPackFile(filePath: string): Promise<LanguagePack | undefined> {
  try {
    const text = await readFile(filePath, 'utf8');
    return LanguagePackSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export async function readSettingsFile(
  paths: SkillinkPaths,
): Promise<SettingsFile> {
  return readJsonFile(paths.settingsFile, SettingsFileSchema, {
    schemaVersion: 1,
  });
}

export async function writeSettingsFile(
  paths: SkillinkPaths,
  settings: SettingsFile,
): Promise<void> {
  await writeJsonAtomic(paths.settingsFile, settings, SettingsFileSchema);
}

export async function listLanguagePacks(
  paths: SkillinkPaths,
): Promise<LanguagePackSummary[]> {
  const packs: LanguagePackSummary[] = [{ ...BUILTIN_EN }];
  let entries;

  try {
    entries = await readdir(paths.localesDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return packs;
    }
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to read ${paths.localesDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { directory: paths.localesDir },
      { cause: error },
    );
  }

  const seen = new Set(['en']);
  const installed: LanguagePackSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }

    const pack = await readPackFile(path.join(paths.localesDir, entry.name));
    if (!pack) {
      continue;
    }

    const key = pack.locale.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    installed.push(summarize(pack));
  }

  installed.sort((left, right) => {
    const a = left.locale.toLowerCase();
    const b = right.locale.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });

  packs.push(...installed);
  return packs;
}

export async function installLanguagePack(
  paths: SkillinkPaths,
  options: InstallLanguagePackOptions,
): Promise<LocaleInstallReport> {
  let fileStat;
  try {
    fileStat = await stat(options.sourcePath);
  } catch (error) {
    throw invalidPack(
      `Failed to read language pack ${options.sourcePath}.`,
      { sourcePath: options.sourcePath },
      error,
    );
  }

  if (!fileStat.isFile()) {
    throw invalidPack('Language pack must be a regular JSON file.', {
      sourcePath: options.sourcePath,
    });
  }

  if (fileStat.size > MAX_LANGUAGE_PACK_BYTES) {
    throw invalidPack(
      `Language pack exceeds the ${MAX_LANGUAGE_PACK_BYTES} byte limit.`,
      { sourcePath: options.sourcePath, size: fileStat.size },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(options.sourcePath, 'utf8'));
  } catch (error) {
    throw invalidPack(
      `Language pack ${options.sourcePath} is not valid JSON.`,
      { sourcePath: options.sourcePath },
      error,
    );
  }

  let pack: LanguagePack;
  try {
    pack = LanguagePackSchema.parse(raw);
  } catch (error) {
    throw invalidPack(
      `Language pack ${options.sourcePath} does not match the schema.`,
      { sourcePath: options.sourcePath },
      error,
    );
  }

  if (pack.locale.toLowerCase() === 'en') {
    throw new SkillinkError(
      'LANGUAGE_PACK_BUILTIN',
      'The built-in English language pack cannot be replaced.',
      { locale: pack.locale },
    );
  }

  const target = packPath(paths, pack.locale);
  let exists = false;
  try {
    await stat(target);
    exists = true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw new SkillinkError(
        'IO_ERROR',
        `Failed to inspect ${target}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { filePath: target },
        { cause: error },
      );
    }
  }

  if (exists && !options.force) {
    throw new SkillinkError(
      'LANGUAGE_PACK_EXISTS',
      `Language pack ${pack.locale} is already installed.`,
      { locale: pack.locale },
    );
  }

  const missingKeys = Object.keys(EN_MESSAGES).filter(
    (key) => !Object.prototype.hasOwnProperty.call(pack.messages, key),
  );
  const extraKeys = Object.keys(pack.messages).filter(
    (key) => !Object.prototype.hasOwnProperty.call(EN_MESSAGES, key),
  );

  await writeJsonAtomic(target, pack, LanguagePackSchema);

  if (options.use) {
    await writeSettingsFile(paths, {
      schemaVersion: 1,
      locale: pack.locale,
    });
  }

  const state = await getLanguageState(paths);

  return {
    pack: summarize(pack),
    missingKeys,
    extraKeys,
    active: state.current.toLowerCase() === pack.locale.toLowerCase(),
  };
}

export async function setActiveLocale(
  paths: SkillinkPaths,
  locale: string,
): Promise<void> {
  const requested = locale.trim();
  if (!requested) {
    throw new SkillinkError(
      'LANGUAGE_PACK_NOT_FOUND',
      'A locale is required.',
    );
  }

  if (requested.toLowerCase() === 'en') {
    await writeSettingsFile(paths, { schemaVersion: 1, locale: 'en' });
    return;
  }

  const packs = await listLanguagePacks(paths);
  const pack = packs.find(
    (candidate) =>
      !candidate.builtIn &&
      candidate.locale.toLowerCase() === requested.toLowerCase(),
  );

  if (!pack) {
    throw new SkillinkError(
      'LANGUAGE_PACK_NOT_FOUND',
      `Language pack ${requested} is not installed.`,
      {
        locale: requested,
        available: packs.map((candidate) => candidate.locale),
      },
    );
  }

  await writeSettingsFile(paths, {
    schemaVersion: 1,
    locale: pack.locale,
  });
}

export async function removeLanguagePack(
  paths: SkillinkPaths,
  locale: string,
): Promise<RemoveLanguagePackResult> {
  const requested = locale.trim();
  if (!LOCALE_PATTERN.test(requested)) {
    throw new SkillinkError(
      'LANGUAGE_PACK_NOT_FOUND',
      `Language pack ${requested || locale} is not installed.`,
      { locale: requested },
    );
  }
  if (requested.toLowerCase() === 'en') {
    throw new SkillinkError(
      'LANGUAGE_PACK_BUILTIN',
      'The built-in English language pack cannot be removed.',
      { locale: 'en' },
    );
  }

  const target = packPath(paths, requested);
  if (
    path.resolve(path.dirname(target)).toLowerCase() !==
    path.resolve(paths.localesDir).toLowerCase()
  ) {
    throw new SkillinkError(
      'LANGUAGE_PACK_NOT_FOUND',
      `Language pack ${requested} is not installed.`,
      { locale: requested },
    );
  }

  try {
    await stat(target);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new SkillinkError(
        'LANGUAGE_PACK_NOT_FOUND',
        `Language pack ${requested} is not installed.`,
        { locale: requested },
      );
    }
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to inspect ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { filePath: target },
      { cause: error },
    );
  }

  const pack = await readPackFile(target);
  const removed = pack?.locale ?? requested;
  const before = await getLanguageState(paths);
  let settings: SettingsFile | undefined;
  try {
    settings = await readSettingsFile(paths);
  } catch {
    settings = undefined;
  }

  const isCurrent =
    before.current.toLowerCase() === requested.toLowerCase();
  const isSelected =
    settings?.locale?.toLowerCase() === requested.toLowerCase();

  try {
    await rm(target, { force: false });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new SkillinkError(
        'LANGUAGE_PACK_NOT_FOUND',
        `Language pack ${requested} is not installed.`,
        { locale: requested },
      );
    }
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to remove ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { filePath: target },
      { cause: error },
    );
  }

  if (isCurrent || isSelected) {
    await writeSettingsFile(paths, { schemaVersion: 1, locale: 'en' });
  }

  const after = await getLanguageState(paths);

  return { removed, current: after.current };
}

export async function getLanguageState(
  paths: SkillinkPaths,
  options: LanguageStateOptions = {},
): Promise<LanguageState> {
  const packs = await listLanguagePacks(paths);
  const available = packs.map((pack) => pack.locale);

  let settings: SettingsFile | undefined;
  let settingsInvalid = false;
  try {
    settings = await readSettingsFile(paths);
  } catch {
    settings = undefined;
    settingsInvalid = true;
  }

  const env = options.env ?? process.env;
  const requestedEnv = env.SKILLINK_LOCALE?.trim();
  let current = 'en';

  if (requestedEnv) {
    current = matchLocale(requestedEnv, available) ?? 'en';
  } else if (settings?.locale) {
    current = matchLocale(settings.locale, available) ?? 'en';
  } else if (settingsInvalid) {
    current = 'en';
  } else {
    const systemLocale =
      options.systemLocale ??
      Intl.DateTimeFormat().resolvedOptions().locale ??
      undefined;
    if (systemLocale) {
      current = matchLocale(systemLocale, available) ?? 'en';
    }
  }

  let direction: 'ltr' | 'rtl' = 'ltr';
  let messages: MessageCatalog = EN_MESSAGES;

  if (current.toLowerCase() !== 'en') {
    const pack = await readPackFile(packPath(paths, current));
    if (pack) {
      current = pack.locale;
      direction = pack.direction;
      messages = pack.messages;
    } else {
      current = 'en';
    }
  }

  return { current, direction, packs, messages };
}

/** Ensures the locales directory exists, matching the rest of the control plane. */
export async function ensureLocalesDir(paths: SkillinkPaths): Promise<void> {
  await mkdir(paths.localesDir, { recursive: true });
}
