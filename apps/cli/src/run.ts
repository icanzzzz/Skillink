import { Command, CommanderError } from 'commander';
import { mkdir, stat } from 'node:fs/promises';
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
  copyPackageVersion,
  createPackageVersion,
  doctor,
  gc,
  importSkill,
  listHistory,
  migrateV1ToV2,
  readPackageFile,
  readRouteFile,
  readSkillFile,
  removePackageVersion,
  removeRouteEntry,
  removeSkillVersion,
  removeTarget,
  restoreHistorySnapshot,
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

export interface CliContext {
  home?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
}

function printJson(context: CliContext, value: unknown): void {
  context.stdout(JSON.stringify(value, null, 2));
}

function printJsonError(
  context: CliContext,
  code: string,
  message: string,
  details?: unknown,
): void {
  context.stderr(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    }),
  );
}

function parseSpec(spec: string): { name: string; version: string } {
  const separator = spec.lastIndexOf('@');
  if (separator <= 0 || separator === spec.length - 1) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      'Invalid spec; expected name@version.',
      { spec },
    );
  }

  return {
    name: spec.slice(0, separator),
    version: spec.slice(separator + 1),
  };
}

function asArray(value: string[] | string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collectSpecs(
  specs: string[] | string | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const spec of asArray(specs)) {
    const parsed = parseSpec(spec);
    result[parsed.name] = parsed.version;
  }

  return result;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return false;
      }
      throw error;
    });
}

async function ensureDirectories(paths: ReturnType<typeof getSkillinkPaths>) {
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.libraryDir, { recursive: true }),
    mkdir(paths.historyDir, { recursive: true }),
    mkdir(paths.cacheDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.trashDir, { recursive: true }),
    mkdir(paths.tmpDir, { recursive: true }),
  ]);
}

async function writeInitialFiles(
  paths: ReturnType<typeof getSkillinkPaths>,
): Promise<void> {
  await writeRouteFile(paths, await readRouteFile(paths));
  await writePackageFile(paths, await readPackageFile(paths));
  await writeSkillFile(paths, await readSkillFile(paths));
}

async function ensureHome(home?: string) {
  const paths = getSkillinkPaths(home);
  await ensureDirectories(paths);

  if (
    (await pathExists(paths.skillsFile)) &&
    !(await pathExists(paths.skillFile))
  ) {
    throw new SkillinkError(
      'IO_ERROR',
      'Found v1 skills.json. Run "skillink init" or "skillink migrate" first.',
      { home: paths.home },
    );
  }

  await writeInitialFiles(paths);
  return paths;
}

