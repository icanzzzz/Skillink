# Target 移除时按 Route 清理目标目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 target 时，先按 `route.json` 中该 target 的 package 解析结果删除目标目录里的 skill 目录/链接，成功后再删除 route 中的 target。

**Architecture:** 新增 `packages/core/src/target-gc.ts`，负责把 target 的全部 package lock（含 disabled）解析成 skill 名称集合，并对目标目录顶层执行“链接 unlink、真实目录递归删除、普通文件跳过”的直接清理。`removeTarget` 在 `withHistory` 中先调用 GC，再写 `route.json`；不做 staging、不做目标目录回滚。

**Tech Stack:** TypeScript、Node.js `fs/promises`、Vitest、pnpm、Electron/CLI 共用 Core。

**Spec:** 本次会话最终确认的需求，行为契约固化在本文件 `Behavioral Contract` 一节（无独立 spec 文件）。

## Behavioral Contract

这是本次实现的唯一行为口径，执行时不要再用旧版“仅受管链接”语义。

1. `target remove` 读取 `route.json`，找到 target。
2. 读取 `package.json` 和 `skill.json`，用 target 的**全部** `packages` lock 执行 package graph 解析；包含 `enabled: false` 的 package
3. 解析结果是 skill 名称集合。
4. 对集合中的每个 skill 名称，检查目标目录顶层 `target.path/<skillName>`：
   - 不存在：跳过。
   - 符号链接 / junction：`unlink` 链接本身。
   - 真实目录：递归删除整个目录。
   - 普通文件：跳过，保留。
   - 其他类型：跳过，保留。
5. 不检查条目是否由 Skillink 创建。route 解析结果中的 skill 名称就是受管目标。
6. 真实 skill 目录内部的普通文件属于该 skill 内容，随目录一起删除；只有目标目录顶层同名的普通文件会被跳过。
8. 不在解析结果中的目标目录条目（extra）全部保留。
9. 目标目录本身保留，不删除。
10. 不删除控制面 `skills/<name>/<version>/` 里的 skill 内容。
11. GC 成功后，才写 `route.json` 删除 target。
12. GC 中途失败：`route.json` 不写，立即抛错；已经删除的目标目录条目**不恢复**。
13. GC 成功但 `route.json` 写入失败：`route.json` 保持原样，立即抛错；已经删除的目标目录条目**不恢复**。
14. history 快照在 GC 前创建，只用于配置回滚，不恢复目标目录内容。
15. `removeTarget` 返回值仍为 `Promise<TargetRoute>`；`target remove --json` 的 JSON 结构不变。
16. disabled target 和 disabled package lock 只影响“是否参与解析”，不影响“是否删除”。

## Global Constraints

- 只修改 target 移除流程；不修改 `apply` / `apply --prune` / `skillink gc` / route schema / package schema / skill schema。
- 不修改 IPC schema、preload API、`apps/desktop/src/shared.ts`。
- `removeTarget` 的公开签名 `removeTarget(input: RemoveTargetInput): Promise<TargetRoute>` 保持不变。
- 删除目标目录链接时必须使用 `lstat` 判断类型，不能使用会跟随链接的 `stat` 判断顶层条目。
- 真实目录递归删除使用 Node `fs.rm(entryPath, { recursive: true, force: true })`；Node 的递归删除不会遍历目录内的符号链接/junction，但 Task 1 必须用测试固定这一安全行为。
- 目标目录本身和 `skills/` 库内容必须保留。
- `locales/zh-CN.json` 的 `version` 从 `1.0.4` 升到 `1.0.5`。
- 当前工作区已有未提交的 `TargetsView.tsx` / `TargetsView.test.tsx` / `styles.css` 改动；不要回退、覆盖或把这些改动夹带进本计划的提交。
- 新增/修改的英文文案必须同步提供简体中文翻译，`packages/shared/src/i18n.test.ts` 必须通过。
- 平台要求：Windows junction、Linux/macOS symlink 都要可用；不引入新依赖。

## Review Focus

