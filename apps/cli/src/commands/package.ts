import type { Command } from 'commander';
import {
  checkPackageSkillReferences,
  copyPackageVersion,
  createPackageVersion,
  readPackageFile,
  removePackageVersion,
  setPackageTag,
} from '@skillink/core';
import { addCommonOptions, printJson } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';
import { asArray, collectSpecs, parseSpec } from '../specs.js';

export function registerPackageCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;
  const packageCommand = program
    .command('package')
    .description('Manage package compositions');

  addCommonOptions(
    packageCommand
      .command('list')
      .alias('ls')
      .description('List package compositions'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await runtime.ensureHome();
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
        const paths = runtime.paths();
        const parsed = parseSpec(spec);
        const created = await runtime.mutate(
          paths,
          'package create',
          'create',
          spec,
          async () => {
            await runtime.ensureHome();
            return createPackageVersion({
              paths,
              name: parsed.name,
              version: parsed.version,
              description: options.description,
              skills: collectSpecs(options.skill),
              packages: collectSpecs(options.package),
            });
          },
        );
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
        const paths = runtime.paths();
        const source = parseSpec(sourceSpec);
        const target = parseSpec(targetSpec);
        const created = await runtime.mutate(
          paths,
          'package copy',
          'copy',
          `${sourceSpec} -> ${targetSpec}`,
          async () => {
            await runtime.ensureHome();
            return copyPackageVersion({
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
          },
        );
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
      const paths = runtime.paths();
      const parsed = parseSpec(spec);
      await runtime.mutate(
        paths,
        'package tag',
        'tag',
        `${spec} as ${tag}`,
        async () => {
          await runtime.ensureHome();
          return setPackageTag(paths, parsed.name, parsed.version, tag);
        },
      );
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
      const paths = runtime.paths();
      const parsed = parseSpec(spec);
      await runtime.mutate(
        paths,
        'package remove',
        'remove',
        spec,
        async () => {
          await runtime.ensureHome();
          return removePackageVersion(paths, parsed.name, parsed.version);
        },
      );
      if (options.json) {
        printJson(context, { ok: true });
        return;
      }
      context.stdout(`Removed ${parsed.name}@${parsed.version}`);
    });

  addCommonOptions(
    packageCommand
      .command('check')
      .description(
        'Find packages that reference missing skills and clean affected target skills',
      ),
  ).action(async (options: { json?: boolean }) => {
    const paths = runtime.paths();
    const report = await runtime.mutate(
      paths,
      'package check',
      'check',
      '',
      async () => {
        await runtime.ensureHome();
        return checkPackageSkillReferences(paths);
      },
      { commit: false },
    );

    if (options.json) {
      printJson(context, report);
    } else if (report.brokenReferences.length === 0) {
      context.stdout('No broken skill references.');
    } else {
      for (const reference of report.brokenReferences) {
        context.stdout(
          `broken  ${reference.packageName}@${reference.packageVersion} -> ` +
            `${reference.skillName}@${reference.skillVersion}`,
        );
      }
      for (const target of report.targets) {
        context.stdout(
          `cleaned  ${target.targetId}  ${target.removed.join(', ')}`,
        );
      }
      for (const failure of report.failures) {
        context.stderr(`error  ${failure.targetId}  ${failure.message}`);
      }
    }

    if (report.failures.length > 0) {
      runtime.setExitCode(1);
    }
  });
}