async function runSkillAdd(
  folder: string,
  options: { name?: string; version?: string; json?: boolean },
  context: CliContext,
): Promise<void> {
  const result = await importSkill({
    sourceDir: folder,
    name: options.name,
    version: options.version,
    home: context.home,
  });

  if (options.json) {
    printJson(context, result);
    return;
  }

  context.stdout(
    `${result.created ? 'Imported' : 'Already present'} ${result.name}@${result.version} ` +
      `(${result.fileCount} files, ${result.size} bytes)`,
  );
}

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

  program
    .command('init')
    .description('Initialize the Skillink control plane')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = getSkillinkPaths(context.home);
      await ensureDirectories(paths);

      if (await pathExists(paths.skillsFile)) {
        if (await pathExists(paths.skillFile)) {
          await writeInitialFiles(paths);
          if (options.json) {
            printJson(context, {
              ok: true,
              home: paths.home,
              migrated: false,
            });
            return;
          }
          context.stdout(`Initialized ${paths.home}`);
          return;
        }

        const result = await migrateV1ToV2(paths);
        if (options.json) {
          printJson(context, { ok: true, home: paths.home, ...result });
          return;
        }
        context.stdout(
          `Migrated ${result.skillCount} skills, ${result.packageCount} packages, ` +
            `${result.targetCount} targets to ${paths.home}`,
        );
        return;
      }

      await writeInitialFiles(paths);
      if (options.json) {
        printJson(context, { ok: true, home: paths.home, migrated: false });
        return;
      }
      context.stdout(`Initialized ${paths.home}`);
    });

  program
    .command('migrate')
    .description('Migrate v1 skills.json data to skill.json and package.json')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = getSkillinkPaths(context.home);
      await ensureDirectories(paths);
      const result = await migrateV1ToV2(paths);

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
      'Print one read-only snapshot of config, health, target skills, and history',
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
        history,
      ] = await Promise.all([
        readSkillFile(paths),
        readPackageFile(paths),
        readRouteFile(paths),
        status({ paths }),
        doctor({ paths }),
        summarizeTargetSkills({ paths }),
        listHistory(paths),
      ]);

      const snapshot = {
        home: paths.home,
        skills,
        packages,
        route,
        status: statusReport,
        doctor: doctorReport,
        targetSkills,
        history,
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

  const skill = program.command('skill').description('Manage installed skills');

  addCommonOptions(
    skill
      .command('list')
      .alias('ls')
      .description('List skills and versions in skill.json'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await ensureHome(context.home);
    const file = await readSkillFile(paths);

    if (options.json) {
      printJson(context, file);
      return;
    }

    const entries = Object.entries(file.skills);
    if (entries.length === 0) {
      context.stdout('No skills.');
      return;
    }

    for (const [name, entry] of entries) {
      context.stdout(name);
      for (const [version, info] of Object.entries(entry.versions)) {
        context.stdout(
          `  ${version}  ${info.fileCount} files, ${info.size} bytes`,
        );
      }
    }
  });

  const skillAdd = addCommonOptions(
    skill
      .command('add')
      .description('Import a local skill folder; it must contain SKILL.md')
      .argument('<folder>', 'Skill folder')
      .option('--name <name>', 'Skill name (default: folder name)')
      .option('--version <version>', 'Skill version (default: 0.0.0+hash)'),
  );

  skillAdd.action(
    async (
      folder: string,
      options: { name?: string; version?: string; json?: boolean },
    ) => {
      await ensureHome(context.home);
      await runSkillAdd(folder, options, context);
    },
  );

  addCommonOptions(
    program
      .command('add')
      .description('Alias for "skill add"')
      .argument('<folder>', 'Skill folder')
      .option('--name <name>', 'Skill name (default: folder name)')
      .option('--version <version>', 'Skill version (default: 0.0.0+hash)'),
  ).action(
    async (
      folder: string,
      options: { name?: string; version?: string; json?: boolean },
    ) => {
      await ensureHome(context.home);
      await runSkillAdd(folder, options, context);
    },
  );

  addCommonOptions(
    skill
      .command('tag')
      .description('Tag a skill version, for example latest or stable')
      .argument('<skill@version>', 'Skill name and exact version')
      .argument('<tag>', 'Tag name'),
  ).action(async (spec: string, tag: string, options: { json?: boolean }) => {
    const paths = await ensureHome(context.home);
    const parsed = parseSpec(spec);
    await setSkillTag(paths, parsed.name, parsed.version, tag);
    if (options.json) {
      printJson(context, { ok: true });
      return;
    }
    context.stdout(`Tagged ${parsed.name}@${parsed.version} as ${tag}`);
  });

  addCommonOptions(
    skill
      .command('remove')
      .description('Move an unreferenced skill version to trash')
      .argument('<skill@version>', 'Skill name and exact version'),
  ).action(async (spec: string, options: { json?: boolean }) => {
    const paths = await ensureHome(context.home);
    const parsed = parseSpec(spec);
    await removeSkillVersion(paths, parsed.name, parsed.version);
    if (options.json) {
      printJson(context, { ok: true });
      return;
    }
    context.stdout(`Removed ${parsed.name}@${parsed.version}`);
  });

  const packageCommand = program
    .command('package')
    .description('Manage package compositions');

  addCommonOptions(
    packageCommand
      .command('list')
      .alias('ls')
      .description('List package compositions'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await ensureHome(context.home);
    const file = await readPackageFile(paths);

    if (options.json) {
      printJson(context, file);
      return;
    }

    const entries = Object.entries(file.packages);
    if (entries.length === 0) {
      context.stdout('No packages.');
      return;
    }

    for (const [name, entry] of entries) {
      context.stdout(name);
      for (const [tag, version] of Object.entries(entry.tags ?? {})) {
        context.stdout(`  ${tag} -> ${version}`);
      }
      for (const [version, value] of Object.entries(entry.versions)) {
        const parts: string[] = [];
        if (Object.keys(value.skills).length > 0) {
          parts.push(
            `skills: ${Object.entries(value.skills)
              .map(([skillName, skillVersion]) => `${skillName}@${skillVersion}`)
              .join(', ')}`,
          );
        }
        if (Object.keys(value.packages).length > 0) {
          parts.push(
            `packages: ${Object.entries(value.packages)
              .map(
                ([packageName, packageVersion]) =>
                  `${packageName}@${packageVersion}`,
              )
              .join(', ')}`,
          );
        }
        context.stdout(`  ${version}  ${parts.join('; ')}`);
      }
    }
  });

  packageCommand
    .command('create')
    .description('Create a package version from skills and/or packages')
    .argument('<name@version>', 'Package name and version')
    .option('--skill <spec...>', 'Skill dependency as skill@version')
    .option('--package <spec...>', 'Package dependency as package@version')
    .option('--description <text>', 'Display description')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (
        spec: string,
        options: {
          skill?: string[] | string;
          package?: string[] | string;
          description?: string;
          json?: boolean;
        },
      ) => {
        const paths = await ensureHome(context.home);
        const parsed = parseSpec(spec);
        const created = await createPackageVersion({
          paths,
          name: parsed.name,
          version: parsed.version,
          description: options.description,
          skills: collectSpecs(options.skill),
          packages: collectSpecs(options.package),
        });
        if (options.json) {
          printJson(context, created);
          return;
        }
        context.stdout(`Created ${parsed.name}@${parsed.version}`);
      },
    );

  packageCommand
    .command('copy')
    .description('Copy a package version, optionally overriding dependencies')
    .argument('<source@version>', 'Source package and version')
    .argument('<target@version>', 'Target package and version')
    .option('--skill <spec...>', 'Override or add a skill dependency')
    .option('--package <spec...>', 'Override or add a package dependency')
    .option('--drop-skill <name...>', 'Drop a direct skill dependency')
    .option('--drop-package <name...>', 'Drop a direct package dependency')
    .option('--description <text>', 'Display description')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (
        sourceSpec: string,
        targetSpec: string,
        options: {
          skill?: string[] | string;
          package?: string[] | string;
          dropSkill?: string[] | string;
          dropPackage?: string[] | string;
          description?: string;
          json?: boolean;
        },
      ) => {
        const paths = await ensureHome(context.home);
        const source = parseSpec(sourceSpec);
        const target = parseSpec(targetSpec);
        const created = await copyPackageVersion({
          paths,
          sourceName: source.name,
          sourceVersion: source.version,
          targetName: target.name,
          targetVersion: target.version,
          description: options.description,
          skillOverrides: collectSpecs(options.skill),
          packageOverrides: collectSpecs(options.package),
          dropSkills: asArray(options.dropSkill),
          dropPackages: asArray(options.dropPackage),
        });
        if (options.json) {
          printJson(context, created);
          return;
        }
        context.stdout(`Copied ${sourceSpec} -> ${targetSpec}`);
      },
    );

  packageCommand
    .command('tag')
    .description('Tag a package version')
    .argument('<package@version>', 'Package name and exact version')
    .argument('<tag>', 'Tag name')
    .option('--json', 'Print machine-readable JSON')
    .action(async (spec: string, tag: string, options: { json?: boolean }) => {
      const paths = await ensureHome(context.home);
      const parsed = parseSpec(spec);
      await setPackageTag(paths, parsed.name, parsed.version, tag);
      if (options.json) {
        printJson(context, { ok: true });
        return;
      }
      context.stdout(`Tagged ${parsed.name}@${parsed.version} as ${tag}`);
    });

  packageCommand
    .command('remove')
    .description('Remove an unreferenced package version')
    .argument('<package@version>', 'Package name and exact version')
    .option('--json', 'Print machine-readable JSON')
    .action(async (spec: string, options: { json?: boolean }) => {
      const paths = await ensureHome(context.home);
      const parsed = parseSpec(spec);
      await removePackageVersion(paths, parsed.name, parsed.version);
      if (options.json) {
        printJson(context, { ok: true });
        return;
      }
      context.stdout(`Removed ${parsed.name}@${parsed.version}`);
    });

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
        const paths = await ensureHome(context.home);
        const created = await addTarget({
          paths,
          id: options.id,
          label: options.label,
          path: targetPath,
          mode: options.mode ?? 'link',
        });
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
    const paths = await ensureHome(context.home);
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
    .option('--json', 'Print machine-readable JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const paths = await ensureHome(context.home);
      const removed = await removeTarget({ paths, id });
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
      const paths = await ensureHome(context.home);
      const updated = await setTargetEnabled(paths, id, true);
      if (options.json) {
        printJson(context, updated);
        return;
      }
      context.stdout(`Enabled target ${id}`);
    });

  target
    .command('disable')
    .description('Disable a target')
    .argument('<id>', 'Target id')
    .option('--json', 'Print machine-readable JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const paths = await ensureHome(context.home);
      const updated = await setTargetEnabled(paths, id, false);
      if (options.json) {
        printJson(context, updated);
        return;
      }
      context.stdout(`Disabled target ${id}`);
    });

  const route = program.command('route').description('Manage target routes');

  route
    .command('add')
    .description('Assign a package version to a target')
    .argument('<target-id>', 'Target id')
    .argument('<package@version>', 'Package name and version/range/tag')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (targetId: string, spec: string, options: { json?: boolean }) => {
        const paths = await ensureHome(context.home);
        const parsed = parseSpec(spec);
        const lock = await addRouteEntry({
          paths,
          targetId,
          name: parsed.name,
          requested: parsed.version,
        });
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
    const paths = await ensureHome(context.home);
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
        const paths = await ensureHome(context.home);
        const updated = await setPackageEnabled(paths, targetId, name, true);
        if (options.json) {
          printJson(context, updated);
          return;
        }
        context.stdout(`Enabled route ${targetId}/${name}`);
      },
    );

  route
    .command('disable')
    .description('Disable a package assignment on a target')
    .argument('<target-id>', 'Target id')
    .argument('<package>', 'Package name')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (targetId: string, name: string, options: { json?: boolean }) => {
        const paths = await ensureHome(context.home);
        const updated = await setPackageEnabled(paths, targetId, name, false);
        if (options.json) {
          printJson(context, updated);
          return;
        }
        context.stdout(`Disabled route ${targetId}/${name}`);
      },
    );

  route
    .command('remove')
    .description('Remove a package assignment from a target')
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
        const paths = await ensureHome(context.home);
        const removed = await removeRouteEntry({
          paths,
          targetId,
          name,
          force: options.force,
        });
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
    .option('--apply', 'Move candidates to trash')
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
        const paths = await ensureHome(context.home);
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

        const report = await gc(paths, {
          dryRun: !options.apply,
          maxAgeDays,
          keepTagged: options.keepTagged,
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
        context.stdout(
          `${report.freedBytes} bytes ${
            report.dryRun ? 'reclaimable' : 'reclaimed'
          }`,
        );
      },
    );

  addCommonOptions(
    program
      .command('history')
      .description('List route/package/skill history snapshots'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await ensureHome(context.home);
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
    .description('Restore route.json, package.json, and skill.json from history')
    .argument('<snapshot-id>', 'History snapshot id')
    .option('--apply', 'Apply routes after restoring the snapshot')
    .option('--json', 'Print machine-readable JSON')
    .action(
      async (
        snapshotId: string,
        options: { apply?: boolean; json?: boolean },
      ) => {
        const paths = await ensureHome(context.home);
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
      },
    );

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
        const paths = await ensureHome(context.home);
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
    const paths = await ensureHome(context.home);
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
    const paths = await ensureHome(context.home);
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

function addCommonOptions(command: Command): Command {
  return command.option('--json', 'Print machine-readable JSON');
}
