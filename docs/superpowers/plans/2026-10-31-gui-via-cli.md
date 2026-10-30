# GUI via CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CLI the only business entry point while keeping GUI action latency at the current in-process level.

**Architecture:** The Electron main process validates IPC requests, maps them to CLI argv, and executes the CLI command layer (`runCli`) in-process through a serialized adapter. The renderer talks only to the preload API; CLI output DTOs live in `@skillink/shared`.

**Tech Stack:** TypeScript, Electron, React, Commander, Zod, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-31-gui-via-cli-design.md`

## Global Constraints

- The CLI is the only business entry point. `apps/desktop/src/main/ipc.ts` must not import `@skillink/core`.
- No subprocess-per-command and no CLI server. Use `runCli` in-process.
- Human-readable CLI output must not change when `--json` is absent.
- Successful `--json` commands print their result payload to stdout. Failed `--json` commands print `{"ok":false,"error":{"code","message","details"}}` to stderr.
- Existing exit codes stay unchanged: `0` success, `1` general error/unhealthy, `3` apply conflict.
- `snapshot --json` is read-only and must not create control-plane files.
- Every desktop command runs through one serial queue.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass at the end of every task that changes runtime behavior.

## Review Focus

- **Concurrent GUI actions:** two writes must never overlap, and a snapshot must not read during a write. Test: adapter queue test starts two invocations and asserts the second has not started before the first resolves.
- **Unhealthy status/doctor:** `status --json` and `doctor --json` exit 1 but still return usable JSON. Test: adapter returns the report instead of throwing.
- **Apply conflicts:** `apply --json` exits 3 but returns a report with `ok: false`. Test: adapter returns the report.
- **Missing control plane:** opening the GUI against a missing home must not write files. Test: `snapshot --json` succeeds and leaves `route.json` absent.
- **Structured CLI errors:** a failing `--json` write must produce one parseable JSON error on stderr. Test: skill import without `SKILL.md`.
- **Arguments with spaces/unicode:** argv arrays bypass shell quoting. Test: argv builder keeps a Windows path with spaces as one argument.

---

### Task 1: Extract the CLI command layer

**Files:**
- Create: `apps/cli/src/run.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Test: `apps/cli/src/run.test.ts`

**Interfaces:**
- Consumes: existing `runCli(argv, context)` implementation from `apps/cli/src/index.ts`.
- Produces: `runCli(argv: string[], context?: CliContext): Promise<number>` and `CliContext` exported from `apps/cli/src/run.ts`.

- [ ] **Step 1: Write the failing import test**

Create `apps/cli/src/run.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './run.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CLI command layer', () => {
  it('runs commands without the executable entry guard', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillink-run-'));
    dirs.push(home);
    const out: string[] = [];

    expect(
      await runCli(['init'], {
        home,
        stdout: (line) => out.push(line),
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(out.join('\n')).toContain('Initialized');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run apps/cli/src/run.test.ts`
Expected: FAIL because `./run.js` does not exist.

- [ ] **Step 3: Move the command implementation**

Move everything currently in `apps/cli/src/index.ts` except the executable guard into `apps/cli/src/run.ts`. Keep exports of `CliContext` and `runCli` in `run.ts`.

Replace `apps/cli/src/index.ts` with:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './run.js';

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryFile === path.resolve(currentFile)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

Update `apps/cli/src/cli.test.ts` to import `runCli` and `CliContext` from `./run.js`.

- [ ] **Step 4: Run the CLI tests**

