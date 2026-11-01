import type { Command } from 'commander';
import {
  doctor,
  isGitAvailable,
  readPackageFile,
  readRouteFile,
  readSkillFile,
  status,
  summarizeTargetSkills,
} from '@skillink/core';
import { printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';

export function registerEnvironmentCommands(
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
}

export function registerSnapshotCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;

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
}
