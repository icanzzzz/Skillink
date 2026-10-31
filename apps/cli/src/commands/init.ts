import type { Command } from 'commander';
import { ensureDirectories, migrateV1ToV2 } from '@skillink/core';
import { initializeHome } from '../bootstrap.js';
import { printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';

export function registerInitCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;

  program
    .command('init')
    .description('Initialize the Skillink control plane')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = runtime.paths();
      const result = await initializeHome(paths, runtime.argv);

      if (options.json) {
        printJson(context, { ok: true, home: paths.home, ...result });
        return;
      }

      if (!result.migrated) {
        context.stdout(`Initialized ${paths.home}`);
        return;
      }

      context.stdout(
        `Migrated ${result.skillCount} skills, ${result.packageCount} packages, ` +
          `${result.targetCount} targets to ${paths.home}`,
      );
    });

  program
    .command('migrate')
    .description('Migrate v1 skills.json data to skill.json and package.json')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = runtime.paths();
      const result = await runtime.mutate(
        paths,
        'migrate',
        'migrate',
        (migrated: {
          skillCount: number;
          packageCount: number;
          targetCount: number;
        }) =>
          `${migrated.skillCount} skills, ${migrated.packageCount} packages, ` +
          `${migrated.targetCount} targets`,
        async () => {
          await ensureDirectories(paths);
          return migrateV1ToV2(paths);
        },
      );

      if (options.json) {
        printJson(context, { ok: true, home: paths.home, ...result });
        return;
      }

      if (!result.migrated) {
        context.stdout('No v1 skills.json found.');
        return;
      }

      context.stdout(
        `Migrated ${result.skillCount} skills, ${result.packageCount} packages, ` +
          `${result.targetCount} targets.`,
      );
    });
}
