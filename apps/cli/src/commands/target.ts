import type { Command } from 'commander';
import type { TargetMode } from '@skillink/shared';
import {
  addTarget,
  readRouteFile,
  removeTarget,
  setTargetEnabled,
} from '@skillink/core';
import { addCommonOptions, printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';

export function registerTargetCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;
  const target = program
    .command('target')
    .description('Manage target directories');

  target
    .command('add')
    .description('Add a target directory that should contain skill folders')
    .argument('<path>', 'Target directory')
    .option('--id <id>', 'Stable target id')
    .option('--label <label>', 'Display label')
    .option('--mode <mode>', 'Projection mode (v2.0 supports link only)')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (
        targetPath: string,
        options: {
          id?: string;
          label?: string;
          mode?: TargetMode;
          json?: boolean;
        },
      ) => {
        const paths = runtime.paths();
        const created = await runtime.mutate(
          paths,
          'target add',
          'add',
          (result) => result.id,
          async () => {
            await runtime.ensureHome();
            return addTarget({
              paths,
              id: options.id,
              label: options.label,
              path: targetPath,
              mode: options.mode ?? 'link',
            });
          },
        );
        if (options.json) {
          printJson(context, created);
          return;
        }
        context.stdout(`Added target ${created.id} -> ${created.path}`);
      },
    );

  addCommonOptions(
    target.command('list').description('List target directories'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await runtime.ensureHome();
    const route = await readRouteFile(paths);

    if (options.json) {
      printJson(context, route.targets);
      return;
    }

    if (route.targets.length === 0) {
      context.stdout('No targets.');
      return;
    }

    for (const entry of route.targets) {
      context.stdout(
        `${entry.id}  ${entry.path}  ${entry.mode}  ${
          entry.enabled ? 'enabled' : 'disabled'
        }`,
      );
    }
  });

  target
    .command('remove')
    .description(
      'Remove a target from route.json and delete its route-resolved skill directories from the target directory',
    )
    .argument('<id>', 'Target id')
    .option('--json', 'Print machine-readable JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const paths = runtime.paths();
      const removed = await runtime.mutate(
        paths,
        'target remove',
        'remove',
        id,
        async () => {
          await runtime.ensureHome();
          return removeTarget({ paths, id });
        },
      );
      if (options.json) {
        printJson(context, removed);
        return;
      }
      context.stdout(`Removed target ${removed.id}`);
    });

  target
    .command('enable')
    .description('Enable a target')
    .argument('<id>', 'Target id')
    .option('--json', 'Print machine-readable JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const paths = runtime.paths();
      const updated = await runtime.mutate(
        paths,
        'target enable',
        'enable',
        id,
        async () => {
          await runtime.ensureHome();
          return setTargetEnabled(paths, id, true);
        },
      );
      if (options.json) {
        printJson(context, updated);
        return;
      }
      context.stdout(`Enabled target ${id}`);
    });

  target
    .command('disable')
    .description('Disable a target and delete its route-resolved skill directories')
    .argument('<id>', 'Target id')
    .option('--json', 'Print machine-readable JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const paths = runtime.paths();
      const updated = await runtime.mutate(
        paths,
        'target disable',
        'disable',
        id,
        async () => {
          await runtime.ensureHome();
          return setTargetEnabled(paths, id, false);
        },
      );
      if (options.json) {
        printJson(context, updated);
        return;
      }
      context.stdout(`Disabled target ${id}`);
    });
}
