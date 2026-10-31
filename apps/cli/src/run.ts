import { Command, CommanderError } from 'commander';
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
  checkPackageSkillReferences,
  copyPackageVersion,
  createPackageVersion,
  doctor,
  ensureDirectories,
  ensureHome,
  gc,
  getLanguageState,
  gitLog,
  importSkill,
  installLanguagePack,
  isGitAvailable,
  migrateV1ToV2,
  readPackageFile,
  readRouteFile,
  readSkillFile,
  removeLanguagePack,
  removePackageVersion,
  removeRouteEntry,
  removeSkillVersion,
  removeTarget,
  rollbackTo,
  scanSkillPackages,
  setActiveLocale,
  setPackageEnabled,
  setPackageTag,
  setSkillTag,
  setTargetEnabled,
  status,
  summarizeTargetSkills,
  writePackageFile,
  writeRouteFile,
  writeSkillFile,
} from '@skillink/core';
import { withCliMutation } from './mutation.js';
import { initializeHome } from './bootstrap.js';
import {
  addCommonOptions,
  printJson,
  printJsonError,
  type CliContext,
} from './cli-context.js';
import { createCommandRuntime } from './command-runtime.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerPackageCommands } from './commands/package.js';
import { parseSpec } from './specs.js';

export type { CliContext } from './cli-context.js';

