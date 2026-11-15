import type { Command } from 'commander';
import {
  addControlPlane,
  listControlPlanes,
  useControlPlane,
} from '@skillink/core';
import type { ControlPlaneState } from '@skillink/shared';
import {
  addCommonOptions,
  printJson,
  type CliContext,
} from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';

function printControlPlanes(
  context: CliContext,
  state: ControlPlaneState,
): void {
  context.stdout(`Current control plane: ${state.active ?? '(none)'}`);
  for (const plane of state.controlPlanes) {
    if (plane === state.active) {
      context.stdout(`  * ${plane}`);
    } else {
      context.stdout(`    ${plane}`);
    }
  }
}

export function registerControlPlaneCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;
  const controlPlane = program
    .command('control-plane')
    .description('Manage control planes');

  addCommonOptions(
    controlPlane.command('list').description('List registered control planes'),
  ).action(async (options: { json?: boolean }) => {
    const state = await listControlPlanes();
    if (options.json) {
      printJson(context, state);
      return;
    }
    printControlPlanes(context, state);
  });

  addCommonOptions(
    controlPlane
      .command('add')
      .description('Register a control plane directory')
      .argument('<path>', 'Control plane directory'),
  ).action(async (target: string, options: { json?: boolean }) => {
    const state = await addControlPlane(target);
    if (options.json) {
      printJson(context, state);
      return;
    }
    printControlPlanes(context, state);
  });

  addCommonOptions(
    controlPlane
      .command('use')
      .description('Switch to a registered control plane')
      .argument('<path>', 'Control plane directory'),
  ).action(async (target: string, options: { json?: boolean }) => {
    const state = await useControlPlane(target);
    if (options.json) {
      printJson(context, state);
      return;
    }
    printControlPlanes(context, state);
  });
}
