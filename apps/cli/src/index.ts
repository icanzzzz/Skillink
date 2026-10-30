import { Command, CommanderError } from 'commander';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SkillinkError,
  getSkillinkPaths,
  isSkillinkError,
  type TargetMode,
} from '@skillink/shared';
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
  removeTarget,
  restoreHistorySnapshot,
  setLibraryTag,
  status,
  writeRouteFile,
  writeSkillsFile,
} from '@skillink/core';

export interface CliContext {
  home?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
}

function printJson(context: CliContext, value: unknown): void {
  context.stdout(JSON.stringify(value, null, 2));
}

function parsePackageSpec(spec: string): { name: string; requested: string } {
  const separator = spec.lastIndexOf('@');
  if (separator <= 0 || separator === spec.length - 1) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      'Invalid package spec; expected package@version.',
      { spec },
    );
  }

  return {
    name: spec.slice(0, separator),
    requested: spec.slice(separator + 1),
  };
}

async function ensureHome(home?: string) {
  const paths = getSkillinkPaths(home);
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.libraryDir, { recursive: true }),
    mkdir(paths.historyDir, { recursive: true }),
    mkdir(paths.cacheDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.trashDir, { recursive: true }),
    mkdir(paths.tmpDir, { recursive: true }),
  ]);

  const route = await readRouteFile(paths);
  const skills = await readSkillsFile(paths);
  await writeRouteFile(paths, route);
  await writeSkillsFile(paths, skills);

  return paths;
}

function addCommonOptions(command: Command): Command {
  return command.option('--json', 'Print machine-readable JSON');
}