- **真实目录与普通文件同名**：route 解析出的 `pdf` 是真实目录时递归删除；route 解析出的 `pdf` 是普通文件时保留。由 Task 1 的 link/dir/file 测试和 Task 2 的集成测试覆盖。
- **disabled 范围**：disabled target 和 `enabled: false` 的 package lock 仍必须参与解析和删除。由 Task 1 的 resolution 测试和 Task 2 的 disabled 集成测试覆盖。
- **库内容安全**：删除 junction，以及删除包含 junction 的真实目录时，不能跟着链接删到 `skills/`。由 Task 1 的“链接指向库”和“真实目录内含 junction”测试覆盖。
- **GC 失败**：删除失败时 route 不变并抛错；已经删掉的目标条目不恢复。由 Task 2 的 `target-gc-failure.test.ts` 覆盖。
- **route 写入失败**：GC 成功后写 route 失败时 route 不变并抛错；目标条目保持已删除状态。由 Task 2 的 `target-gc-failure.test.ts` 覆盖。
- **extra 条目**：不在解析结果中的目录/文件必须保留。由 Task 1 和 Task 2 的 extra 断言覆盖。

## File Structure

- Create: `packages/core/src/target-gc.ts`
  - `resolveTargetSkillNames`：route target -> skill 名称集合。
  - `gcTargetEntries`：按 skill 名称直接删除目标目录条目。
- Create: `packages/core/src/target-gc.test.ts`
  - 纯函数/文件系统单元测试。
- Create: `packages/core/src/target-gc-failure.test.ts`
  - GC 失败与 route 写入失败测试。
- Modify: `packages/core/src/target.ts:132-155`
  - `removeTarget` 接入解析与 GC。
- Modify: `packages/core/src/index.ts:1-45`
  - 导出 `target-gc.js`。
- Modify: `packages/core/src/target.test.ts`
  - `removeTarget` 集成测试。
- Modify: `apps/cli/src/run.ts:809-822`
  - 更新 `target remove` 描述。
- Modify: `apps/cli/src/cli.test.ts`
  - CLI 端到端清理测试。
- Modify: `packages/shared/src/i18n-en.ts:138-139`
  - 更新英文确认文案。
- Modify: `locales/zh-CN.json:6,129`
  - 更新中文确认文案和语言包版本。
- Modify: `ARCHITECTURE.md`
  - 6.7、6.8、7.1、7.2、10.1、11。
- Modify: `README.md:168`
  - 更新 Targets 描述。

---

### Task 1: 新增 target GC 核心模块

**Files:**
- Create: `packages/core/src/target-gc.ts`
- Create: `packages/core/src/target-gc.test.ts`

**Interfaces:**
- Consumes:
  - `SkillinkPaths`, `TargetRoute` from `@skillink/shared`
  - `readPackageFile(paths: SkillinkPaths): Promise<PackageFile>`
  - `readSkillFile(paths: SkillinkPaths): Promise<SkillFile>`
  - `resolvePackageGraph(packages: PackageFile, skills: SkillFile, roots: PackageRef[]): PackageResolution`
  - `assertSafeRealTargetPath(targetPath: string, paths: SkillinkPaths): Promise<string>`
  - `removeLink(linkPath: string): Promise<void>`
  - `withFsRetry<T>(action: () => Promise<T>): Promise<T>`