export async function runCli(
  argv: string[],
  context: CliContext = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
): Promise<number> {
  let exitCode = 0;
  const jsonMode = context.json ?? argv.includes('--json');
  const program = new Command();

  program
    .name('skillink')
    .description('Local skill and package manager')
    .version('0.0.0', '-V, --app-version', 'Show the CLI version')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => context.stdout(value.replace(/\n$/, '')),
      writeErr: (value) => {
        if (!jsonMode) {
          context.stderr(value.replace(/\n$/, ''));
        }
      },
    });

  type Paths = ReturnType<typeof getSkillinkPaths>;
  const mutate = <T>(
    paths: Paths,
    commandPath: string,
    action: string,
    summary: string | ((result: T) => string),
    task: () => Promise<T>,
    options: { skills?: boolean; commit?: boolean } = {},
  ): Promise<T> =>
    withCliMutation(
      { paths, commandPath, argv, action, summary, ...options },
      task,
    );

  program
    .command('init')
    .description('Initialize the Skillink control plane')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = getSkillinkPaths(context.home);
      const result = await initializeHome(paths, argv);

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
    .command('env')
    .description('Show runtime environment capabilities')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const gitAvailable = await isGitAvailable();

      if (options.json) {
        printJson(context, { gitAvailable });
        return;
      }

      context.stdout(`git: ${gitAvailable ? 'available' : 'unavailable'}`);
    });

  const locale = program
    .command('locale')
    .description('Manage UI language packs');

  addCommonOptions(
    locale.command('list').description('List installed language packs'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
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
      const paths = getSkillinkPaths(context.home);
      const report = await mutate(
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
    const paths = getSkillinkPaths(context.home);
    await mutate(
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
    const paths = getSkillinkPaths(context.home);
    const result = await mutate(
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

  program
    .command('migrate')
    .description('Migrate v1 skills.json data to skill.json and package.json')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = getSkillinkPaths(context.home);
      const result = await mutate(
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

  program
    .command('snapshot')
    .description(
      'Print one read-only snapshot of config, health, and target skills',
    )
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = getSkillinkPaths(context.home);
      const [
        skills,
        packages,
        route,
        statusReport,
        doctorReport,
        targetSkills,
      ] = await Promise.all([
        readSkillFile(paths),
        readPackageFile(paths),
        readRouteFile(paths),
        status({ paths }),
        doctor({ paths }),
        summarizeTargetSkills({ paths }),
      ]);

      const snapshot = {
        home: paths.home,
        skills,
        packages,
        route,
        status: statusReport,
        doctor: doctorReport,
        targetSkills,
      };

      if (options.json) {
        printJson(context, snapshot);
        return;
      }

      context.stdout(paths.home);
      context.stdout(
        `${Object.keys(skills.skills).length} skills, ` +
          `${Object.keys(packages.packages).length} packages, ` +
          `${route.targets.length} targets`,
      );
      context.stdout(statusReport.healthy ? 'healthy' : 'unhealthy');
    });

  const runtime = createCommandRuntime(context, argv, (code) => {
    exitCode = code;
  });
  registerSkillCommands(program, runtime);
  registerPackageCommands(program, runtime);

  const target = program
    .command('target')
    .description('Manage target directories');

  target
    .command('add')
    .description('Add a target directory that should contain skill folders')
    .argument('<path>', 'Target directory')
    .option('--id <id>', 'Stable target id')
    .option('--label <label>', 'Display label')
    .option('--mode <mode>', 'Projection mode: link or copy')
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
        const paths = getSkillinkPaths(context.home);
        const created = await mutate(
          paths,
          'target add',
          'add',
          (result) => result.id,
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
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
    const paths = getSkillinkPaths(context.home);
    await ensureHome(paths);
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
      const paths = getSkillinkPaths(context.home);
      const removed = await mutate(
        paths,
        'target remove',
        'remove',
        id,
        async () => {
          await ensureHome(getSkillinkPaths(context.home));
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
      const paths = getSkillinkPaths(context.home);
      const updated = await mutate(
        paths,
        'target enable',
        'enable',
        id,
        async () => {
          await ensureHome(getSkillinkPaths(context.home));
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
      const paths = getSkillinkPaths(context.home);
      const updated = await mutate(
        paths,
        'target disable',
        'disable',
        id,
        async () => {
          await ensureHome(getSkillinkPaths(context.home));
          return setTargetEnabled(paths, id, false);
        },
      );
      if (options.json) {
        printJson(context, updated);
        return;
      }
      context.stdout(`Disabled target ${id}`);
    });

  const route = program.command('route').description('Manage target routes');

  route
    .command('add')
    .description('Assign a package version and delete target skills dropped by the change')
    .argument('<target-id>', 'Target id')
    .argument('<package@version>', 'Package name and version/range/tag')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (targetId: string, spec: string, options: { json?: boolean }) => {
        const paths = getSkillinkPaths(context.home);
        const parsed = parseSpec(spec);
        const lock = await mutate(
          paths,
          'route add',
          'add',
          `${targetId} ${spec}`,
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
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
    const paths = getSkillinkPaths(context.home);
    await ensureHome(paths);
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
        const paths = getSkillinkPaths(context.home);
        const updated = await mutate(
          paths,
          'route enable',
          'enable',
          `${targetId}/${name}`,
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
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
        const paths = getSkillinkPaths(context.home);
        const updated = await mutate(
          paths,
          'route disable',
          'disable',
          `${targetId}/${name}`,
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
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
        const paths = getSkillinkPaths(context.home);
        const removed = await mutate(
          paths,
          'route remove',
          'remove',
          `${targetId}/${name}`,
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
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

  program
    .command('gc')
    .description('Remove unreferenced skill versions (dry-run by default)')
    .option('--apply', 'Delete candidate versions')
    .option('--max-age-days <days>', 'Only collect versions older than this')
    .option('--no-keep-tagged', 'Allow tagged versions to be collected')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (options: {
        apply?: boolean;
        maxAgeDays?: string;
        keepTagged?: boolean;
        json?: boolean;
      }) => {
        const paths = getSkillinkPaths(context.home);
        const report = await mutate(
          paths,
          'gc',
          'remove',
          (result) =>
            `${result.removed.length} unreferenced skill version${
              result.removed.length === 1 ? '' : 's'
            }`,
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
            const maxAgeDays =
              options.maxAgeDays === undefined
                ? undefined
                : Number(options.maxAgeDays);

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

            return gc(paths, {
              dryRun: !options.apply,
              maxAgeDays,
              keepTagged: options.keepTagged,
            });
          },
          { skills: true, commit: options.apply === true },
        );

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
        context.stdout(
          `${report.freedBytes} bytes ${
            report.dryRun ? 'reclaimable' : 'reclaimed'
          }`,
        );
      },
    );

  program
    .command('apply')
    .description('Reconcile route.json into target directories')
    .option('--target <id>', 'Only apply one target')
    .option('--dry-run', 'Show the plan without changing the filesystem')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (options: {
        target?: string;
        dryRun?: boolean;
        json?: boolean;
      }) => {
        const paths = getSkillinkPaths(context.home);
        const report = await mutate(
          paths,
          'apply',
          'apply',
          '',
          async () => {
            await ensureHome(getSkillinkPaths(context.home));
            return apply({
              paths,
              targetId: options.target,
              dryRun: options.dryRun,
            });
          },
          { commit: false },
        );

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
      .command('history')
      .description('List control plane git commits'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const entries = await gitLog(paths, 'control');

    if (options.json) {
      printJson(context, entries);
      return;
    }

    if (entries.length === 0) {
      context.stdout('No history.');
      return;
    }

    for (const entry of entries) {
      context.stdout(
        `${entry.id.slice(0, 7)}  ${entry.createdAt}  ${entry.reason}`,
      );
    }
  });

  program
    .command('rollback')
    .description(
      'Restore the control plane to a commit and re-apply target projections',
    )
    .argument('<revision>', 'Commit hash or revision')
    .option('--no-apply', 'Restore configuration without re-applying targets')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (
        revision: string,
        options: { apply?: boolean; json?: boolean },
      ) => {
        const paths = getSkillinkPaths(context.home);

        if (!(await isGitAvailable())) {
          throw new SkillinkError(
            'GIT_UNAVAILABLE',
            'Rolling back requires git on PATH.',
            { home: paths.home },
          );
        }

        const result = await rollbackTo({
          paths,
          revision,
          apply: options.apply !== false,
          argv,
        });

        if (options.json) {
          printJson(context, { ok: true, ...result });
          return;
        }

        context.stdout(
          `Restored ${result.revision.slice(0, 7)} ` +
            `(${result.removedTargets.length} target${
              result.removedTargets.length === 1 ? '' : 's'
            } cleaned)`,
        );
        if (result.restoredSkills.length > 0) {
          context.stdout(
            `Restored skill content: ${result.restoredSkills
              .map((skill) => `${skill.name}@${skill.version}`)
              .join(', ')}`,
          );
        }
        if (options.apply === false) {
          context.stdout('Configuration restored; targets were not re-applied.');
        } else if (result.apply) {
          context.stdout(
            `${result.apply.operations.length} apply operation${
              result.apply.operations.length === 1 ? '' : 's'
            }`,
          );
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
    await ensureHome(paths);
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
    program
      .command('doctor')
      .description('Check skills, packages, routes, and targets'),
  ).action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    await ensureHome(paths);
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
      if (jsonMode) {
        printJsonError(context, 'CLI_USAGE', error.message);
      }
      return error.exitCode || 1;
    }

    if (isSkillinkError(error)) {
      if (jsonMode) {
        printJsonError(context, error.code, error.message, error.details);
      } else {
        context.stderr(`error [${error.code}]: ${error.message}`);
      }
      return error.code === 'UNMANAGED_CONFLICT' ? 3 : 1;
    }

    if (jsonMode) {
      printJsonError(
        context,
        'CLI_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    } else {
      context.stderr(error instanceof Error ? error.message : String(error));
    }
    return 1;
  }
}
