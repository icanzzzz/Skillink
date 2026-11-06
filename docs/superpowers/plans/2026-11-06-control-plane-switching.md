# Control Plane Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent multi-control-plane registry, CLI commands to manage it, and a GUI selector that reloads the workspace when the active control plane changes. Remove the implicit default control plane.

**Architecture:** Shared owns the registry schema and pure path helpers. Core owns the only filesystem access to the registry. The CLI resolves the active home once at startup (`CliContext.home` > `SKILLINK_HOME` > registry `active`, otherwise an explicit error) and every desktop operation goes through CLI commands.

**Tech Stack:** TypeScript, Node 22+, zod, Commander, React 19, Electron, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-06-control-plane-switching-design.md`

## Global Constraints

- No implicit `~/.agents/skillink` fallback. Missing active control plane is an error, not a default.
- Resolution order is exactly: `CliContext.home` > `SKILLINK_HOME` > registry `active` > `CONTROL_PLANE_REQUIRED`.
- `packages/shared` must not import `node:fs`; it may use `node:path` and `node:os`.
- `apps/desktop/src/main` and `apps/desktop/src/preload` must not import `@skillink/core`.
- Renderer must not import Node, Electron, or `@skillink/core`.
- Registry file is `control-planes.json` under the OS config directory; never inside a control plane and never in control-plane git.
- Windows path identity is case-insensitive; other platforms compare normalized paths as written.
- All writes use `writeJsonAtomic`; no direct `writeFile` for JSON state.
- Every task ends with `pnpm typecheck` and its targeted test command passing before commit.

## Review Focus

- First run with no registry and no `SKILLINK_HOME`: user must see a clear “no control plane” state, never the old default home.
- `SKILLINK_HOME` set while the registry has another active path: CLI must use the env path and the GUI must disable switching with a visible notice.
- Registry file missing, empty, or corrupt: `control-plane list` must distinguish “no planes” from a real read error without bricking unrelated commands such as `--help` and `env`.
- Paths containing spaces, `~`, `%USERPROFILE%`, or non-ASCII characters: add/use must store one normalized absolute path and dedupe correctly.
- Switching to a deleted or uninitialized folder: switching itself succeeds, then snapshot loads an empty/errored workspace without leaving stale skills, packages, reports, or language from the previous control plane.

---

### Task 1: Shared Control Plane Primitives

**Files:**
- Create: `packages/shared/src/control-plane.ts`
- Create: `packages/shared/src/control-plane.test.ts`
- Modify: `packages/shared/src/paths.ts`
- Modify: `packages/shared/src/paths.test.ts`
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `expandPath` from `./path-expand.js`, `SkillinkError` from `./errors.js`.
- Produces:
  - `ControlPlaneFileSchema`, `ControlPlaneFile`, `ControlPlaneState`
  - `ControlPlanePathOptions { env?, platform?, homedir? }`
  - `createEmptyControlPlaneFile(): ControlPlaneFile`
  - `getControlPlaneRegistryPath(options?: ControlPlanePathOptions): string`
  - `normalizeControlPlanePath(input: string, env?: NodeJS.ProcessEnv): string`
  - `controlPlanePathKey(value: string, platform?: NodeJS.Platform): string`
  - `mergeControlPlanePaths(existing: readonly string[], additions: readonly string[], platform?: NodeJS.Platform): string[]`
  - `getSkillinkHomeOverride(env?: NodeJS.ProcessEnv): string | null`
  - Errors `CONTROL_PLANE_REQUIRED`, `CONTROL_PLANE_NOT_FOUND`

- [ ] **Step 1: Write the failing shared tests**

Add `packages/shared/src/control-plane.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ControlPlaneFileSchema,
  controlPlanePathKey,
  getControlPlaneRegistryPath,
  mergeControlPlanePaths,
  normalizeControlPlanePath,
} from './control-plane.js';
import { getSkillinkHomeOverride } from './paths.js';