Run: `pnpm vitest run apps/cli/src/run.test.ts apps/cli/src/cli.test.ts`
Expected: PASS, all existing CLI tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/run.ts apps/cli/src/index.ts apps/cli/src/run.test.ts apps/cli/src/cli.test.ts
git commit -m "refactor: extract CLI command layer"
```

---

### Task 2: Move CLI boundary DTOs to shared

**Files:**
- Create: `packages/shared/src/reports.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/core/src/apply.ts`
- Modify: `packages/core/src/status.ts`
- Modify: `packages/core/src/doctor.ts`
- Modify: `packages/core/src/gc.ts`
- Modify: `packages/core/src/history.ts`
- Modify: `packages/core/src/import-skill.ts`
- Modify: `packages/core/src/target-resolution.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/desktop/src/shared.ts`
- Test: existing typecheck and test suite

**Interfaces:**
- Produces from `@skillink/shared`: `ApplyOperationKind`, `ApplyOperation`, `ApplyConflict`, `ApplyReport`, `StatusState`, `StatusEntry`, `StatusReport`, `DoctorIssueCode`, `DoctorIssue`, `DoctorReport`, `GcCandidate`, `GcPlan`, `GcReport`, `HistoryEntry`, `ImportSkillResult`, `TargetSkillSummary`, `SnapshotReport`, `CliErrorEnvelope`.
- Core keeps re-exporting the moved types from `@skillink/core` for compatibility.

- [ ] **Step 1: Add the shared report types**

Create `packages/shared/src/reports.ts` with the exact type definitions currently in core:

- `ApplyOperationKind`, `ApplyOperation`, `ApplyConflict`, `ApplyReport` from `packages/core/src/apply.ts`
- `StatusState`, `StatusEntry`, `StatusReport` from `packages/core/src/status.ts`
- `DoctorIssueCode`, `DoctorIssue`, `DoctorReport` from `packages/core/src/doctor.ts`
- `GcCandidate`, `GcPlan`, `GcReport` from `packages/core/src/gc.ts`
- `HistoryEntry` from `packages/core/src/history.ts`
- `ImportSkillResult` from `packages/core/src/import-skill.ts`
- `TargetSkillSummary` from `packages/core/src/target-resolution.ts`

Add the new boundary types:

```ts
export interface SnapshotReport {
  home: string;
  skills: SkillFile;
  packages: PackageFile;
  route: RouteFile;
  status: StatusReport;
  doctor: DoctorReport;
  targetSkills: TargetSkillSummary[];
  history: HistoryEntry[];
}

export interface CliErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

`reports.ts` may import `PackageFile`, `RouteFile`, `SkillFile` from `./schemas.js`.

Export the file from `packages/shared/src/index.ts`.

- [ ] **Step 2: Point core modules at the shared types**

In each core module listed above, remove the local report type declarations and import the types from `@skillink/shared`. Keep input/option interfaces local.

In `packages/core/src/index.ts`, add explicit type re-exports:

```ts
export type {
  ApplyConflict,
  ApplyOperation,
  ApplyOperationKind,
  ApplyReport,
  CliErrorEnvelope,
  DoctorIssue,
  DoctorIssueCode,
  DoctorReport,
  GcCandidate,
  GcPlan,
  GcReport,
  HistoryEntry,
  ImportSkillResult,
  SnapshotReport,
  StatusEntry,
  StatusReport,
  StatusState,
  TargetSkillSummary,
} from '@skillink/shared';
```

- [ ] **Step 3: Update the desktop shared types**

Change `apps/desktop/src/shared.ts` to import report types from `@skillink/shared` instead of `@skillink/core`.

Add `history: HistoryEntry[]` to `DesktopSnapshot` and make `targetSkills` required.

- [ ] **Step 4: Verify types and suite**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: PASS, all 291 existing tests plus the new run test.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/reports.ts packages/shared/src/index.ts packages/core/src apps/desktop/src/shared.ts
git commit -m "refactor: share CLI boundary DTOs"
```

---

### Task 3: Add the read-only snapshot command

**Files:**
- Modify: `apps/cli/src/run.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Test: `apps/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `readSkillFile`, `readPackageFile`, `readRouteFile`, `status`, `doctor`, `summarizeTargetSkills`, `listHistory`, `getSkillinkPaths`.
- Produces: `skillink snapshot --json` returning `SnapshotReport`.

- [ ] **Step 1: Write the failing snapshot tests**

Append to `apps/cli/src/cli.test.ts`:

```ts
it('returns one read-only snapshot containing config, health, target skills, and history', async () => {
  const root = await tempDir('skillink-cli-');
  const home = path.join(root, 'home');
  const source = await makeSkillSource();
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });
  const ctx = context(home);

  await runCli(['init'], ctx);
  await runCli(['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'], ctx);
  await runCli(['package', 'create', 'demo@1.0.0', '--skill', 'pdf@1.0.0'], ctx);
  await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);
  await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx);

  ctx.out.length = 0;
  expect(await runCli(['snapshot', '--json'], ctx)).toBe(0);
  const snapshot = JSON.parse(ctx.out.join('\n')) as {
    home: string;
    skills: { skills: Record<string, unknown> };
    packages: { packages: Record<string, unknown> };
    route: { targets: Array<{ id: string }> };
    status: { entries: Array<{ name: string; state: string }> };
    doctor: { ok: boolean };
    targetSkills: Array<{ targetId: string; skills: Array<{ name: string; version: string }> }>;
    history: unknown[];
  };

  expect(snapshot.home).toBe(path.resolve(home));
  expect(snapshot.skills.skills.pdf).toBeDefined();
  expect(snapshot.packages.packages.demo).toBeDefined();
  expect(snapshot.route.targets[0]?.id).toBe('project-a');
  expect(snapshot.status.entries).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'pdf', state: 'missing' })]),
  );
  expect(snapshot.doctor.ok).toBe(true);
  expect(snapshot.targetSkills).toEqual([
    { targetId: 'project-a', skills: [{ name: 'pdf', version: '1.0.0' }] },
  ]);
  expect(snapshot.history).toEqual([]);
});