export async function runCli(
  argv: string[],
  context: CliContext = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
): Promise<number> {
  let exitCode = 0;
  const program = new Command();

  program
    .name('skillink')
    .description('Local folder package manager with pnpm-style versioning')
    .version('0.0.0', '-V, --app-version', 'Show the CLI version')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => context.stdout(value.replace(/\n$/, '')),
      writeErr: (value) => context.stderr(value.replace(/\n$/, '')),
    });

  program
    .command('init')
    .description('Initialize the Skillink control plane')
    .action(async () => {
      const paths = await ensureHome(context.home);
      context.stdout(`Initialized ${paths.home}`);
    });

  const library = program.command('library').description('Manage the public library');

  addCommonOptions(
    library
      .command('list')
      .alias('ls')
      .description('List packages and versions in the public library'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const file = await readSkillsFile(paths);

    if (options.json) {
      printJson(context, file);
      return;
    }

    const packages = Object.entries(file.packages);
    if (packages.length === 0) {
      context.stdout('No packages.');
      return;
    }

    for (const [name, entry] of packages) {
      context.stdout(`${name} (${entry.kind})`);
      for (const [version, info] of Object.entries(entry.versions)) {
        context.stdout(
          `  ${version}  ${info.fileCount} files, ${info.size} bytes  ${info.source}`,
        );
      }
    }
  });

  library
    .command('tag')
    .description('Tag a library version, for example latest or stable')
    .argument('<package@version>', 'Package name and exact version')
    .argument('<tag>', 'Tag name')
    .action(async (spec: string, tag: string) => {
      const paths = getSkillinkPaths(context.home);
      const parsed = parsePackageSpec(spec);
      await setLibraryTag(paths, parsed.name, parsed.requested, tag);
      context.stdout(`Tagged ${parsed.name}@${parsed.requested} as ${tag}`);
    });

  library
    .command('remove')
    .description('Move an unreferenced library version to trash')
    .argument('<package@version>', 'Package name and exact version')
    .action(async (spec: string) => {
      const paths = getSkillinkPaths(context.home);
      const parsed = parsePackageSpec(spec);
      await removeLibraryVersion(paths, parsed.name, parsed.requested);
      context.stdout(`Removed ${parsed.name}@${parsed.requested}`);
    });

  const addCommand = program
    .command('add')
    .description('Import a local folder into the public library')
    .argument('<folder>', 'Folder to import')
    .option('--name <name>', 'Package name (default: folder name)')
    .option('--version <version>', 'Package version (default: 0.0.0+hash)');

  addCommand.action(
    async (folder: string, options: { name?: string; version?: string }) => {
      const result = await importFolder({
        sourceDir: folder,
        name: options.name,
        version: options.version,
        home: context.home,
      });

      context.stdout(
        `${result.created ? 'Imported' : 'Already present'} ${result.name}@${result.version} ` +
          `(${result.fileCount} files, ${result.size} bytes)`,
      );
    },
  );

  const target = program.command('target').description('Manage target directories');

  target
    .command('add')
    .description('Add a target directory')
    .argument('<path>', 'Directory containing package folders')
    .option('--id <id>', 'Stable target id')
    .option('--label <label>', 'Display label')
    .option('--mode <mode>', 'link or copy', 'link')
    .action(
      async (
        targetPath: string,
        options: { id?: string; label?: string; mode: string },
      ) => {
        const paths = getSkillinkPaths(context.home);
        const created = await addTarget({
          paths,
          id: options.id,
          label: options.label,
          path: targetPath,
          mode: options.mode as TargetMode,
        });
        context.stdout(`Added target ${created.id} -> ${created.path}`);
      },
    );

  addCommonOptions(
    target.command('list').description('List target directories'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
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
    .description('Remove a target from route.json')
    .argument('<id>', 'Target id')
    .action(async (id: string) => {
      const paths = getSkillinkPaths(context.home);
      const removed = await removeTarget({ paths, id });
      context.stdout(`Removed target ${removed.id}`);
    });

  const route = program.command('route').description('Manage target routes');

  route
    .command('add')
    .description('Assign a package version to a target')
    .argument('<target-id>', 'Target id')
    .argument('<package@version>', 'Package name and version/range')
    .action(async (targetId: string, spec: string) => {
      const paths = getSkillinkPaths(context.home);
      const parsed = parsePackageSpec(spec);
      const lock = await addRouteEntry({
        paths,
        targetId,
        name: parsed.name,
        requested: parsed.requested,
      });
      context.stdout(
        `Routed ${parsed.name}@${lock.resolved} (${lock.requested}) -> ${targetId}`,
      );
    });

  addCommonOptions(
    route.command('list').description('List route assignments'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const file = await readRouteFile(paths);

    if (options.json) {
      printJson(context, file);
      return;
    }

    const assignments = file.targets.flatMap((targetEntry) =>
      Object.entries(targetEntry.skills).map(([name, lock]) => ({
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
        `${assignment.targetId}  ${assignment.name}@${assignment.resolved}  ${assignment.source}`,
      );
    }
  });

  route
    .command('remove')
    .description('Remove a package assignment from a target')
    .argument('<target-id>', 'Target id')
    .argument('<package>', 'Package name')
    .action(async (targetId: string, name: string) => {
      const paths = getSkillinkPaths(context.home);
      const removed = await removeRouteEntry({ paths, targetId, name });
      context.stdout(removed ? `Removed route ${targetId}/${name}` : 'No route found.');
    });

  program
    .command('gc')
    .description('Remove unreferenced library versions (dry-run by default)')
    .option('--apply', 'Move candidates to trash')
    .option('--max-age-days <days>', 'Only collect versions older than this many days')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (options: { apply?: boolean; maxAgeDays?: string; json?: boolean }) => {
        const paths = getSkillinkPaths(context.home);
        const maxAgeDays =
          options.maxAgeDays === undefined ? undefined : Number(options.maxAgeDays);

        if (
          maxAgeDays !== undefined &&
          (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)
        ) {
          throw new SkillinkError(
            'ROUTE_INVALID',
            'max-age-days must be a non-negative number.',
            { maxAgeDays: options.maxAgeDays },
          );
        }

        const report = await gc(paths, {
          dryRun: !options.apply,
          maxAgeDays,
        });

        if (options.json) {
          printJson(context, report);
          return;
        }

        if (report.candidates.length === 0) {
          context.stdout('No candidates.');
          return;
        }

        for (const candidate of report.candidates) {
          context.stdout(
            `${report.dryRun ? '[dry-run] ' : 'removed  '}${candidate.name}@${candidate.version}  ${candidate.path}`,
          );
        }
        context.stdout(`${report.freedBytes} bytes ${report.dryRun ? 'reclaimable' : 'reclaimed'}`);
      },
    );

  addCommonOptions(
    program.command('history').description('List route/library history snapshots'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const entries = await listHistory(paths);

    if (options.json) {
      printJson(context, entries);
      return;
    }

    if (entries.length === 0) {
      context.stdout('No history.');
      return;
    }

    for (const entry of entries) {
      context.stdout(`${entry.id}  ${entry.createdAt}  ${entry.reason}`);
    }
  });

  program
    .command('rollback')
    .description('Restore route.json and skills.json from a history snapshot')
    .argument('<snapshot-id>', 'History snapshot id')
    .option('--apply', 'Apply routes after restoring the snapshot')
    .option('--json', 'Print machine-readable JSON')
    .action(async (snapshotId: string, options: { apply?: boolean; json?: boolean }) => {
      const paths = getSkillinkPaths(context.home);
      await restoreHistorySnapshot(paths, snapshotId);
      const report = options.apply ? await apply({ paths }) : undefined;

      if (options.json) {
        printJson(context, { snapshotId, report });
      } else {
        context.stdout(`Restored history snapshot ${snapshotId}`);
        for (const operation of report?.operations ?? []) {
          context.stdout(
            `${operation.kind}  ${operation.name ?? operation.targetId}  ${operation.path}`,
          );
        }
        for (const conflict of report?.conflicts ?? []) {
          context.stderr(`conflict  ${conflict.name}  ${conflict.reason}`);
        }
      }

      if (report && report.conflicts.length > 0) {
        exitCode = 3;
      }
    });

  program
    .command('apply')
    .description('Reconcile route.json into target directories')
    .option('--target <id>', 'Only apply one target')
    .option('--dry-run', 'Show the plan without changing the filesystem')
    .option('--prune', 'Remove managed links no longer in route.json')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (options: {
        target?: string;
        dryRun?: boolean;
        prune?: boolean;
        json?: boolean;
      }) => {
        const paths = getSkillinkPaths(context.home);
        const report = await apply({
          paths,
          targetId: options.target,
          dryRun: options.dryRun,
          prune: options.prune,
        });

        if (options.json) {
          printJson(context, report);
        } else {
          if (report.operations.length === 0 && report.conflicts.length === 0) {
            context.stdout('Nothing to do.');
          }
          for (const operation of report.operations) {
            context.stdout(
              `${report.dryRun ? '[dry-run] ' : ''}${operation.kind}  ${
                operation.name ?? operation.targetId
              }  ${operation.path}`,
            );
          }
          for (const conflict of report.conflicts) {
            context.stderr(`conflict  ${conflict.name}  ${conflict.reason}`);
          }
        }

        if (report.conflicts.length > 0) {
          exitCode = 3;
        }
      },
    );

  addCommonOptions(
    program
      .command('status')
      .description('Show target/link status')
      .option('--target <id>', 'Only inspect one target'),
  ).action(async (options: { target?: string; json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const report = await status({ paths, targetId: options.target });

    if (options.json) {
      printJson(context, report);
    } else {
      if (report.entries.length === 0) {
        context.stdout('No routes.');
      }
      for (const entry of report.entries) {
        context.stdout(
          `${entry.state}  ${entry.targetId}/${entry.name}@${entry.version}`,
        );
      }
      context.stdout(report.healthy ? 'healthy' : 'unhealthy');
    }

    if (!report.healthy) {
      exitCode = 1;
    }
  });

  addCommonOptions(
    program.command('doctor').description('Check library, route, and target health'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const report = await doctor({ paths });

    if (options.json) {
      printJson(context, report);
    } else if (report.issues.length === 0) {
      context.stdout('healthy');
    } else {
      for (const issue of report.issues) {
        context.stdout(`${issue.code}  ${issue.message}`);
      }
    }

    if (!report.ok) {
      exitCode = 1;
    }
  });

  try {
    await program.parseAsync(['node', 'skillink', ...argv]);
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.version'
      ) {
        return 0;
      }
      return error.exitCode || 1;
    }

    if (isSkillinkError(error)) {
      context.stderr(`error [${error.code}]: ${error.message}`);
      return error.code === 'UNMANAGED_CONFLICT' ? 3 : 1;
    }

    context.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryFile === path.resolve(currentFile)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