describe('control plane registry primitives', () => {
  it('uses the Windows roaming app data directory', () => {
    expect(
      getControlPlaneRegistryPath({
        platform: 'win32',
        homedir: 'C:/Users/me',
        env: { APPDATA: 'C:/Users/me/AppData/Roaming' },
      }),
    ).toBe(path.join('C:/Users/me/AppData/Roaming', 'Skillink', 'control-planes.json'));
  });

  it('uses Application Support on macOS and XDG config on Linux', () => {
    expect(
      getControlPlaneRegistryPath({
        platform: 'darwin',
        homedir: '/Users/me',
        env: {},
      }),
    ).toBe(
      path.join('/Users/me', 'Library', 'Application Support', 'Skillink', 'control-planes.json'),
    );
    expect(
      getControlPlaneRegistryPath({
        platform: 'linux',
        homedir: '/home/me',
        env: { XDG_CONFIG_HOME: '/home/me/.config' },
      }),
    ).toBe(path.join('/home/me/.config', 'skillink', 'control-planes.json'));
  });

  it('normalizes paths and dedupes case-insensitively on Windows', () => {
    const env = { HOME: '/home/me' } as NodeJS.ProcessEnv;
    const first = normalizeControlPlanePath('~/planes/a', env);
    expect(first).toBe(path.resolve('/home/me/planes/a'));
    expect(mergeControlPlanePaths([first], [first.toUpperCase()], 'win32')).toEqual([first]);
    expect(mergeControlPlanePaths([], [first, first], 'linux')).toEqual([first]);
    expect(controlPlanePathKey('C:/A/B', 'win32')).toBe('c:/a/b');
  });

  it('accepts an empty registry and keeps a null active value', () => {
    expect(
      ControlPlaneFileSchema.parse({
        schemaVersion: 1,
        active: null,
        controlPlanes: [],
      }),
    ).toEqual({ schemaVersion: 1, active: null, controlPlanes: [] });
  });

  it('reads SKILLINK_HOME as an expanded override', () => {
    expect(getSkillinkHomeOverride({ SKILLINK_HOME: '~/planes' } as NodeJS.ProcessEnv)).toBe(
      path.resolve(path.join(require('node:os').homedir(), 'planes')),
    );
    expect(getSkillinkHomeOverride({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
```

Use `import os from 'node:os'` instead of `require` in the final file.

Add to `packages/shared/src/paths.test.ts`:

```ts
it('requires an explicit home instead of falling back to a default', () => {
  expect(() => getSkillinkPaths(undefined as unknown as string)).toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/shared/src/control-plane.test.ts packages/shared/src/paths.test.ts`

Expected: FAIL because `control-plane.ts` and `getSkillinkHomeOverride` do not exist.

- [ ] **Step 3: Implement `packages/shared/src/control-plane.ts`**

Add the exported schema, types, and helpers described in Interfaces. Implementation rules:

- Schema is strict with `schemaVersion: z.literal(1)`, `active: z.string().min(1).nullable().default(null)`, `controlPlanes: z.array(z.string().min(1)).default([])`.
- `getControlPlaneRegistryPath` uses `options.env ?? process.env`, `options.platform ?? process.platform`, `options.homedir ?? os.homedir()`.
- Windows fallback when `APPDATA` is absent: `path.join(homedir, 'AppData', 'Roaming', 'Skillink', 'control-planes.json')`.
- macOS: `path.join(homedir, 'Library', 'Application Support', 'Skillink', 'control-planes.json')`.
- Other platforms: `XDG_CONFIG_HOME` if set, else `path.join(homedir, '.config')`, then `skillink/control-planes.json`.
- `normalizeControlPlanePath` trims, rejects empty with `SkillinkError('INVALID_PATH', 'A control plane path is required.')`, expands with `expandPath`, and returns `path.resolve(...)`.
- `controlPlanePathKey` normalizes separators with `path.normalize`, strips a trailing separator unless it is the root, and lowercases only on `win32`.
- `mergeControlPlanePaths` preserves first-seen order and replaces duplicates by key.

- [ ] **Step 4: Modify `packages/shared/src/paths.ts`**

Replace `getDefaultSkillinkHome` with:

```ts
export function getSkillinkHomeOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.SKILLINK_HOME?.trim();
  return override ? path.resolve(expandPath(override, { env })) : null;
}
```

Change the signature to `getSkillinkPaths(home: string): SkillinkPaths` and remove the default parameter.

- [ ] **Step 5: Add error codes and exports**

Add `'CONTROL_PLANE_REQUIRED'` and `'CONTROL_PLANE_NOT_FOUND'` to `SKILLINK_ERROR_CODES` in `packages/shared/src/errors.ts`. Add `export * from './control-plane.js';` to `packages/shared/src/index.ts`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm vitest run packages/shared/src/control-plane.test.ts packages/shared/src/paths.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: FAIL only on call sites that still call `getSkillinkPaths()` with no argument; the next task fixes those.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/control-plane.ts packages/shared/src/control-plane.test.ts packages/shared/src/paths.ts packages/shared/src/paths.test.ts packages/shared/src/errors.ts packages/shared/src/index.ts
git commit -m "feat(shared): add control plane registry primitives"
```

---

### Task 2: Require Explicit Core Paths

**Files:**
- Create: `packages/core/src/paths.ts`
- Create: `packages/core/src/paths.test.ts`
- Modify: `packages/core/src/apply.ts:429-431`
- Modify: `packages/core/src/doctor/index.ts:28-32`
- Modify: `packages/core/src/status.ts:50-52`
- Modify: `packages/core/src/target-resolution.ts:20-24`
- Modify: `packages/core/src/import-skill.ts:54-58`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `getSkillinkPaths`, `SkillinkError`, `SkillinkPaths` from `@skillink/shared`.
- Produces: `resolveSkillinkPaths(input: { paths?: SkillinkPaths; home?: string }): SkillinkPaths` from `packages/core/src/paths.ts`.

- [ ] **Step 1: Write the failing core path test**

```ts
import { describe, expect, it } from 'vitest';
import { SkillinkError, getSkillinkPaths } from '@skillink/shared';
import { resolveSkillinkPaths } from './paths.js';

describe('resolveSkillinkPaths', () => {
  it('prefers explicit paths over home', () => {
    const paths = getSkillinkPaths('C:/explicit');
    expect(resolveSkillinkPaths({ paths, home: 'C:/ignored' })).toBe(paths);
  });

  it('builds paths from an explicit home', () => {
    expect(resolveSkillinkPaths({ home: 'C:/planes/a' }).home).toBe('C:/planes/a');
  });

  it('rejects a missing control plane', () => {
    try {
      resolveSkillinkPaths({});
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillinkError);
      expect((error as SkillinkError).code).toBe('CONTROL_PLANE_REQUIRED');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/paths.test.ts`

Expected: FAIL because `packages/core/src/paths.ts` does not exist.

- [ ] **Step 3: Implement `packages/core/src/paths.ts`**

```ts
import {
  SkillinkError,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';

export function resolveSkillinkPaths(input: {
  paths?: SkillinkPaths;
  home?: string;
}): SkillinkPaths {
  if (input.paths) {
    return input.paths;
  }
  if (!input.home) {
    throw new SkillinkError(
      'CONTROL_PLANE_REQUIRED',
      'No control plane is selected. Add a control plane or set SKILLINK_HOME.',
    );
  }
  return getSkillinkPaths(input.home);
}
```

- [ ] **Step 4: Replace the five default fallbacks**

In each listed file, replace `input.paths ?? getSkillinkPaths(input.home)` with `resolveSkillinkPaths(input)`, and update imports. Keep behavior otherwise unchanged. Also export the helper from `packages/core/src/index.ts`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run packages/core/src/paths.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS for shared/core, with remaining failures only in `apps/desktop/src/main/index.ts` if it still calls `getSkillinkPaths()`; that call is removed in Task 6.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/paths.ts packages/core/src/paths.test.ts packages/core/src/apply.ts packages/core/src/doctor/index.ts packages/core/src/status.ts packages/core/src/target-resolution.ts packages/core/src/import-skill.ts packages/core/src/index.ts
git commit -m "refactor(core): require explicit control plane paths"
```

---

### Task 3: Core Control Plane Store

**Files:**
- Create: `packages/core/src/control-plane-store.ts`
- Create: `packages/core/src/control-plane-store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: shared registry schema/path helpers, `readJsonFile`, `writeJsonAtomic`, `isNodeError`.
- Produces:
  - `readControlPlaneFile(options?: ControlPlanePathOptions): Promise<ControlPlaneFile>`
  - `listControlPlanes(options?: ControlPlanePathOptions): Promise<ControlPlaneState>`
  - `addControlPlane(input: string, options?: ControlPlanePathOptions): Promise<ControlPlaneState>`
  - `useControlPlane(input: string, options?: ControlPlanePathOptions): Promise<ControlPlaneState>`
  - `resolveControlPlaneHome(options?: ControlPlanePathOptions): Promise<{ home: string | null; source: 'env' | 'registry' | null }>`
- `listControlPlanes` returns `active` from the env override when present, otherwise the registry value, and always merges a registry `active` back into `controlPlanes`.

- [ ] **Step 1: Write the failing store tests**

Use `mkdtemp` under `os.tmpdir()` and a helper that sets the platform-appropriate config env:

```ts
function registryOptions(root: string): ControlPlanePathOptions {
  return process.platform === 'win32'
    ? { env: { ...process.env, APPDATA: path.join(root, 'appdata') } }
    : { env: { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config') } };
}
```

Tests:

```ts
it('returns an empty registry when the file is missing', async () => {
  const options = registryOptions(root);
  await expect(listControlPlanes(options)).resolves.toEqual({
    active: null,
    activeSource: null,
    controlPlanes: [],
  });
});

it('creates the first added directory and activates it', async () => {
  const home = path.join(root, 'planes with space', 'a');
  const state = await addControlPlane(home, options);
  expect(state.active).toBe(path.resolve(home));
  expect(state.controlPlanes).toEqual([path.resolve(home)]);
  await expect(stat(home)).resolves.toMatchObject({});
});

it('adds later control planes without changing the active one', async () => {
  const first = path.join(root, 'planes', 'a');
  const second = path.join(root, 'planes', 'b');
  await addControlPlane(first, options);
  const state = await addControlPlane(second, options);
  expect(state.active).toBe(path.resolve(first));
  expect(state.controlPlanes).toEqual([path.resolve(first), path.resolve(second)]);
});

it('switches only to a registered control plane', async () => {
  const first = path.join(root, 'planes', 'a');
  const second = path.join(root, 'planes', 'b');
  await addControlPlane(first, options);
  await addControlPlane(second, options);
  await expect(useControlPlane(second, options)).resolves.toMatchObject({
    active: path.resolve(second),
  });
  await expect(useControlPlane(path.join(root, 'planes', 'missing'), options)).rejects.toMatchObject({
    code: 'CONTROL_PLANE_NOT_FOUND',
  });
});

it('rejects a file at the control plane path', async () => {
  const file = path.join(root, 'planes', 'file');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'x', 'utf8');
  await expect(addControlPlane(file, options)).rejects.toMatchObject({
    code: 'CONTROL_PLANE_NOT_FOUND',
  });
});

it('lets SKILLINK_HOME override the registry active path', async () => {
  const first = path.join(root, 'planes', 'a');
  await addControlPlane(first, options);
  const env = { ...options.env, SKILLINK_HOME: path.join(root, 'env-home') };
  await expect(listControlPlanes({ ...options, env })).resolves.toMatchObject({
    active: path.resolve(path.join(root, 'env-home')),
    activeSource: 'env',
  });
  await expect(resolveControlPlaneHome({ ...options, env })).resolves.toMatchObject({
    home: path.resolve(path.join(root, 'env-home')),
    source: 'env',
  });
});

it('returns null when there is no env override and no active path', async () => {
  await expect(resolveControlPlaneHome(registryOptions(root))).resolves.toEqual({
    home: null,
    source: null,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/control-plane-store.test.ts`

Expected: FAIL because `control-plane-store.ts` does not exist.

- [ ] **Step 3: Implement `packages/core/src/control-plane-store.ts`**

Implementation rules:

- `readControlPlaneFile` calls `readJsonFile(path, ControlPlaneFileSchema, createEmptyControlPlaneFile())`.
- `addControlPlane` uses `normalizeControlPlanePath`; on `ENOENT` creates the directory with `mkdir(..., { recursive: true })`; on a non-directory throws `SkillinkError('CONTROL_PLANE_NOT_FOUND', 'The control plane path is not a directory.', { path })`.
- Wrap unexpected fs errors in `SkillinkError('IO_ERROR', ...)` and keep the original cause.
- `useControlPlane` checks the normalized path by `controlPlanePathKey` against the stored list; if absent throw `SkillinkError('CONTROL_PLANE_NOT_FOUND', 'Control plane is not registered. Add it first.', { path })`.
- `listControlPlanes` reads the file, computes `getSkillinkHomeOverride(env)`, and returns `activeSource = override ? 'env' : file.active ? 'registry' : null`.
- `resolveControlPlaneHome` returns `{ home, source }` with the same precedence as `listControlPlanes`.
- Never add `SKILLINK_HOME` into `controlPlanes`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run packages/core/src/control-plane-store.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS for core and shared.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/control-plane-store.ts packages/core/src/control-plane-store.test.ts packages/core/src/index.ts
git commit -m "feat(core): add control plane registry store"
```

---

### Task 4: CLI Active-Home Resolution and `control-plane` Commands

**Files:**
- Create: `apps/cli/src/commands/control-plane.ts`
- Create: `apps/cli/src/control-plane.test.ts`
- Modify: `apps/cli/src/run.ts`
- Modify: `apps/cli/src/command-runtime.ts`
- Modify: `apps/cli/src/commands/skill.ts:13-23,119-169`
- Modify: `apps/cli/src/index.ts` only if exports are needed

**Interfaces:**
- Consumes: `resolveControlPlaneHome`, `listControlPlanes`, `addControlPlane`, `useControlPlane` from `@skillink/core`; `getSkillinkHomeOverride`, `SkillinkError` from `@skillink/shared`.
- Produces:
  - `CommandRuntime.home: string | null`
  - `CommandRuntime.homeSource: 'context' | 'env' | 'registry' | null`
  - `CommandRuntime.paths()` throws a stored registry read error first, then `CONTROL_PLANE_REQUIRED` when no home exists.
  - CLI commands `control-plane list|add|use`.

- [ ] **Step 1: Write failing CLI tests**

Create `apps/cli/src/control-plane.test.ts`. Use temporary config dirs and `vi.stubEnv`:

```ts
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGitAvailable } from '@skillink/core';
import { getControlPlaneRegistryPath, getSkillinkPaths } from '@skillink/shared';
import { runCli, type CliContext } from './run.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skillink-control-plane-'));
  roots.push(root);
  return root;
}

function context(home?: string): CliContext & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { home, out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

function registryEnv(root: string): void {
  if (process.platform === 'win32') {
    vi.stubEnv('APPDATA', path.join(root, 'appdata'));
  } else {
    vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'config'));
  }
  vi.stubEnv('SKILLINK_HOME', '');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('starts empty without a default control plane', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const ctx = context();
  expect(await runCli(['control-plane', 'list', '--json'], ctx)).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toEqual({
    active: null,
    activeSource: null,
    controlPlanes: [],
  });
});

it('adds, switches, and reloads the home used by snapshot', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const first = path.join(root, 'planes', 'a');
  const second = path.join(root, 'planes', 'b');

  expect(await runCli(['control-plane', 'add', first, '--json'], context())).toBe(0);
  expect(await runCli(['control-plane', 'add', second, '--json'], context())).toBe(0);

  const useCtx = context();
  expect(await runCli(['control-plane', 'use', second, '--json'], useCtx)).toBe(0);
  expect(JSON.parse(useCtx.out.join('\n'))).toMatchObject({
    active: path.resolve(second),
    activeSource: 'registry',
  });

  const snapshotCtx = context();
  expect(await runCli(['snapshot', '--json'], snapshotCtx)).toBe(0);
  expect(JSON.parse(snapshotCtx.out.join('\n'))).toMatchObject({
    home: path.resolve(second),
  });
  await stat(second);
});

it('switches to a deleted path and reports it in snapshot', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const home = path.join(root, 'planes', 'deleted');
  await runCli(['control-plane', 'add', home, '--json'], context());
  await rm(home, { recursive: true, force: true });

  expect(await runCli(['control-plane', 'use', home, '--json'], context())).toBe(0);
  const snapshotCtx = context();
  expect(await runCli(['snapshot', '--json'], snapshotCtx)).toBe(0);
  expect(JSON.parse(snapshotCtx.out.join('\n'))).toMatchObject({
    home: path.resolve(home),
  });
});

it('requires a control plane for commands that need one', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const ctx = context();
  expect(await runCli(['snapshot', '--json'], ctx)).toBe(1);
  expect(ctx.err.join('\n')).toContain('CONTROL_PLANE_REQUIRED');
});

