import type { Command } from 'commander';
import {
  getLanguageState,
  installLanguagePack,
  removeLanguagePack,
  setActiveLocale,
} from '@skillink/core';
import { addCommonOptions, printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';

export function registerLocaleCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;
  const locale = program
    .command('locale')
    .description('Manage UI language packs');

  addCommonOptions(
    locale.command('list').description('List installed language packs'),
  ).action(async (options: { json?: boolean }) => {
    const paths = runtime.paths();
    const state = await getLanguageState(paths);

    if (options.json) {
      printJson(context, state);
      return;
    }

    const current = state.packs.find(
      (pack) => pack.locale.toLowerCase() === state.current.toLowerCase(),
    );
    context.stdout(
      `Current language: ${state.current}${
        current ? ` (${current.nativeName})` : ''
      }`,
    );

    for (const pack of state.packs) {
      context.stdout(
        `${pack.locale}  ${pack.nativeName} (${pack.name})  ${pack.version}  ` +
          `${Math.round(pack.coverage * 100)}%${pack.builtIn ? '  built-in' : ''}`,
      );
    }
  });

  addCommonOptions(
    locale
      .command('install')
      .description('Install a language pack from a local JSON file')
      .argument('<file>', 'Language pack JSON file')
      .option('--use', 'Select the language after installing')
      .option('--force', 'Replace an already installed language pack'),
  ).action(
    async (
      file: string,
      options: { use?: boolean; force?: boolean; json?: boolean },
    ) => {
      const paths = runtime.paths();
      const report = await runtime.mutate(
        paths,
        'locale install',
        'install',
        (result) => `${result.pack.locale} ${result.pack.version}`,
        () =>
          installLanguagePack(paths, {
            sourcePath: file,
            use: options.use,
            force: options.force,
          }),
      );

      if (options.json) {
        printJson(context, report);
        return;
      }

      context.stdout(
        `Installed ${report.pack.name} (${report.pack.locale}) ` +
          `${report.pack.version} - ${Math.round(report.pack.coverage * 100)}% ` +
          `translated, ${report.missingKeys.length} missing keys`,
      );
    },
  );

  addCommonOptions(
    locale
      .command('use')
      .description('Select an installed language')
      .argument('<locale>', 'Locale tag, for example zh-CN'),
  ).action(async (localeName: string, options: { json?: boolean }) => {
    const paths = runtime.paths();
    await runtime.mutate(
      paths,
      'locale use',
      'use',
      localeName,
      () => setActiveLocale(paths, localeName),
      { commit: false },
    );
    const state = await getLanguageState(paths, { env: {} });

    if (options.json) {
      printJson(context, { ok: true, current: state.current });
      return;
    }

    context.stdout(`Current language: ${state.current}`);
  });

  addCommonOptions(
    locale
      .command('remove')
      .description('Remove an installed language pack')
      .argument('<locale>', 'Locale tag, for example zh-CN'),
  ).action(async (localeName: string, options: { json?: boolean }) => {
    const paths = runtime.paths();
    const result = await runtime.mutate(
      paths,
      'locale remove',
      'remove',
      (removed: { removed: string }) => removed.removed,
      () => removeLanguagePack(paths, localeName),
    );

    if (options.json) {
      printJson(context, { ok: true, ...result });
      return;
    }

    context.stdout(
      `Removed ${result.removed}. Current language: ${result.current}`,
    );
  });
}
