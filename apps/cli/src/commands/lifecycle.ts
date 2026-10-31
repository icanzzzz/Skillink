import type { Command } from 'commander';
import { SkillinkError } from '@skillink/shared';
import {
  apply,
  doctor,
  gc,
  gitLog,
  isGitAvailable,
  readPackageFile,
  readRouteFile,
  readSkillFile,
  rollbackTo,
  status,
  summarizeTargetSkills,
} from '@skillink/core';
import { addCommonOptions, printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';

export function registerLifecycleCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;

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

  program
    .command('snapshot')
    .description(
      'Print one read-only snapshot of config, health, and target skills',
    )
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const paths = runtime.paths();
      const statusReport = await status({ paths });

      const [skills, packages, route, doctorReport, targetSkills] =
        await Promise.all([
          readSkillFile(paths),
          readPackageFile(paths),
          readRouteFile(paths),
          doctor({ paths, statusReport }),
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
        const paths = runtime.paths();
        const report = await runtime.mutate(
          paths,
          'gc',
          'remove',
          (result) =>
            `${result.removed.length} unreferenced skill version${
              result.removed.length === 1 ? '' : 's'
            }`,
          async () => {
            await runtime.ensureHome();
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
        const paths = runtime.paths();
        const report = await runtime.mutate(
          paths,
          'apply',
          'apply',
          '',
          async () => {
            await runtime.ensureHome();
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
          runtime.setExitCode(3);
        }
      },
    );

  addCommonOptions(
    program
      .command('history')
      .description('List control plane git commits'),
  ).action(async (options: { json?: boolean }) => {
    const paths = runtime.paths();
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
        const paths = runtime.paths();

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
          argv: runtime.argv,
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
    const paths = await runtime.ensureHome();
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
      runtime.setExitCode(1);
    }
  });

  addCommonOptions(
    program
      .command('doctor')
      .description('Check skills, packages, routes, and targets'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await runtime.ensureHome();
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
      runtime.setExitCode(1);
    }
  });
}