it('lets SKILLINK_HOME override the registry', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const registered = path.join(root, 'planes', 'registered');
  const override = path.join(root, 'planes', 'override');
  await runCli(['control-plane', 'add', registered, '--json'], context());
  vi.stubEnv('SKILLINK_HOME', override);

  const ctx = context();
  expect(await runCli(['control-plane', 'list', '--json'], ctx)).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toMatchObject({
    active: path.resolve(override),
    activeSource: 'env',
  });
});

it('keeps help and env working when the registry is corrupt', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const registryFile = getControlPlaneRegistryPath();
  await mkdir(path.dirname(registryFile), { recursive: true });
  await writeFile(registryFile, '{ broken', 'utf8');

  expect(await runCli(['--help'], context())).toBe(0);
  expect(await runCli(['env', '--json'], context())).toBe(0);

  const listCtx = context();
  expect(await runCli(['control-plane', 'list', '--json'], listCtx)).toBe(1);
  expect(listCtx.err.join('\n')).toContain('IO_ERROR');
});
```

Add one test in the same file guarded by git availability for the `skill add` home fix:

```ts
const gitReady = await isGitAvailable();

it.skipIf(!gitReady)('imports into the active registry home, not the omitted context home', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const home = path.join(root, 'planes', 'active');
  await runCli(['control-plane', 'add', home], context());

  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), '# demo', 'utf8');

  const ctx = context();
  expect(
    await runCli(
      ['skill', 'add', source, '--name', 'demo', '--version', '1.0.0', '--json'],
      ctx,
    ),
  ).toBe(0);

  const skillFile = getSkillinkPaths(home).skillFile;
  const skill = JSON.parse(await readFile(skillFile, 'utf8'));
  expect(skill.skills.demo.versions['1.0.0']).toBeDefined();
});
```

Add `isGitAvailable` from `@skillink/core`, `getSkillinkPaths` from `@skillink/shared`, and `readFile`/`writeFile`/`mkdir` imports to this test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/cli/src/control-plane.test.ts`