it('does not create control-plane files when snapshotting a missing home', async () => {
  const root = await tempDir('skillink-cli-');
  const home = path.join(root, 'missing-home');
  const ctx = context(home);

  expect(await runCli(['snapshot', '--json'], ctx)).toBe(0);
  for (const name of ['route.json', 'package.json', 'skill.json']) {
    expect(await pathExists(path.join(home, name))).toBe(false);
  }
});
```

Note: the status assertion is `missing` before `apply`; the snapshot must not apply changes.

- [ ] **Step 2: Run the snapshot tests and verify they fail**

Run: `pnpm vitest run apps/cli/src/cli.test.ts -t snapshot`
Expected: FAIL because `snapshot` is unknown.

- [ ] **Step 3: Implement the snapshot command**

In `apps/cli/src/run.ts`, import `getSkillinkPaths` and the read/health/history helpers. Add:

```ts
program
  .command('snapshot')
  .description('Print one read-only snapshot of config, health, target skills, and history')
  .option('--json', 'Print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const paths = getSkillinkPaths(context.home);
    const [skills, packages, route, statusReport, doctorReport, targetSkills, history] =
      await Promise.all([
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

    context.stdout(`${paths.home}`);
    context.stdout(`${Object.keys(skills.skills).length} skills, ${Object.keys(packages.packages).length} packages, ${route.targets.length} targets`);
    context.stdout(statusReport.healthy ? 'healthy' : 'unhealthy');
  });
```

Do not call `ensureHome` in this command.

- [ ] **Step 4: Run the snapshot tests**

Run: `pnpm vitest run apps/cli/src/cli.test.ts -t snapshot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/run.ts apps/cli/src/cli.test.ts
git commit -m "feat: add read-only CLI snapshot command"
```

---

### Task 4: Add JSON write results and structured errors

**Files:**
- Modify: `apps/cli/src/run.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Test: `apps/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `printJson`, `CliErrorEnvelope`, all existing core write functions.
- Produces: every write command accepts `--json`; `runCli` emits structured JSON errors when JSON mode is active.

- [ ] **Step 1: Write the failing JSON contract tests**

Append to `apps/cli/src/cli.test.ts`:

```ts
it('prints import, target, and route mutation results as JSON', async () => {
  const root = await tempDir('skillink-cli-');
  const home = path.join(root, 'home');
  const source = await makeSkillSource();
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });
  const ctx = context(home);

  await runCli(['init'], ctx);

  ctx.out.length = 0;
  expect(
    await runCli(['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0', '--json'], ctx),
  ).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toMatchObject({
    name: 'pdf',
    version: '1.0.0',
    created: true,
  });

  ctx.out.length = 0;
  expect(
    await runCli(['package', 'create', 'demo@1.0.0', '--skill', 'pdf@1.0.0', '--json'], ctx),
  ).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toMatchObject({
    skills: { pdf: '1.0.0' },
  });

  ctx.out.length = 0;
  expect(
    await runCli(['target', 'add', targetPath, '--id', 'project-a', '--json'], ctx),
  ).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toMatchObject({
    id: 'project-a',
    enabled: true,
  });

  ctx.out.length = 0;
  expect(await runCli(['route', 'add', 'project-a', 'demo@1.0.0', '--json'], ctx)).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toMatchObject({
    resolved: '1.0.0',
    enabled: true,
  });
});