- Produces:
  - `export interface TargetGcInput { paths: SkillinkPaths; target: TargetRoute; }`
  - `export async function resolveTargetSkillNames(input: TargetGcInput): Promise<string[]>`
  - `export async function gcTargetEntries(input: TargetGcInput & { skillNames: string[] }): Promise<string[]>`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/target-gc.test.ts`，内容如下（保留现有测试风格：临时目录、`afterEach` 清理）：

```ts
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type TargetRoute } from '@skillink/shared';
import { createDirectoryLink } from './links.js';
import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';
import { gcTargetEntries, resolveTargetSkillNames } from './target-gc.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function setup() {
  const root = await tempDir('skillink-target-gc-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });

  const source = await tempDir('skillink-target-gc-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'pdf',
    version: '1.0.0',
    home,
  });

  const paths = getSkillinkPaths(home);
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });

  const target: TargetRoute = {
    id: 'project-a',
    path: targetPath,
    mode: 'link',
    enabled: true,
    packages: {
      frontend: {
        requested: '1.0.0',
        resolved: '1.0.0',
        integrity: 'sha256-test',
        enabled: false,
      },
    },
  };

  return { root, paths, target, targetPath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('target GC', () => {
  it('resolves skills from all package locks including disabled locks', async () => {
    const { paths, target } = await setup();

    await expect(resolveTargetSkillNames({ paths, target })).resolves.toEqual([
      'pdf',
    ]);
  });

  it('deletes resolved directory links and real directories but skips files', async () => {
    const { paths, target, targetPath } = await setup();
    const librarySkill = path.join(paths.libraryDir, 'pdf', '1.0.0');

    await createDirectoryLink(librarySkill, path.join(targetPath, 'pdf'));
    await mkdir(path.join(targetPath, 'review'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'review', 'note.txt'),
      'delete',
      'utf8',
    );
    await writeFile(path.join(targetPath, 'review-note'), 'keep', 'utf8');
    await createDirectoryLink(
      librarySkill,
      path.join(targetPath, 'extra-link'),
    );
    await mkdir(path.join(targetPath, 'extra'), { recursive: true });
    await writeFile(
      path.join(targetPath, 'extra', 'note.txt'),
      'keep',
      'utf8',
    );

    const removed = await gcTargetEntries({
      paths,
      target,
      skillNames: ['pdf', 'review', 'review-note'],
    });

    expect(removed).toEqual(['pdf', 'review']);
    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
    expect(await pathExists(path.join(targetPath, 'review'))).toBe(false);
    expect(await pathExists(path.join(targetPath, 'extra-link'))).toBe(true);
    expect(await readFile(path.join(targetPath, 'review-note'), 'utf8')).toBe(
      'keep',
    );
    expect(
      await readFile(path.join(targetPath, 'extra', 'note.txt'), 'utf8'),
    ).toBe('keep');
    expect(await pathExists(path.join(librarySkill, 'SKILL.md'))).toBe(true);
    expect(await pathExists(targetPath)).toBe(true);
  });

  it('does not traverse links inside a real skill directory', async () => {
    const { paths, target, targetPath } = await setup();
    const librarySkill = path.join(paths.libraryDir, 'pdf', '1.0.0');

    await mkdir(path.join(targetPath, 'review'), { recursive: true });
    await createDirectoryLink(
      librarySkill,
      path.join(targetPath, 'review', 'pdf-link'),
    );

    await expect(
      gcTargetEntries({
        paths,
        target,
        skillNames: ['review'],
      }),
    ).resolves.toEqual(['review']);
    expect(await pathExists(path.join(librarySkill, 'SKILL.md'))).toBe(true);
  });

  it('returns an empty list when the target directory is missing', async () => {
    const { paths, target, targetPath } = await setup();
    await rm(targetPath, { recursive: true, force: true });

    await expect(
      gcTargetEntries({ paths, target, skillNames: ['pdf'] }),
    ).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/target-gc.test.ts`

Expected: FAIL，模块 `./target-gc.js` 不存在或导出不存在。

- [ ] **Step 3: 实现 `target-gc.ts`**

创建 `packages/core/src/target-gc.ts`，导入：

```ts
import { lstat, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  assertSafeSegment,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import { withFsRetry } from './fs-retry.js';
import { removeLink } from './links.js';
import { resolvePackageGraph } from './package-graph.js';
import { readPackageFile } from './package-store.js';
import { readSkillFile } from './skill-store.js';
import { assertSafeRealTargetPath } from './path-policy.js';
```

实现要求：

- `isNodeError(error): error is NodeJS.ErrnoException` 私有 helper。
- `resolveTargetSkillNames(input)`：
  - `const roots = Object.entries(input.target.packages).map(([name, lock]) => ({ name, version: lock.resolved }))`
  - `roots.length === 0` 时直接返回 `[]`，不读配置文件。
  - 否则 `Promise.all([readPackageFile(input.paths), readSkillFile(input.paths)])`。
  - 返回 `[...resolvePackageGraph(packageFile, skillFile, roots).skills.keys()].sort()`。
  - 不过滤 `target.enabled`，不过滤 `lock.enabled`。
- `gcTargetEntries(input)`：
  - 先执行 `const skillNames = input.skillNames.map((name) => assertSafeSegment(name, 'skill name'))`；任何不安全名称在删除前抛出 `UNSAFE_PATH`。
  - `const targetPath = await assertSafeRealTargetPath(input.target.path, input.paths)`。
  - `stat(targetPath)`，`ENOENT` 返回 `undefined`；目标不存在或不是目录时直接返回 `[]`。
  - 逐个 skill：
    - `const entryPath = path.join(targetPath, skillName)`。
    - `lstat(entryPath)`，`ENOENT` 跳过；其他错误包装成 `SkillinkError('IO_ERROR', ..., { targetId, targetPath, skillName, path: entryPath }, { cause })`。
    - `info.isSymbolicLink()`：`await removeLink(entryPath)`，成功后 push skillName。
    - `info.isDirectory()`：`await withFsRetry(() => rm(entryPath, { recursive: true, force: true }))`，成功后 push skillName。
    - 其他类型：`continue`，不删除。
  - 删除失败时包装成 `SkillinkError('IO_ERROR', 'Failed to delete target skill ...', { targetId, targetPath, skillName, path: entryPath }, { cause: error })`，立即抛出，不继续后续 skill。
  - 返回已删除的 skill 名称数组，顺序与输入 `skillNames` 一致。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/src/target-gc.test.ts`

Expected: PASS，4 个测试通过。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/target-gc.ts packages/core/src/target-gc.test.ts
git commit -m "feat(core): add target skill GC helpers"
```

---

### Task 2: 接入 `removeTarget` 并补集成/失败测试

**Files:**
- Modify: `packages/core/src/target.ts:132-155`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/target.test.ts`
- Create: `packages/core/src/target-gc-failure.test.ts`
- Modify: `apps/cli/src/run.ts:809-822`
- Modify: `apps/cli/src/cli.test.ts`

**Interfaces:**
- Consumes:
  - `resolveTargetSkillNames(input: TargetGcInput): Promise<string[]>`
  - `gcTargetEntries(input: TargetGcInput & { skillNames: string[] }): Promise<string[]>`
- Produces:
  - `removeTarget(input: RemoveTargetInput): Promise<TargetRoute>` 行为和签名不变；新增“先 GC 再写 route”的内部行为。

- [ ] **Step 1: 给 `target.test.ts` 加失败集成测试**

修改 `packages/core/src/target.test.ts` 顶部导入：

- 把 `node:fs/promises` 导入改为：

```ts
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
```

- 把 `@skillink/shared` 导入改为：

```ts
import { getSkillDir, getSkillinkPaths } from '@skillink/shared';
```

- 在现有 `./route.js` 导入中增加 `addRouteEntry`、`setPackageEnabled`、`writeRouteFile`，保留已有的 `readRouteFile`。
- 新增：

```ts
import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';
```

保留现有的 `addTarget`、`removeTarget`、`setTargetEnabled` 导入。

增加 `pathExists` helper 和 `createTargetWithPackage` helper：

```ts
async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function createTargetWithPackage() {
  const { root, paths, targetPath } = await setup();
  const source = await tempDir('skillink-target-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'pdf',
    version: '1.0.0',
    home: paths.home,
  });
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });
  await addTarget({ paths, id: 'project-a', path: targetPath });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'frontend',
    requested: '1.0.0',
  });
  return { root, paths, targetPath };
}
```

在 `describe('targets', ...)` 中加入：

```ts
it('removes resolved skill directories even when they are not managed links', async () => {
  const { paths, targetPath } = await createTargetWithPackage();

  // 故意创建真实目录，证明 route 解析结果比 isManagedLink 优先。
  await mkdir(path.join(targetPath, 'pdf'), { recursive: true });
  await writeFile(
    path.join(targetPath, 'pdf', 'note.txt'),
    'copy',
    'utf8',
  );
  await mkdir(path.join(targetPath, 'extra'), { recursive: true });
  await writeFile(
    path.join(targetPath, 'extra', 'note.txt'),
    'keep',
    'utf8',
  );
  await writeFile(path.join(targetPath, 'keep.txt'), 'keep', 'utf8');

  await removeTarget({ paths, id: 'project-a' });

  expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
  expect(
    await readFile(path.join(targetPath, 'extra', 'note.txt'), 'utf8'),
  ).toBe('keep');
  expect(await readFile(path.join(targetPath, 'keep.txt'), 'utf8')).toBe(
    'keep',
  );
  expect(await pathExists(targetPath)).toBe(true);
  expect(await pathExists(getSkillDir(paths, 'pdf', '1.0.0'))).toBe(true);
  expect((await readRouteFile(paths)).targets).toEqual([]);
});

it('includes disabled targets and disabled package locks in cleanup', async () => {
  const { paths, targetPath } = await createTargetWithPackage();
  await setTargetEnabled(paths, 'project-a', false);
  await setPackageEnabled(paths, 'project-a', 'frontend', false);

  await mkdir(path.join(targetPath, 'pdf'), { recursive: true });
  await writeFile(
    path.join(targetPath, 'pdf', 'note.txt'),
    'copy',
    'utf8',
  );

  await removeTarget({ paths, id: 'project-a' });

  expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
  expect((await readRouteFile(paths)).targets).toEqual([]);
});

it('does not remove the target when route packages cannot be resolved', async () => {
  const { paths, targetPath } = await createTargetWithPackage();
  const route = await readRouteFile(paths);
  route.targets[0]!.packages.frontend!.resolved = '9.9.9';
  await writeRouteFile(paths, route);

  await mkdir(path.join(targetPath, 'pdf'), { recursive: true });

  await expect(
    removeTarget({ paths, id: 'project-a' }),
  ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });

  expect((await readRouteFile(paths)).targets).toHaveLength(1);
  expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(true);
});
```

- [ ] **Step 2: 创建失败测试文件**

创建 `packages/core/src/target-gc-failure.test.ts`：

```ts
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';

const state = vi.hoisted(() => ({
  failRmPath: '',
  failRenameTo: '',
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (
      target: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1],
    ) => {
      if (state.failRmPath && String(target) === state.failRmPath) {
        throw Object.assign(new Error('EIO: simulated delete failure'), {
          code: 'EIO',
        });
      }
      return actual.rm(target, options);
    },
    rename: async (from: string, to: string) => {
      if (state.failRenameTo && to === state.failRenameTo) {
        throw Object.assign(new Error('EIO: simulated write failure'), {
          code: 'EIO',
        });
      }
      return actual.rename(from, to);
    },
  };
});

import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';
import { addRouteEntry, readRouteFile } from './route.js';
import { addTarget, removeTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function setup(): Promise<{
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-target-gc-failure-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });

  const source = await tempDir('skillink-target-gc-failure-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'pdf',
    version: '1.0.0',
    home,
  });

  const paths = getSkillinkPaths(home);
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });
  await addTarget({ paths, id: 'project-a', path: targetPath });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'frontend',
    requested: '1.0.0',
  });
  return { paths, targetPath };
}

afterEach(async () => {
  state.failRmPath = '';
  state.failRenameTo = '';
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('target GC failure handling', () => {
  it('keeps route unchanged when deleting a resolved skill fails', async () => {
    const { paths, targetPath } = await setup();
    const skillPath = path.join(targetPath, 'pdf');
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, 'note.txt'), 'copy', 'utf8');
    state.failRmPath = skillPath;

    await expect(
      removeTarget({ paths, id: 'project-a' }),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });

    expect((await readRouteFile(paths)).targets).toHaveLength(1);
    expect(await pathExists(skillPath)).toBe(true);
  });

  it('keeps route unchanged when writing route fails after cleanup', async () => {
    const { paths, targetPath } = await setup();
    const skillPath = path.join(targetPath, 'pdf');
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, 'note.txt'), 'copy', 'utf8');
    state.failRenameTo = paths.routeFile;

    await expect(
      removeTarget({ paths, id: 'project-a' }),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });

    expect((await readRouteFile(paths)).targets).toHaveLength(1);
    expect(await pathExists(skillPath)).toBe(false);
  });
});
```

- [ ] **Step 3: 加 CLI 端到端测试**

在 `apps/cli/src/cli.test.ts` 顶部 `node:fs/promises` 导入中加入 `unlink`。

在 `runs the skill -> package -> route -> apply workflow` 用例后加入：

```ts
it('removes route-resolved skill directories on target remove', async () => {
  const root = await tempDir('skillink-cli-');
  const home = path.join(root, 'home');
  const source = await makeSkillSource();
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });
  const ctx = context(home);

  await runCli(['init'], ctx);
  await runCli(
    ['skill', 'add', source, '--name', 'pdf', '--version', '1.0.0'],
    ctx,
  );
  await runCli(
    ['package', 'create', 'demo@1.0.0', '--skill', 'pdf@1.0.0'],
    ctx,
  );
  await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);
  await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx);
  await runCli(['apply'], ctx);

  // 把 apply 创建的链接换成真实目录，证明 route 解析结果优先。
  await unlink(path.join(targetPath, 'pdf'));
  await mkdir(path.join(targetPath, 'pdf'), { recursive: true });
  await writeFile(
    path.join(targetPath, 'pdf', 'note.txt'),
    'copy',
    'utf8',
  );
  await writeFile(path.join(targetPath, 'keep.txt'), 'keep', 'utf8');

  expect(await runCli(['target', 'remove', 'project-a'], ctx)).toBe(0);

  expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
  expect(await readFile(path.join(targetPath, 'keep.txt'), 'utf8')).toBe(
    'keep',
  );
  expect(
    await pathExists(path.join(home, 'skills', 'pdf', '1.0.0')),
  ).toBe(true);
  expect(await pathExists(targetPath)).toBe(true);
  expect((await readJson(path.join(home, 'route.json'))).targets).toEqual([]);
  expect(ctx.out.join('\n')).toContain('Removed target project-a');
});
```

- [ ] **Step 4: 运行新测试确认失败**

Run: `pnpm vitest run packages/core/src/target.test.ts packages/core/src/target-gc-failure.test.ts apps/cli/src/cli.test.ts`

Expected: FAIL。`removeTarget` 还没有清理目标目录；disabled 用例、`pdf` 真实目录断言和 CLI 清理断言失败。

- [ ] **Step 5: 修改 `removeTarget`**

在 `packages/core/src/target.ts` 增加导入：

```ts
import { gcTargetEntries, resolveTargetSkillNames } from './target-gc.js';
```

把：

```ts
const [removed] = route.targets.splice(index, 1);
await withHistory(input.paths, 'remove-target', async () => {
  await writeRouteFile(input.paths, route);
});
return removed!;
```

改成：

```ts
const removed = route.targets[index]!;
const skillNames = await resolveTargetSkillNames({
  paths: input.paths,
  target: removed,
});

route.targets.splice(index, 1);
await withHistory(input.paths, 'remove-target', async () => {
  await gcTargetEntries({
    paths: input.paths,
    target: removed,
    skillNames,
  });
  await writeRouteFile(input.paths, route);
});

return removed;
```

不要加 try/catch 回滚；GC 失败和 route 写入失败都直接抛错，route 文件保持原样。

- [ ] **Step 6: 导出模块**

在 `packages/core/src/index.ts` 的 `export * from './target.js';` 后加：

```ts
export * from './target-gc.js';
```

- [ ] **Step 7: 运行 Core 和 CLI 测试确认通过**

Run: `pnpm vitest run packages/core/src/target.test.ts packages/core/src/target-gc.test.ts packages/core/src/target-gc-failure.test.ts apps/cli/src/cli.test.ts`

Expected: PASS。

- [ ] **Step 8: 更新 CLI 描述**

把 `apps/cli/src/run.ts:811` 的：

```ts
.description('Remove a target from route.json')
```

改成：

```ts
.description(
  'Remove a target from route.json and delete its route-resolved skill directories from the target directory',
)
```

- [ ] **Step 9: 运行 CLI 测试和帮助输出确认通过**

Run: `pnpm vitest run apps/cli/src/cli.test.ts`

Expected: PASS。

Run: `pnpm dev:cli -- target remove --help`

Expected: 输出包含 `route-resolved skill directories`。

- [ ] **Step 10: 提交**

```bash
git add packages/core/src/target.ts packages/core/src/index.ts packages/core/src/target.test.ts packages/core/src/target-gc-failure.test.ts apps/cli/src/run.ts apps/cli/src/cli.test.ts
git commit -m "feat: clean target skill directories before removing target"
```

---

### Task 3: 更新移除确认文案与语言包版本

**Files:**
- Modify: `packages/shared/src/i18n-en.ts:138-139`
- Modify: `locales/zh-CN.json:6,129`

**Interfaces:**
- Consumes: 现有 `targets.confirm.removeTarget` key。
- Produces: 同一 key 的新文案；不新增 key，不改 `MessageKey` 类型。

- [ ] **Step 1: 更新英文文案**

把 `packages/shared/src/i18n-en.ts` 的：

```ts
  'targets.confirm.removeTarget':
    'Remove target "{name}" from route.json?',
```

改成：

```ts
  'targets.confirm.removeTarget':
    'Remove target "{name}"? Its route-resolved skill directories will be deleted from the target directory, even if they were not created by Skillink. Regular files and the target directory itself are kept.',
```

- [ ] **Step 2: 更新中文文案和语言包版本**

把 `locales/zh-CN.json` 的 `version` 从 `"1.0.4"` 改为 `"1.0.5"`。

把：

```json
    "targets.confirm.removeTarget": "从 route.json 中移除目标“{name}”？",
```

改成：

```json
    "targets.confirm.removeTarget": "移除目标“{name}”？该目标 route 解析出的 skill 目录会从目标目录删除，即使不是 Skillink 创建的；普通文件和目标目录本身会保留。",
```

- [ ] **Step 3: 运行 i18n 和渲染测试**

Run: `pnpm vitest run packages/shared/src/i18n.test.ts apps/desktop/src/main/bundled-language.test.ts apps/desktop/src/renderer/src/TargetsView.test.tsx`

Expected: PASS。`i18n.test.ts` 确认 `zh-CN` 覆盖全部英文 key；`bundled-language.test.ts` 确认版本比较逻辑仍通过。

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src/i18n-en.ts locales/zh-CN.json
git commit -m "chore(i18n): clarify target removal cleanup"
```

---

### Task 4: 更新架构文档、README 和全量验证

**Files:**
- Modify: `ARCHITECTURE.md:146,586-601,637-651,713-722,894-909,913-941`
- Modify: `README.md:168`

**Interfaces:**
- Consumes: Task 1-3 的最终行为。
- Produces: 与实现一致的用户/架构文档；无代码接口变化。

- [ ] **Step 1: 更新 `ARCHITECTURE.md` 关键模块表**

在关键模块表中（`core/src/package-graph.ts` 行附近）加入一行：

```md
| `core/src/target-gc.ts` | target 移除时按 route package 解析结果清理目标目录 skill 目录/链接 |
```

- [ ] **Step 2: 更新 6.7 GC**

在 `### 6.7 GC` 末尾追加：

```md
- `target remove` 的清理是独立的投影 GC：先解析 target 的全部 package lock（含 `enabled: false` 和 disabled target）得到 skill 名称集合，再删除目标目录顶层同名链接/junction 和真实目录；
- 普通文件和其他类型不处理；不在解析结果中的 extra 条目保留；
- 目标目录本身和 `skills/` 内容不删除；
- 该步骤成功后才写 `route.json`；失败时不写 route，已删除的目标目录条目不恢复。
```

- [ ] **Step 3: 更新 6.8 删除口径**

把最后一行：

```md
- 所有删除先进入 `trash/`。
```

改成：

```md
- `target remove`：解析 target 的全部 package lock（含 disabled）得到 skill 名称集合，删除目标目录中同名链接/真实目录（普通文件和其他类型跳过），成功后删除 route target；GC 失败或 route 写入失败时 route 不变并立即报错；目标目录本身和 skill 库内容保留；
- `skill` 内容删除先进入 `trash/`；target 投影的链接/目录直接删除，不进入 `trash/`。
```

- [ ] **Step 4: 更新 CLI 与 GUI 说明**

在 `### 7.1 CLI` 的 `add`/`route remove` 说明后追加：

```md
`target remove` 会先按 target 的 package 解析结果清理目标目录中的 skill 目录/链接，再删除 route 条目；普通文件、目标目录本身和 `skills/` 库内容保留。
```

把 `### 7.2 GUI` 的 Targets 条目：

```md
- **Targets**：target 列表、package 数、解析后的 skill 数、分配 package、target/package enable/disable、删除 target/route、apply 预览（dry-run）、prune、apply 结果；
```

改成：

```md
- **Targets**：target 列表、package 数、解析后的 skill 数、分配 package、target/package enable/disable、删除 target/route（删除 target 时先清理 route 解析出的 skill 目录/链接）、apply 预览（dry-run）、prune、apply 结果；
```

- [ ] **Step 5: 更新已知限制和验收标准**

在 `### 10.1 已知限制` 追加：

```md
- `target remove` 直接删除目标目录中由 route 解析出的 skill 目录/链接；GC 中途失败或 route 写入失败时，已经删除的目标目录条目不会恢复，`route.json` 保持不变。
```

在 `## 11. 验收标准` 末尾追加：

```md
28. `target remove` 解析 target 的全部 package lock（含 disabled）得到 skill 集合，删除目标目录中同名链接/真实目录，普通文件和其他类型保留；GC 失败或 route 写入失败时 route 不变并报错；目标目录和 `skills/` 内容保留。
```

- [ ] **Step 6: 更新 `README.md` GUI Targets 条目**

把 `README.md:168`：

```md
- **Targets**：添加/删除 target、分配/删除 package、target/package enable/disable、显示 package 数与解析后的 skill 数、apply 预览（dry-run）、prune、apply 结果；
```

改成：

```md
- **Targets**：添加/删除 target、分配/删除 package、target/package enable/disable、显示 package 数与解析后的 skill 数、删除 target 时先清理 route 解析出的 skill 目录/链接、apply 预览（dry-run）、prune、apply 结果；
```

- [ ] **Step 7: 全量验证**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected:
- `pnpm test` 全部通过；
- `pnpm typecheck` 无错误；
- `pnpm build` CLI 与桌面端构建成功。

- [ ] **Step 8: 提交**

```bash
git add ARCHITECTURE.md README.md
git commit -m "docs: describe target removal skill cleanup"
```

---

## Final Verification Checklist

- [ ] `resolveTargetSkillNames` 使用全部 `target.packages` lock，包含 `enabled: false`。
- [ ] disabled target 仍执行清理。
- [ ] 链接/junction 使用 `unlink` 删除，不删除库内容。
- [ ] 真实目录递归删除；普通文件和其他类型保留。
- [ ] 不在解析结果中的 extra 条目保留。
- [ ] 目标目录本身保留。
- [ ] `removeTarget` 的返回类型和 `--json` 结构不变。
- [ ] GC 失败时 route 文件不变并抛错。
- [ ] route 写入失败时 route 文件不变并抛错。
- [ ] `zh-CN.json` 版本为 `1.0.5`，中英文案 key 完整覆盖。
- [ ] 未修改 `apply` / `apply --prune` / `skillink gc` / IPC。
- [ ] 未回退或提交工作区已有的 `TargetsView` / `styles.css` 未提交改动。