Expected: FAIL because `control-plane` is not a command and `snapshot` still falls back to the default home.

- [ ] **Step 3: Implement runtime resolution**

In `apps/cli/src/command-runtime.ts`:

```ts
export type CliHomeSource = 'context' | 'env' | 'registry' | null;

export interface CommandRuntime {
  // existing fields...
  home: string | null;
  homeSource: CliHomeSource;
  paths(): SkillinkPaths;
}
```

`paths()` behavior:

```ts
const paths = (): SkillinkPaths => {
  if (resolutionError) {
    throw resolutionError;
  }
  if (!home) {
    throw new SkillinkError(
      'CONTROL_PLANE_REQUIRED',
      'No control plane is selected. Run "skillink control-plane add <path>" or set SKILLINK_HOME.',
    );
  }
  return getSkillinkPaths(home);
};
```

In `apps/cli/src/run.ts`, resolve once before building the runtime:

```ts
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
```

Pass `home`, `homeSource`, and `() => resolutionError` to `createCommandRuntime`. Keep `--help` and `env` working even when registry resolution fails.

- [ ] **Step 4: Implement `commands/control-plane.ts`**

Register `control-plane` with `list`, `add <path>`, and `use <path>`. Every subcommand supports `--json` via `addCommonOptions`. JSON output is the `ControlPlaneState`. Human output:

```text
Current control plane: <path or "(none)">
  * <active path>
    <other path>
```

- [ ] **Step 5: Fix `skill add` to use the resolved home**

Change `runSkillAdd(folder, options, context)` to `runSkillAdd(folder, options, home: string)` and call `importSkill({ ..., home })`. Both call sites pass `paths.home`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm vitest run apps/cli/src/control-plane.test.ts apps/cli/src/cli.test.ts`

Expected: PASS, or the git-guarded test is skipped when git is unavailable.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/control-plane.ts apps/cli/src/control-plane.test.ts apps/cli/src/run.ts apps/cli/src/command-runtime.ts apps/cli/src/commands/skill.ts
git commit -m "feat(cli): add control plane switching"
```

---

### Task 5: Register the Home Initialized by `init`

**Files:**
- Modify: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/cli-git.test.ts`
- Modify: `apps/cli/src/control-plane.test.ts`

**Interfaces:**
- Consumes: `CommandRuntime.homeSource`, `addControlPlane` from `@skillink/core`.
- Produces: successful `init` adds `paths.home` to the registry unless the home came from `CliContext.home`.

- [ ] **Step 1: Write the failing test**

In `apps/cli/src/cli-git.test.ts`, first change the helper to `function context(home?: string)`, import `vi` from `vitest`, and add `vi.unstubAllEnvs()` to the existing `afterEach`. Add the test inside the existing `describe.skipIf(!(await isGitAvailable()))` block:

```ts
it('registers a successfully initialized control plane', async () => {
  const root = await tempDir('skillink-cli-init-register-');
  const home = path.join(root, 'planes', 'init');
  if (process.platform === 'win32') {
    vi.stubEnv('APPDATA', path.join(root, 'appdata'));
  } else {
    vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'config'));
  }
  vi.stubEnv('SKILLINK_HOME', home);

  const initCtx = context();
  expect(await runCli(['init'], initCtx)).toBe(0);

  vi.stubEnv('SKILLINK_HOME', '');
  const listCtx = context();
  expect(await runCli(['control-plane', 'list', '--json'], listCtx)).toBe(0);
  expect(JSON.parse(listCtx.out.join('\n'))).toMatchObject({
    active: path.resolve(home),
    controlPlanes: [path.resolve(home)],
  });
});
```

Follow the file's existing temp-dir and `vi.unstubAllEnvs()` cleanup conventions.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/cli/src/cli-git.test.ts`