it('prints one structured JSON error when a JSON command fails', async () => {
  const home = await tempDir('skillink-cli-');
  const source = await makeSkillSource(false);
  const ctx = context(home);

  await runCli(['init'], ctx);
  ctx.err.length = 0;
  expect(
    await runCli(['skill', 'add', source, '--name', 'broken', '--json'], ctx),
  ).toBe(1);

  const error = JSON.parse(ctx.err.join('\n')) as {
    ok: boolean;
    error: { code: string; message: string };
  };
  expect(error.ok).toBe(false);
  expect(error.error.code).toBe('SKILL_MD_REQUIRED');
  expect(error.error.message).toContain('SKILL.md');
});

it('rejects copy mode with a structured JSON error', async () => {
  const root = await tempDir('skillink-cli-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });
  const ctx = context(home);

  await runCli(['init'], ctx);
  ctx.err.length = 0;
  expect(
    await runCli(['target', 'add', targetPath, '--mode', 'copy', '--json'], ctx),
  ).toBe(1);
  expect(JSON.parse(ctx.err.join('\n'))).toMatchObject({
    ok: false,
    error: { code: 'COPY_MODE_UNSUPPORTED' },
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm vitest run apps/cli/src/cli.test.ts -t "JSON"`
Expected: FAIL because write commands do not accept `--json` and errors are plain text.

- [ ] **Step 3: Implement JSON mode and error serialization**

In `runCli`, compute:

```ts
const jsonMode = context.json ?? argv.includes('--json');
```

In the catch block, when `jsonMode` is true, write one `CliErrorEnvelope` line to `context.stderr` for `SkillinkError` and unexpected errors. Preserve the current human-readable text when false.

Add `addCommonOptions(...)` or `.option('--json', ...)` to every write command. Capture each core return value and, when `options.json` is true, call `printJson(context, result)` instead of the human text. Commands returning `void` print `{ ok: true }`.

Add `--mode <mode>` to `target add` and pass it to `addTarget({ mode: options.mode as TargetMode | undefined })`.

Add `--no-keep-tagged` to `gc` and pass `keepTagged: options.keepTagged` to `gc`.

- [ ] **Step 4: Run the CLI tests**

Run: `pnpm vitest run apps/cli/src/cli.test.ts apps/cli/src/run.test.ts`
Expected: PASS, including all existing human-output tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/run.ts apps/cli/src/cli.test.ts
git commit -m "feat: add JSON results and structured CLI errors"
```

---

### Task 5: Add the desktop CLI adapter and argv builders

**Files:**
- Create: `apps/desktop/src/main/cli-commands.ts`
- Create: `apps/desktop/src/main/cli-commands.test.ts`
- Create: `apps/desktop/src/main/cli-adapter.ts`
- Create: `apps/desktop/src/main/cli-adapter.test.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/cli/package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Test: the two new test files

**Interfaces:**
- Consumes: `runCli` from `@skillink/cli/run`, request types from `apps/desktop/src/ipc-schemas.ts`, `SnapshotReport` from `@skillink/shared`.
- Produces:
  - `buildApplyArgs(request: ApplyRequest): string[]`
  - `buildImportSkillArgs(request: ImportSkillRequest): string[]`
  - `buildCreatePackageArgs(request: CreatePackageRequest): string[]`
  - `buildCopyPackageArgs(request: CopyPackageRequest): string[]`
  - `buildPackageRemoveArgs(request: PackageRemoveRequest): string[]`
  - `buildPackageTagArgs(request: PackageTagRequest): string[]`
  - `buildSkillRemoveArgs(request: SkillRemoveRequest): string[]`
  - `buildSkillTagArgs(request: SkillTagRequest): string[]`
  - `buildAddTargetArgs(request: AddTargetRequest): string[]`
  - `buildRemoveTargetArgs(request: TargetRemoveRequest): string[]`
  - `buildTargetEnableArgs(request: TargetEnableRequest): string[]`
  - `buildRouteAddArgs(request: RouteAddRequest): string[]`
  - `buildRouteRemoveArgs(request: RouteRemoveRequest): string[]`
  - `buildRouteEnableArgs(request: RouteEnableRequest): string[]`
  - `buildGcArgs(request?: GcRequest): string[]`
  - `buildRollbackArgs(request: RollbackRequest): string[]`
  - `createCliAdapter(runner?: CliRunner): CliAdapter` with `invoke<T>(argv: string[]): Promise<T>` and `snapshot(): Promise<SnapshotReport>`.

- [ ] **Step 1: Write the failing argv builder tests**

Create `apps/desktop/src/main/cli-commands.test.ts` with assertions such as:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAddTargetArgs,
  buildApplyArgs,
  buildCopyPackageArgs,
  buildCreatePackageArgs,
  buildGcArgs,
  buildImportSkillArgs,
  buildRouteAddArgs,
} from './cli-commands.js';

describe('CLI argv builders', () => {
  it('keeps a Windows path with spaces as one argument', () => {
    expect(
      buildAddTargetArgs({
        path: 'C:/Users/Test User/Project Skills',
        id: 'project-a',
        mode: 'link',
      }),
    ).toEqual([
      'target',
      'add',
      'C:/Users/Test User/Project Skills',
      '--id',
      'project-a',
      '--mode',
      'link',
      '--json',
    ]);
  });

  it('maps apply options', () => {
    expect(buildApplyArgs({ dryRun: true, prune: true, targetId: 'project-a' })).toEqual([
      'apply',
      '--dry-run',
      '--prune',
      '--target',
      'project-a',
      '--json',
    ]);
    expect(buildApplyArgs({})).toEqual(['apply', '--json']);
  });

  it('maps package dependencies to variadic options', () => {
    expect(
      buildCreatePackageArgs({
        name: 'frontend',
        version: '1.0.0',
        skills: { pdf: '1.0.0', review: '2.0.0' },
        packages: { base: '2.0.0' },
      }),
    ).toEqual([
      'package',
      'create',
      'frontend@1.0.0',
      '--skill',
      'pdf@1.0.0',
      'review@2.0.0',
      '--package',
      'base@2.0.0',
      '--json',
    ]);

    expect(
      buildCopyPackageArgs({
        sourceName: 'frontend',
        sourceVersion: '1.0.0',
        targetName: 'frontend',
        targetVersion: '1.1.0',
        skillOverrides: { pdf: '1.1.0' },
        dropSkills: ['review'],
      }),
    ).toEqual([
      'package',
      'copy',
      'frontend@1.0.0',
      'frontend@1.1.0',
      '--skill',
      'pdf@1.1.0',
      '--drop-skill',
      'review',
      '--json',
    ]);
  });

  it('maps import, route, and gc options', () => {
    expect(
      buildImportSkillArgs({ sourceDir: 'C:/Skills/pdf', name: 'pdf', version: '1.0.0' }),
    ).toEqual([
      'skill',
      'add',
      'C:/Skills/pdf',
      '--name',
      'pdf',
      '--version',
      '1.0.0',
      '--json',
    ]);
    expect(
      buildRouteAddArgs({ targetId: 'project-a', name: 'demo', requested: '^1.0.0' }),
    ).toEqual(['route', 'add', 'project-a', 'demo@^1.0.0', '--json']);
    expect(buildGcArgs({ dryRun: false, maxAgeDays: 30, keepTagged: false })).toEqual([
      'gc',
      '--apply',
      '--max-age-days',
      '30',
      '--no-keep-tagged',
      '--json',
    ]);
  });
});
```

- [ ] **Step 2: Write the failing adapter tests**

Create `apps/desktop/src/main/cli-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCliAdapter, CliCommandError, type CliRunner } from './cli-adapter.js';

function runnerReturning(output: {
  code: number;
  stdout?: string;
  stderr?: string;
}): { runner: CliRunner; seen: string[][] } {
  const seen: string[][] = [];
  const runner: CliRunner = async (argv, context) => {
    seen.push(argv);
    if (output.stdout) {
      for (const line of output.stdout.split('\n')) context.stdout(line);
    }
    if (output.stderr) {
      for (const line of output.stderr.split('\n')) context.stderr(line);
    }
    return output.code;
  };
  return { runner, seen };
}

describe('CLI adapter', () => {
  it('appends --json and parses stdout JSON', async () => {
    const { runner, seen } = runnerReturning({ code: 0, stdout: '{"ok":true}' });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['skill', 'list'])).resolves.toEqual({ ok: true });
    expect(seen).toEqual([['skill', 'list', '--json']]);
  });

  it('returns JSON data even when status exits 1', async () => {
    const { runner } = runnerReturning({
      code: 1,
      stdout: '{"healthy":false,"entries":[]}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['status', '--json'])).resolves.toEqual({
      healthy: false,
      entries: [],
    });
  });

  it('returns apply conflict reports when the CLI exits 3', async () => {
    const { runner } = runnerReturning({
      code: 3,
      stdout: '{"dryRun":false,"ok":false,"operations":[],"conflicts":[{"name":"pdf"}]}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['apply'])).resolves.toMatchObject({ ok: false });
  });

  it('throws a structured error when no JSON result exists', async () => {
    const { runner } = runnerReturning({
      code: 1,
      stderr: '{"ok":false,"error":{"code":"SKILL_MD_REQUIRED","message":"SKILL.md required"}}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['skill', 'add', 'C:/bad'])).rejects.toMatchObject({
      name: 'CliCommandError',
      code: 'SKILL_MD_REQUIRED',
      message: 'SKILL.md required',
      exitCode: 1,
    });
  });

  it('serializes concurrent invocations', async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const runner: CliRunner = async (argv, context) => {
      started.push(argv.join(' '));
      if (argv[0] === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      context.stdout('{}');
      return 0;
    };
    const adapter = createCliAdapter(runner);

    const first = adapter.invoke(['first']);
    const second = adapter.invoke(['second']);
    await Promise.resolve();
    expect(started).toEqual(['first --json']);

    releaseFirst?.();
    await expect(first).resolves.toEqual({});
    await expect(second).resolves.toEqual({});
    expect(started).toEqual(['first --json', 'second --json']);
  });

  it('snapshots through the snapshot command', async () => {
    const { runner, seen } = runnerReturning({
      code: 0,
      stdout: JSON.stringify({
        home: 'C:/home',
        skills: { schemaVersion: 2, skills: {} },
        packages: { schemaVersion: 2, packages: {} },
        route: { schemaVersion: 2, targets: [] },
        status: { healthy: true, entries: [] },
        doctor: { ok: true, issues: [] },
        targetSkills: [],
        history: [],
      }),
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.snapshot()).resolves.toMatchObject({ home: 'C:/home' });
    expect(seen).toEqual([['snapshot', '--json']]);
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm vitest run apps/desktop/src/main/cli-commands.test.ts apps/desktop/src/main/cli-adapter.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the argv builders**

Create `apps/desktop/src/main/cli-commands.ts`. Use a `spec(name, version)` helper returning `` `${name}@${version}` ``. Omit empty variadic options. Always append `--json`.

Rules:
- `apply`: `['apply', ...(dryRun ? ['--dry-run'] : []), ...(prune ? ['--prune'] : []), ...(targetId ? ['--target', targetId] : []), '--json']`
- `importSkill`: `['skill', 'add', sourceDir, ...(name ? ['--name', name] : []), ...(version ? ['--version', version] : []), '--json']`
- `createPackage`: `['package', 'create', spec(name, version), ...(skills ? ['--skill', ...specs] : []), ...(packages ? ['--package', ...specs] : []), ...(description ? ['--description', description] : []), '--json']`
- `copyPackage`: analogous, with one `--skill` group, one `--package` group, and one `--drop-skill` / `--drop-package` group.
- `remove` / `tag` commands use positional specs.
- `addTarget`: `['target', 'add', path, ...(id ? ['--id', id] : []), ...(label ? ['--label', label] : []), ...(mode ? ['--mode', mode] : []), '--json']`
- `target enable/disable`: `['target', enabled ? 'enable' : 'disable', id, '--json']`
- `route add`: `['route', 'add', targetId, spec(name, requested), '--json']`
- `route remove`: `['route', 'remove', targetId, name, '--json']`
- `route enable/disable`: `['route', enabled ? 'enable' : 'disable', targetId, name, '--json']`
- `gc`: `['gc', ...(request?.dryRun === false ? ['--apply'] : []), ...(request?.maxAgeDays !== undefined ? ['--max-age-days', String(request.maxAgeDays)] : []), ...(request?.keepTagged === false ? ['--no-keep-tagged'] : []), '--json']`
- `rollback`: `['rollback', id, '--json']`

- [ ] **Step 5: Implement the adapter**

Create `apps/desktop/src/main/cli-adapter.ts`:

```ts
import { runCli, type CliContext } from '@skillink/cli/run';
import type { CliErrorEnvelope, SnapshotReport } from '@skillink/shared';

export type CliRunner = (
  argv: string[],
  context: CliContext,
) => Promise<number>;

export class CliCommandError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly exitCode: number;

  constructor(input: {
    code: string;
    message: string;
    details?: unknown;
    exitCode: number;
  }) {
    super(input.message);
    this.name = 'CliCommandError';
    this.code = input.code;
    this.details = input.details;
    this.exitCode = input.exitCode;
  }
}

export interface CliAdapter {
  invoke<T>(argv: string[]): Promise<T>;
  snapshot(): Promise<SnapshotReport>;
}

export function createCliAdapter(runner: CliRunner = runCli): CliAdapter {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function invoke<T>(argv: string[]): Promise<T> {
    const args = argv.includes('--json') ? argv : [...argv, '--json'];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const context: CliContext = {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      json: true,
    };
    const exitCode = await runner(args, context);
    const text = stdout.join('\n').trim();

    if (text) {
      return JSON.parse(text) as T;
    }

    if (exitCode !== 0) {
      throw errorFromStderr(stderr.join('\n').trim(), exitCode);
    }

    return undefined as T;
  }

  return {
    invoke: (argv) => enqueue(() => invoke(argv)),
    snapshot: () => enqueue(() => invoke<SnapshotReport>(['snapshot'])),
  };
}

function errorFromStderr(text: string, exitCode: number): CliCommandError {
  try {
    const parsed = JSON.parse(text) as CliErrorEnvelope;
    if (parsed.ok === false && parsed.error) {
      return new CliCommandError({
        code: parsed.error.code,
        message: parsed.error.message,
        details: parsed.error.details,
        exitCode,
      });
    }
  } catch {
    // Fall through to the plain-text error.
  }

  return new CliCommandError({
    code: 'CLI_ERROR',
    message: text || `CLI exited with code ${exitCode}.`,
    exitCode,
  });
}
```

- [ ] **Step 6: Wire package and tool aliases**

- Add `"@skillink/cli": "workspace:*"` to `apps/desktop/package.json` dependencies.
- In `apps/cli/package.json`, add `"main": "./src/run.ts"`, `"types": "./src/run.ts"`, and an `exports` entry for `"."` and `"./run"` pointing at `./src/run.ts`.
- Add `@skillink/cli` and `@skillink/cli/run` aliases to `tsconfig.json` paths and `vitest.config.ts`.
- Run `pnpm install` so the workspace link exists.

- [ ] **Step 7: Run the adapter tests**

Run: `pnpm vitest run apps/desktop/src/main/cli-commands.test.ts apps/desktop/src/main/cli-adapter.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/cli-commands.ts apps/desktop/src/main/cli-commands.test.ts apps/desktop/src/main/cli-adapter.ts apps/desktop/src/main/cli-adapter.test.ts apps/desktop/package.json apps/cli/package.json tsconfig.json vitest.config.ts pnpm-lock.yaml
git commit -m "feat: add in-process desktop CLI adapter"
```

---

### Task 6: Convert IPC, preload, renderer, and desktop dependencies

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/SnapshotView.test.tsx`
- Modify: `apps/desktop/src/shared.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron.vite.config.ts`
- Test: existing desktop tests, typecheck, build

**Interfaces:**
- Consumes: `createCliAdapter` and the argv builders from Task 5.
- Produces: `DesktopSnapshot` with `history: HistoryEntry[]`; `getSnapshot()` returns it; no `history()` API.

- [ ] **Step 1: Update the snapshot fixture test first**

In `apps/desktop/src/renderer/src/SnapshotView.test.tsx`, add `history: []` to `emptySnapshot`. Run the renderer tests and verify they fail to typecheck or render until the type is updated:

Run: `pnpm vitest run apps/desktop/src/renderer/src/SnapshotView.test.tsx`
Expected: FAIL or type error because `DesktopSnapshot` does not yet have `history`.

- [ ] **Step 2: Convert the IPC handlers**

Rewrite `apps/desktop/src/main/ipc.ts`:

- Keep `BrowserWindow`, `app`, `dialog`, `ipcMain`, sender validation, and `chooseFolder`.
- Replace all core imports with:

```ts
import type { ApplyReport, GcReport, PackageLock, PackageVersion, SnapshotReport, TargetRoute } from '@skillink/shared';
import { createCliAdapter } from './cli-adapter.js';
import { buildAddTargetArgs, /* ... */ } from './cli-commands.js';
```

- Create one adapter instance:

```ts
const cli = createCliAdapter();
```

- `skillink:snapshot` returns `cli.snapshot()`.
- Every mutation parses its zod request and calls `cli.invoke(buildXArgs(request))`.
- Remove `skillink:history`.
- Keep `skillink:choose-folder`.

- [ ] **Step 3: Update preload and renderer**

- Remove `history` from `DesktopApi` in `apps/desktop/src/shared.ts` and from `apps/desktop/src/preload/index.ts`.
- In `App.tsx`, replace the parallel `getSnapshot()` / `history()` call with one `getSnapshot()` and `setHistory(nextSnapshot.history)`.
- Import all report DTOs from `@skillink/shared` instead of `@skillink/core` in `App.tsx`, `DoctorView.tsx`, `HistoryView.tsx`, `SkillsView.tsx`, and `TargetsView.tsx`.

- [ ] **Step 4: Update desktop build configuration**

- Remove `@skillink/core` from `apps/desktop/package.json` dependencies. Keep `@skillink/shared`.
- Ensure `@skillink/cli` is a dependency.
- In `apps/desktop/electron.vite.config.ts`, make the main build bundle these workspace packages:

```ts
externalizeDepsPlugin({
  exclude: ['@skillink/cli', '@skillink/core', '@skillink/shared'],
}),
```

- Run `pnpm install` if package metadata changed.

- [ ] **Step 5: Verify no direct core imports remain in desktop**

Run: `rg "@skillink/core" apps/desktop/src`
Expected: no matches.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Run the full suite and build**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm build`
Expected: CLI and desktop builds succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src apps/desktop/package.json apps/desktop/electron.vite.config.ts pnpm-lock.yaml
git commit -m "refactor: route desktop IPC through the CLI adapter"
```

---

### Task 7: Update architecture docs and run final verification

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Test: full verification commands

**Interfaces:**
- Consumes: the completed adapter architecture from Tasks 1–6.
- Produces: documentation that matches the runtime.

- [ ] **Step 1: Update the architecture document**

In `ARCHITECTURE.md` section 7.2/7.3, document:

- GUI calls the CLI command layer in-process; CLI is the only business entry.
- The main process is an adapter: IPC validation → argv → serial queue → `runCli`.
- `snapshot --json` is the GUI refresh read path.
- The desktop bundle contains CLI/Core code; there is no hard process isolation.
- External CLI packaging and `extraResources` are unchanged.

In `README.md`, add one line under the current status noting the GUI now uses the CLI backend in-process.

- [ ] **Step 2: Run the final verification**

Run: `pnpm test`
Expected: PASS, all tests green.

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm build`
Expected: PASS.

Run: `pnpm package:desktop`
Expected: PASS and `apps/desktop/release/win-unpacked/` is produced. If packaging is too slow for the environment, record the exact failure/blocker instead of claiming success.

- [ ] **Step 3: Inspect the packaged main bundle**

Run: `rg "snapshot|runCli" apps/desktop/release/win-unpacked/resources/app.asar` is not supported on asar; instead verify the build output:

```bash
rg "snapshot" apps/desktop/out/main/index.js
```

Expected: the bundled main contains the CLI snapshot command and no unresolved `@skillink/core` external import.

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md README.md
git commit -m "docs: describe GUI CLI backend architecture"
```

---

## Self-Review

- **Spec coverage:** Command layer, snapshot, JSON contract, adapter queue, type boundary, IPC conversion, renderer refresh, docs, and packaging are each owned by a task.
- **Step scan:** Each step names the file, the command, and the expected result. Type-only changes are verified by `pnpm typecheck`; behavior changes are preceded by failing tests.
- **Type consistency:** `SnapshotReport` is defined in Task 2 and consumed by the snapshot command in Task 3 and the adapter in Task 5. `DesktopSnapshot` includes `history` in Task 2 and is used by the renderer in Task 6.
- **Review focus:** Each line has a named test in the task that owns the behavior: queue serialization and exit-code handling in Task 5, missing-home snapshot in Task 3, structured errors in Task 4, and path-with-spaces argv in Task 5.
- **Proportion:** The plan pins interfaces and test contracts; implementation bodies are left to the executor except where the adapter's queue/error behavior needs an exact algorithm.
