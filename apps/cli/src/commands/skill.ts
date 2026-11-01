import type { Command } from 'commander';
import {
  importSkill,
  readSkillFile,
  removeSkillVersion,
  scanSkillPackages,
  setSkillTag,
} from '@skillink/core';
import { addCommonOptions, printJson, type CliContext } from '../cli-context.js';
import type { CommandRuntime } from '../command-runtime.js';
import { parseSpec } from '../specs.js';

async function runSkillAdd(
  folder: string,
  options: { name?: string; version?: string },
  context: CliContext,
) {
  return importSkill({
    sourceDir: folder,
    name: options.name,
    version: options.version,
    home: context.home,
  });
}

function printSkillAddResult(
  result: Awaited<ReturnType<typeof runSkillAdd>>,
  options: { json?: boolean },
  context: CliContext,
): void {
  if (options.json) {
    printJson(context, result);
    return;
  }

  context.stdout(
    `${result.created ? 'Imported' : 'Already present'} ${result.name}@${result.version} ` +
      `(${result.fileCount} files, ${result.size} bytes)`,
  );
}

export function registerSkillCommands(
  program: Command,
  runtime: CommandRuntime,
): void {
  const { context } = runtime;
  const skill = program.command('skill').description('Manage installed skills');

  addCommonOptions(
    skill
      .command('list')
      .alias('ls')
      .description('List skills and versions in skill.json'),
  ).action(async (options: { json?: boolean }) => {
    const paths = await runtime.ensureHome();
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

  addCommonOptions(
    skill
      .command('scan')
      .description('Find skill packages in a folder by locating SKILL.md')
      .argument('<folder>', 'Folder to scan'),
  ).action(async (folder: string, options: { json?: boolean }) => {
    const report = await scanSkillPackages(folder);

    if (options.json) {
      printJson(context, report);
      return;
    }

    if (report.packages.length === 0) {
      context.stdout('No skill packages found.');
      return;
    }

    for (const candidate of report.packages) {
      const spec =
        `${candidate.name ?? '(unnamed)'}@${candidate.version ?? 'auto'}`;
      context.stdout(`${spec}  ${candidate.sourceDir}`);
      for (const linkPath of candidate.directoryLinks) {
        context.stdout(`  directory link  ${linkPath}`);
      }
    }
  });

  const skillAdd = addCommonOptions(
    skill
      .command('add')
      .description('Import a local skill folder; it must contain SKILL.md')
      .argument('<folder>', 'Skill folder')
      .option('--name <name>', 'Skill name (default: <name>@<version> folder name)')
      .option(
        '--version <version>',
        'Skill version (default: <name>@<version> folder name or 1.0.0+hash)',
      ),
  );

  skillAdd.action(
    async (
      folder: string,
      options: { name?: string; version?: string; json?: boolean },
    ) => {
      const paths = runtime.paths();
      const result = await runtime.mutate(
        paths,
        'skill add',
        'add',
        (added) => `${added.name}@${added.version}`,
        async () => {
          await runtime.ensureHome();
          return runSkillAdd(folder, options, context);
        },
        { skills: true },
      );
      printSkillAddResult(result, options, context);
    },
  );

  addCommonOptions(
    program
      .command('add')
      .description('Alias for "skill add"')
      .argument('<folder>', 'Skill folder')
      .option('--name <name>', 'Skill name (default: <name>@<version> folder name)')
      .option(
        '--version <version>',
        'Skill version (default: <name>@<version> folder name or 1.0.0+hash)',
      ),
  ).action(
    async (
      folder: string,
      options: { name?: string; version?: string; json?: boolean },
    ) => {
      const paths = runtime.paths();
      const result = await runtime.mutate(
        paths,
        'skill add',
        'add',
        (added) => `${added.name}@${added.version}`,
        async () => {
          await runtime.ensureHome();
          return runSkillAdd(folder, options, context);
        },
        { skills: true },
      );
      printSkillAddResult(result, options, context);
    },
  );

  addCommonOptions(
    skill
      .command('tag')
      .description('Tag a skill version, for example latest or stable')
      .argument('<skill@version>', 'Skill name and exact version')
      .argument('<tag>', 'Tag name'),
  ).action(async (spec: string, tag: string, options: { json?: boolean }) => {
    const paths = runtime.paths();
    const parsed = parseSpec(spec);
    await runtime.mutate(
      paths,
      'skill tag',
      'tag',
      `${spec} as ${tag}`,
      async () => {
        await runtime.ensureHome();
        return setSkillTag(paths, parsed.name, parsed.version, tag);
      },
    );
    if (options.json) {
      printJson(context, { ok: true });
      return;
    }
    context.stdout(`Tagged ${parsed.name}@${parsed.version} as ${tag}`);
  });

  addCommonOptions(
    skill
      .command('remove')
      .description('Delete an unreferenced skill version')
      .argument('<skill@version>', 'Skill name and exact version'),
  ).action(async (spec: string, options: { json?: boolean }) => {
    const paths = runtime.paths();
    const parsed = parseSpec(spec);
    await runtime.mutate(
      paths,
      'skill remove',
      'remove',
      spec,
      async () => {
        await runtime.ensureHome();
        return removeSkillVersion(paths, parsed.name, parsed.version);
      },
      { skills: true },
    );
    if (options.json) {
      printJson(context, { ok: true });
      return;
    }
    context.stdout(`Removed ${parsed.name}@${parsed.version}`);
  });
}