Expected: FAIL because `init` does not register the control plane.

- [ ] **Step 3: Implement registration**

In `apps/cli/src/commands/init.ts`, after `initializeHome` succeeds:

```ts
if (runtime.homeSource !== 'context') {
  await addControlPlane(paths.home);
}
```

Do not register test-only `CliContext.home` values. Keep `--json` output unchanged.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/cli/src/cli-git.test.ts apps/cli/src/control-plane.test.ts`

Expected: PASS or git-guarded tests skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/init.ts apps/cli/src/cli-git.test.ts apps/cli/src/control-plane.test.ts
git commit -m "feat(cli): register initialized control planes"
```

---

### Task 6: Desktop IPC and Startup Wiring

**Files:**
- Modify: `apps/desktop/src/ipc-schemas.ts`
- Modify: `apps/desktop/src/main/cli-commands.ts`
- Modify: `apps/desktop/src/main/cli-commands.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/shared.ts`

**Interfaces:**
- Consumes: CLI `control-plane list|add|use --json`; shared `ControlPlaneState`.
- Produces:
  - `ControlPlanePathRequestSchema`, `ControlPlanePathRequest`
  - `buildControlPlaneListArgs(): string[]`
  - `buildControlPlaneAddArgs(request: ControlPlanePathRequest): string[]`
  - `buildControlPlaneUseArgs(request: ControlPlanePathRequest): string[]`
  - `DesktopApi.getControlPlanes(): Promise<ControlPlaneState>`
  - `DesktopApi.addControlPlane(path: string): Promise<ControlPlaneState>`
  - `DesktopApi.useControlPlane(path: string): Promise<ControlPlaneState>`

- [ ] **Step 1: Write failing argv tests**

Add to `cli-commands.test.ts`:

