import type { Command } from 'commander';
import {
  addRouteEntry,
  readRouteFile,
  removeRouteEntry,
  setPackageEnabled,
} from '@skillink/core';
import { addCommonOptions, printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';
import { parseSpec } from '../specs.js';

export function registerRouteCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;
  const route = program.command('route').description('Manage target routes');

  route
    .command('add')
    .description('Assign a package version and delete target skills dropped by the change')
    .argument('<target-id>', 'Target id')
    .argument('<package@version>', 'Package name and version/range/tag')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (targetId: string, spec: string, options: { json?: boolean }) => {
        const paths = runtime.paths();
        const parsed = parseSpec(spec);
        const lock = await runtime.mutate(
          paths,
          'route add',
          'add',
          `${targetId} ${spec}`,
          async () => {
            await runtime.ensureHome();
            return addRouteEntry({
              paths,
              targetId,
              name: parsed.name,
              requested: parsed.version,
            });
          },
        );
        if (options.json) {
          printJson(context, lock);
          return;
        }
        context.stdout(
          `Routed ${parsed.name}@${lock.resolved} (${lock.requested}) -> ${targetId}`,
        );
      },
    );

  addCommonOptions(
    route.command('list').description('List route assignments'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await runtime.ensureHome();
    const file = await readRouteFile(paths);

    if (options.json) {
      printJson(context, file);
      return;
    }

    const assignments = file.targets.flatMap((targetEntry) =>
      Object.entries(targetEntry.packages).map(([name, lock]) => ({
        targetId: targetEntry.id,
        name,
        ...lock,
      })),
    );

    if (assignments.length === 0) {
      context.stdout('No routes.');
      return;
    }

    for (const assignment of assignments) {
      context.stdout(
        `${assignment.targetId}  ${assignment.name}@${assignment.resolved}` +
          (assignment.requested ? `  (${assignment.requested})` : ''),
      );
    }
  });

  route
    .command('enable')
    .description('Enable a package assignment on a target')
    .argument('<target-id>', 'Target id')
    .argument('<package>', 'Package name')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (targetId: string, name: string, options: { json?: boolean }) => {
        const paths = runtime.paths();
        const updated = await runtime.mutate(
          paths,
          'route enable',
          'enable',
          `${targetId}/${name}`,
          async () => {
            await runtime.ensureHome();
            return setPackageEnabled(paths, targetId, name, true);
          },
        );
        if (options.json) {
          printJson(context, updated);
          return;
        }
        context.stdout(`Enabled route ${targetId}/${name}`);
      },
    );

  route
    .command('disable')
    .description('Disable a package assignment and delete skills no longer needed')
    .argument('<target-id>', 'Target id')
    .argument('<package>', 'Package name')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (targetId: string, name: string, options: { json?: boolean }) => {
        const paths = runtime.paths();
        const updated = await runtime.mutate(
          paths,
          'route disable',
          'disable',
          `${targetId}/${name}`,
          async () => {
            await runtime.ensureHome();
            return setPackageEnabled(paths, targetId, name, false);
          },
        );
        if (options.json) {
          printJson(context, updated);
          return;
        }
        context.stdout(`Disabled route ${targetId}/${name}`);
      },
    );

  route
    .command('remove')
    .description('Remove a package assignment and delete skills no longer needed')
    .argument('<target-id>', 'Target id')
    .argument('<package>', 'Package name')
    .option('--force', 'Remove even if the remaining graph is invalid')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (
        targetId: string,
        name: string,
        options: { force?: boolean; json?: boolean },
      ) => {
        const paths = runtime.paths();
        const removed = await runtime.mutate(
          paths,
          'route remove',
          'remove',
          `${targetId}/${name}`,
          async () => {
            await runtime.ensureHome();
            return removeRouteEntry({
              paths,
              targetId,
              name,
              force: options.force,
            });
          },
        );
        if (options.json) {
          printJson(context, removed);
          return;
        }
        context.stdout(
          removed ? `Removed route ${targetId}/${name}` : 'No route found.',
        );
      },
    );
}
