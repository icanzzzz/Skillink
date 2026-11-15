import { Command, CommanderError } from 'commander';
import { resolveControlPlaneHome } from '@skillink/core';
import { isSkillinkError } from '@skillink/shared';
import { printJsonError, type CliContext } from './cli-context.js';
import {
  createCommandRuntime,
  type CliHomeSource,
} from './command-runtime.js';
import { registerInitCommands, registerMigrateCommands } from './commands/init.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerPackageCommands } from './commands/package.js';
import { registerTargetCommands } from './commands/target.js';
import { registerRouteCommands } from './commands/route.js';
import { registerLocaleCommands } from './commands/locale.js';
import { registerEnvironmentCommands, registerSnapshotCommands } from './commands/environment.js';
import { registerLifecycleCommands } from './commands/lifecycle.js';
import { registerControlPlaneCommands } from './commands/control-plane.js';

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
    .version('1.0.0', '-V, --app-version', 'Show the CLI version')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => context.stdout(value.replace(/\n$/, '')),
      writeErr: (value) => {
        if (!jsonMode) {
          context.stderr(value.replace(/\n$/, ''));
        }
      },
    });

  let home: string | null = null;
  let homeSource: CliHomeSource = null;
  let resolutionError: unknown;

  if (context.home) {
    home = context.home;
    homeSource = 'context';
  } else {
    try {
      const resolved = await resolveControlPlaneHome();
      home = resolved.home;
      homeSource = resolved.source;
    } catch (error) {
      resolutionError = error;
    }
  }

  const runtime = createCommandRuntime(
    context,
    argv,
    (code) => {
      exitCode = code;
    },
    { home, homeSource, getResolutionError: () => resolutionError },
  );

  registerInitCommands(program, runtime);
  registerEnvironmentCommands(program, runtime);
  registerLocaleCommands(program, runtime);
  registerMigrateCommands(program, runtime);
  registerSnapshotCommands(program, runtime);
  registerControlPlaneCommands(program, runtime);
  registerSkillCommands(program, runtime);
  registerPackageCommands(program, runtime);
  registerTargetCommands(program, runtime);
  registerRouteCommands(program, runtime);
  registerLifecycleCommands(program, runtime);

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
      return 1;
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