```ts
it('maps control plane requests', () => {
  expect(buildControlPlaneListArgs()).toEqual(['control-plane', 'list', '--json']);
  expect(buildControlPlaneAddArgs({ path: 'C:/Users/Test User/plane' })).toEqual([
    'control-plane',
    'add',
    'C:/Users/Test User/plane',
    '--json',
  ]);
  expect(buildControlPlaneUseArgs({ path: 'C:/Users/Test User/plane' })).toEqual([
    'control-plane',
    'use',
    'C:/Users/Test User/plane',
    '--json',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/desktop/src/main/cli-commands.test.ts`

Expected: FAIL because the builders do not exist.

- [ ] **Step 3: Add IPC schema and builders**

In `ipc-schemas.ts`:

```ts
export const ControlPlanePathRequestSchema = z
  .object({ path: NonEmptyString })
  .strict();
export type ControlPlanePathRequest = z.infer<typeof ControlPlanePathRequestSchema>;
```

Add the three builders to `cli-commands.ts`.

- [ ] **Step 4: Add IPC handlers, preload API, and types**

`ipc.ts`:

```ts
handle('skillink:control-plane-list', () =>
  cli.invoke<ControlPlaneState>(buildControlPlaneListArgs()),
);
handle('skillink:control-plane-add', async (_event, input: unknown) => {
  const request = ControlPlanePathRequestSchema.parse(input);
  return cli.invoke<ControlPlaneState>(buildControlPlaneAddArgs(request));
});
handle('skillink:control-plane-use', async (_event, input: unknown) => {
  const request = ControlPlanePathRequestSchema.parse(input);
  return cli.invoke<ControlPlaneState>(buildControlPlaneUseArgs(request));
});
```

`preload/index.ts`:

```ts
getControlPlanes: () => ipcRenderer.invoke('skillink:control-plane-list'),
addControlPlane: (path) => ipcRenderer.invoke('skillink:control-plane-add', { path }),
useControlPlane: (path) => ipcRenderer.invoke('skillink:control-plane-use', { path }),
```

Add the three methods and `ControlPlaneState` import to `DesktopApi` in `shared.ts`.

- [ ] **Step 5: Fix startup language-pack refresh**

In `apps/desktop/src/main/index.ts`, replace `getSkillinkPaths()` with the CLI-resolved active control plane:

```ts
const state = await cli.invoke<ControlPlaneState>(buildControlPlaneListArgs());
if (!state.active) {
  return;
}
const installedPath = path.join(state.active, 'locales', 'zh-cn.json');
```

Keep the existing error logging and `syncBundledLanguagePack` behavior.

- [ ] **Step 6: Run tests, typecheck, and desktop build**

Run: `pnpm vitest run apps/desktop/src/main/cli-commands.test.ts apps/desktop/src/main/cli-adapter.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm --filter @skillink/desktop build`

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/ipc-schemas.ts apps/desktop/src/main/cli-commands.ts apps/desktop/src/main/cli-commands.test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/shared.ts
git commit -m "feat(desktop): expose control plane switching over IPC"
```

---

### Task 7: Renderer Selector and Reload Flow

**Files:**
- Create: `apps/desktop/src/renderer/src/ControlPlaneDialog.tsx`
- Create: `apps/desktop/src/renderer/src/ControlPlaneDialog.test.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `packages/shared/src/i18n-en.ts`
- Modify: `locales/zh-CN.json`
- Modify: `apps/desktop/src/renderer/src/i18n.test.tsx`

**Interfaces:**
- Consumes: `DesktopApi.getControlPlanes`, `addControlPlane`, `useControlPlane`, `chooseFolder`; `ControlPlaneState`.
- Produces:
  - `I18nContextValue.refreshLanguage(): Promise<void>`
  - `ControlPlaneDialogProps { open; api?; state: ControlPlaneState | null; onClose; onChanged }`
  - Sidebar button and no-active empty state in `App`.

- [ ] **Step 1: Write the failing dialog test**

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN_MESSAGES, type ControlPlaneState } from '@skillink/shared';
import { ControlPlaneDialog } from './ControlPlaneDialog.js';
import { renderWithMessages } from './i18n.test-utils.js';

const state: ControlPlaneState = {
  active: 'C:/planes/a',
  activeSource: 'registry',
  controlPlanes: ['C:/planes/a', 'C:/planes/b'],
};

describe('ControlPlaneDialog', () => {
  it('lists every control plane and marks the current one', () => {
    const html = renderWithMessages(
      <ControlPlaneDialog
        open
        state={state}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain('C:/planes/a');
    expect(html).toContain('C:/planes/b');
    expect(html).toContain(EN_MESSAGES['controlPlane.current']);
    expect(html).toContain(EN_MESSAGES['controlPlane.add']);
  });

  it('explains the env override and disables switching', () => {
    const html = renderWithMessages(
      <ControlPlaneDialog
        open
        state={{ ...state, active: 'C:/env', activeSource: 'env' }}
        onClose={() => undefined}
        onChanged={async () => undefined}
      />,
      EN_MESSAGES,
    );

    expect(html).toContain(EN_MESSAGES['controlPlane.envOverride']);
    expect(html).toContain('disabled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/desktop/src/renderer/src/ControlPlaneDialog.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add messages**

Add the keys from spec section 11 to `EN_MESSAGES` and `locales/zh-CN.json`. Bump the zh pack `version` to `1.0.13`. Add `errors.CONTROL_PLANE_REQUIRED` and `errors.CONTROL_PLANE_NOT_FOUND` in both catalogs.

- [ ] **Step 4: Implement `ControlPlaneDialog`**

Use `Modal` and the existing visual conventions. Behavior:

- Render each path in a row; active row gets an active class and current badge.
- Clicking a non-active row when `activeSource !== 'env'` calls `api.useControlPlane(path)`, then `await onChanged()`.
- “Add” calls `api.chooseFolder()`, then `api.addControlPlane(path)`, then `await onChanged()`.
- Local `busy` and `error` state; errors stay in the dialog.
- When `activeSource === 'env'`, show the override notice and disable add/switch buttons.
- Use `useToast` for added/switched success messages.

- [ ] **Step 5: Add `refreshLanguage`**

In `i18n.tsx`:

- Add `refreshLanguage(): Promise<void>` to `I18nContextValue` and `LanguageActions`.
- `createLanguageActions` returns `refreshLanguage: refresh`.
- Provider exposes a callback that calls the action and swallows read failures so a missing control plane leaves English fallback.
- In `i18n.test.tsx`, assert `await actions.refreshLanguage()` calls `getLanguageState` and updates the state even when the locale did not change.

- [ ] **Step 6: Integrate into `App`**

- Add `controlPlaneState`, `controlPlaneOpen`.
- In `refresh()`, call `client.getControlPlanes()` first. If `active` is null, set snapshot to `null`, clear the error, and return without calling `getSnapshot()`.
- Render the sidebar control plane footer as a button that opens the dialog.
- Render a no-active panel with the no-active title/body and an add button that opens the dialog.
- Render `<ControlPlaneDialog open={controlPlaneOpen} state={controlPlaneState} onClose={...} onChanged={...} />` next to the existing `LanguageDialog`.
- After dialog changes (`onChanged`), clear `gcReport`/`applyReport`, call `refresh()`, `refreshLanguage()`, and reload runtime status.
- Keep the existing busy overlay and error banner.

- [ ] **Step 7: Add styles**

Add focused classes for the trigger, dialog rows, active badge, empty state, and disabled state. Reuse existing color variables and responsive behavior; do not restyle unrelated page sections.

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm vitest run apps/desktop/src/renderer/src/ControlPlaneDialog.test.tsx apps/desktop/src/renderer/src/i18n.test.tsx apps/desktop/src/renderer/src/LanguageDialog.test.tsx`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/src/ControlPlaneDialog.tsx apps/desktop/src/renderer/src/ControlPlaneDialog.test.tsx apps/desktop/src/renderer/src/i18n.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/styles.css packages/shared/src/i18n-en.ts locales/zh-CN.json apps/desktop/src/renderer/src/i18n.test.tsx
git commit -m "feat(gui): add control plane selector"
```

---

### Task 8: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/plan.md`
- Modify: `docs/language-packs.md` only if it still describes the default control plane

**Interfaces:**
- Consumes: the completed behavior and commands from Tasks 1-7.
- Produces: user-facing documentation and a clean feature checklist.

- [ ] **Step 1: Update README**

Document:

- No default control plane; first-run has no active home.
- Registry path per OS.
- `skillink control-plane list|add|use`.
- Resolution order and `SKILLINK_HOME` behavior.
- GUI selector, add flow, no-active state, and switch reload.
- Remove instructions that assume `init` creates `~/.agents/skillink` without registration.

- [ ] **Step 2: Update ARCHITECTURE**

Update the data-location diagram, CLI/GUI flow, module boundary table, and security/cross-platform notes. State explicitly that the registry is outside the control plane and not versioned.

- [ ] **Step 3: Update `docs/plan.md`**

Remove the completed “控制面切换功能” block; keep the remaining roadmap items.

- [ ] **Step 4: Run the full verification suite**

Run: `pnpm test`

Expected: all tests pass.

Run: `pnpm typecheck`

Expected: no errors.

Run: `pnpm build`

Expected: CLI and desktop builds succeed.

- [ ] **Step 5: Commit**

```bash
git add README.md ARCHITECTURE.md docs/plan.md docs/language-packs.md
git commit -m "docs: document control plane switching"
```
