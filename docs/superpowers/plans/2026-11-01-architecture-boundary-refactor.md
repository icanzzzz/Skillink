# Skillink 模块边界与架构加固实施计划（P0–P2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变磁盘 schema 和用户可见行为的前提下，收敛 CLI/core 边界、消除 target/route 投影的重复校验、收窄 core 的公共 API，并用自动化测试锁住模块依赖方向。

**Architecture:** 三个连续阶段。P0 先提取单一职责的 target 解析/投影清理 helper、显式化 core 公共 API、加入模块边界测试；P1 把 CLI 编排从 core 移回 `apps/cli`，拆分 `run.ts`；P2 建立 config 读取层、拆分 `doctor` 与语言存储、清理 UI 重复和遗留冲突模型。每个阶段结束都是一个可独立验收的检查点。

**Tech Stack:** TypeScript 7（strict、ESM、相对导入必须带 `.js`）、pnpm 12 workspace、Vitest 5、Commander、Electron + React、Zod。

**Spec:** `ARCHITECTURE.md` §3.4“代码模块边界”；本计划 §1 记录 2026-11-01 代码审阅发现的问题。执行者必须先读这两处。

## Global Constraints

- Node 22+；包管理器固定 `pnpm@12.16.1`；所有命令从仓库根目录执行。
- TypeScript strict + `noUncheckedIndexedAccess`；相对导入保留 `.js` 后缀；不要改为 bundler 别名式导入。
- 不新增运行时依赖；不把 Electron、React、`@skillink/cli` 引入 `@skillink/core`。
- 不修改 `route.json` / `package.json` / `skill.json` / `settings.json` 的磁盘 schema，除非任务明确要求（当前只有 P2.5 删除内存中的 `ApplyConflict`，不改磁盘 schema）。
- 除了 P2.5，CLI 的 stdout/stderr 文本、`--json` 结构、退出码必须保持不变。
- 所有控制面写入继续走 `writeJsonAtomic`；所有写命令继续在 home 锁内执行；命令失败不得提交。
- Windows 优先：路径比较、大小写冲突检测、junction 行为不得弱化。
- 每个任务结尾至少运行该任务的定向测试和 `pnpm typecheck`；阶段结束运行 `pnpm test`；最终运行 `pnpm build`。
- 开始前确认工作区干净：`git status --short` 无输出。若存在用户未提交改动，先停下并确认，不要回退或覆盖。
- 每个任务单独提交，提交信息使用 `refactor(...)` / `test(...)` / `docs(...)`。

## Review Focus

1. **共享 skill 不能被误删**：route/target/package 配置变更后，只有“旧集合 − 新集合”中的 skill 投影可以删除；仍被其他启用 package 需要的 skill 必须保留。
2. **disabled 语义必须一致**：disabled target/package 的 lock 仍要参与删除清理，但不能被重新投影；enable/disable 后的图校验必须先于写文件。
3. **lock 校验不能因第一个错误而丢失报告**：`status`/`doctor` 要逐 lock 报告 `PACKAGE_INTEGRITY_MISMATCH`；`apply` 要在任何文件系统写入前失败。
4. **CLI 契约不能漂移**：拆分命令模块后，`--json` 输出、人类可读文本、退出码、失败不提交、读命令不产生提交这些行为必须保持。
5. **模块依赖方向必须可验证**：desktop 生产代码不得 import `@skillink/core`；workspace 包必须声明自己 import 的 `@skillink/*` 包；core 不得 import CLI/Electron/React。

---

## 1. 现状证据（2026-11-01）

- `pnpm typecheck` 通过；`pnpm test` 为 **56 个测试文件 / 507 个测试通过**；工作区干净。
- `packages/core/src` 有 29 个非测试模块，静态 import 检查未发现循环依赖。
- `apps/cli/src/run.ts`：1597 行、41 处 `.command()` 注册，同时包含 Commander 注册、输出、控制面初始化（`ensureHome` / `ensureDirectories` / `ensureInitialFiles` / `writeInitialSettings`）和 `init` 编排。
- `packages/core/src/git-commit.ts` 含 CLI 形状的 `withCliMutation({ commandPath, argv, ... })`，与 `ensureControlFiles` / `ensureCleanOrBootstrap` 同时存在。
- 写命令有三条编排路径：`withCliMutation`、`init` 手写 `withHomeLock`、`rollback` 内部加锁。
- Package lock 完整性校验重复 5 处：`apply.ts`、`status.ts`、`doctor.ts`、`route.ts`（`validateTargetRoute`）、`target-resolution.ts`。
- “配置变更后清理 target 投影”的 resolve → subtract → gc 模式在 `route.ts` 重复 3 处，`target.ts` 另有 2 处清理路径。
- `snapshot` 调用 `status()` + `doctor()`，`doctor()` 内部再调用 `status()`，`summarizeTargetSkills()` 再做一遍 lock/图解析。
- `packages/core/src/index.ts` 使用 `export *`；至少 20 个仅模块内部使用的函数/类型被导出（如 `findTarget`、`planMissingSkillContent`、`controlPathspec`、`getSystemDirectories`、`resolveLinkTarget`）。
- `apps/desktop` 未声明 `@skillink/core`，但 `apps/desktop/src/main/cli-adapter.test.ts` import 了它；根 `tsconfig` 与 `vitest.config.ts` 的 alias 掩盖了未声明依赖。
- 项目没有 ESLint / dependency-cruiser / 架构测试。
- 遗留面：`ApplyReport.conflicts` 永远为 `[]`；`UNMANAGED_CONFLICT` 没有生产者；CLI 退出码 3 实际不可达；`target add --mode` 描述仍写 “link or copy”。

---

## 2. 目标文件结构

```text
packages/core/src/
├─ index.ts                  # 显式导出公共 API
├─ config-store.ts           # 三份配置的只读加载（P2）
├─ initialize.ts             # 目录/初始配置/settings 初始化（P1）
├─ domain/                   # P2 可选物理移动；逻辑上先保持模块名
│  ├─ package-graph.ts
│  ├─ package-name.ts
│  ├─ skill-integrity.ts
│  ├─ skill-md.ts
│  ├─ folder-scan.ts
│  └─ skill-scan.ts
├─ target/
│  ├─ target-graph.ts        # P0 新增：唯一 target lock/图解析入口（纯函数）
│  ├─ target-resolution.ts   # P0 后只剩 summarizeTargetSkills
│  ├─ target-entry.ts
│  ├─ target-gc.ts           # P0 增加 removeObsoleteTargetSkills
│  ├─ apply.ts
│  └─ status.ts
├─ ops/
│  ├─ doctor/                # P2 拆分
│  ├─ gc.ts
│  ├─ package-check.ts
│  ├─ migrate.ts
│  └─ rollback.ts
├─ git/
│  ├─ git.ts
│  ├─ git-lock.ts
│  └─ git-commit.ts          # P1 只保留通用提交原语
└─ i18n/
   ├─ settings-store.ts      # P2
   └─ language-store.ts
```

```text
apps/cli/src/
├─ run.ts                    # P1 后只负责 program 构建、runtime、错误映射
├─ cli-context.ts            # P1
├─ command-runtime.ts        # P1
├─ specs.ts                  # P1；P2 改为使用 shared parser
├─ mutation.ts               # P1：withCliMutation
├─ commit-message.ts         # P1：CLI scope/commit message
├─ bootstrap.ts              # P1：init 编排
└─ commands/
   ├─ init.ts
   ├─ locale.ts
   ├─ skill.ts
   ├─ package.ts
   ├─ target.ts
   ├─ route.ts
   └─ lifecycle.ts           # env/snapshot/apply/status/doctor/gc/history/rollback
```

P0 不移动文件；P1 只新增 CLI 文件并缩小 `run.ts`；P2 才做 core 内部物理重排。不要在一个任务里同时移动文件和改行为。

---

# Phase P0：先消除重复与建立边界护栏

## Task P0.1: 统一 target lock 校验与 package 图解析

**Files:**
- Create: `packages/core/src/target-graph.ts`
- Modify: `packages/core/src/target-resolution.ts`
- Modify: `packages/core/src/apply.ts`
- Modify: `packages/core/src/status.ts`
- Modify: `packages/core/src/doctor.ts`
- Modify: `packages/core/src/route.ts`
- Modify: `packages/core/src/target-gc.ts`
- Modify: `packages/core/src/gc.ts`
- Test: `packages/core/src/target-graph.test.ts`

**为什么新建 `target-graph.ts`：** 现有 `target-resolution.ts` 为了 `summarizeTargetSkills` 导入 `readRouteFile`；如果 `route.ts` 反向导入 `target-resolution.ts`，会形成 `route → target-resolution → route` 循环。纯解析 helper 必须放在不依赖 route 的模块里。`target-resolution.ts` 保留 `summarizeTargetSkills`，并改为使用 `target-graph.ts`。

**Interfaces:**
- Consumes: `resolvePackageGraph`, `computePackageIntegrity` from `./package-graph.js`；`PackageFile`, `PackageLock`, `SkillFile`, `TargetRoute`, `SkillinkError` from `@skillink/shared`。
- Produces:
  ```ts
  export interface TargetLockCheck {
    name: string;
    lock: PackageLock;
    error?: SkillinkError;
  }

  export function checkTargetPackageLocks(
    packageFile: PackageFile,
    target: TargetRoute,
    options?: { includeDisabled?: boolean },
  ): TargetLockCheck[];

  export function assertTargetPackageLocks(
    packageFile: PackageFile,
    target: TargetRoute,
  ): void;

  export function resolveTargetGraph(
    packageFile: PackageFile,
    skillFile: SkillFile,
    target: TargetRoute,
    options?: { includeDisabledPackages?: boolean },
  ): PackageResolution;

  export function resolveTarget(
    packageFile: PackageFile,
    skillFile: SkillFile,
    target: TargetRoute,
    options?: { includeDisabledPackages?: boolean },
  ): PackageResolution;
  ```
- `checkTargetPackageLocks` 默认只检查 `enabled !== false` 的 lock；`includeDisabled: true` 时检查全部。每个 lock 的校验错误放入 `error`：完整性不匹配时错误码为 `PACKAGE_INTEGRITY_MISMATCH`（details 保留 `{ name, version, expected, actual }`）；`computePackageIntegrity` 抛出的缺失/环错误原样保留，不能吞掉。
- `assertTargetPackageLocks` 抛出第一个 `error`。
- `resolveTargetGraph` 默认只把 `enabled !== false` 的 lock 作为根；`includeDisabledPackages: true` 时把全部 lock 作为根。它不检查 `target.enabled`，由调用方决定。
- `resolveTarget` 先 `assertTargetPackageLocks`，再 `resolveTargetGraph`。

- [ ] **Step 1: 在 `target-graph.test.ts` 写失败测试**

添加以下行为（沿用现有 `target-resolution.test.ts` 的临时 home/package/skill fixture 风格；测试只构造 `PackageFile` / `SkillFile` / `TargetRoute` 对象，不读文件系统）：

```ts
it('reports every invalid lock without throwing', () => {
  const checks = checkTargetPackageLocks(packageFile, target, {
    includeDisabled: true,
  });
  expect(checks.map((check) => check.name)).toEqual(['base', 'ui']);
  expect(checks[1]?.error?.code).toBe('PACKAGE_INTEGRITY_MISMATCH');
});

it('rejects a lock mismatch from resolveTarget', () => {
  expect(() => resolveTarget(packageFile, skillFile, target)).toThrowError(
    expect.objectContaining({ code: 'PACKAGE_INTEGRITY_MISMATCH' }),
  );
});

it('excludes disabled packages by default and includes them on request', () => {
  expect([...resolveTargetGraph(packageFile, skillFile, target).skills.keys()])
    .toEqual(['pdf']);
  expect([
    ...resolveTargetGraph(packageFile, skillFile, target, {
      includeDisabledPackages: true,
    }).skills.keys(),
  ]).toEqual(['pdf', 'review']);
});

it('propagates skill version conflicts from the target graph', () => {
  expect(() => resolveTargetGraph(packageFile, skillFile, conflictingTarget))
    .toThrowError(expect.objectContaining({ code: 'SKILL_VERSION_CONFLICT' }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/src/target-graph.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 在 `target-graph.ts` 实现四个函数**

只做纯配置解析，不读文件系统、不处理 target 路径。`checkTargetPackageLocks` 内对每个候选 lock 调用 `computePackageIntegrity(packageFile, [{ name, version: lock.resolved }])`，与 `lock.integrity` 比较。

- [ ] **Step 4: 迁移调用方**

- `apply.ts`：删除本地 `validatePackageLocks`；`planTarget` 中用 `resolveTarget(packageFile, skillFile, target)` 替换 lock 校验 + `roots` + `resolvePackageGraph`。
- `status.ts`：删除本地 lock 循环与 `computePackageIntegrity` 导入；先保留 disabled 条目，再用 `checkTargetPackageLocks(packageFile, target)` 生成逐 lock 错误条目；全部通过后用 `resolveTargetGraph`。
- `doctor.ts`：用 `checkTargetPackageLocks(packageFile, target, { includeDisabled: true })` 生成 `PACKAGE_INTEGRITY_MISMATCH` issue（保留 `targetId`）；`referencedPackages` 用 `resolveTargetGraph(..., { includeDisabledPackages: true })`；启用根校验用默认参数。
- `route.ts` 的 `validateTargetRoute`：改为从 `./target-graph.js` 导入 `assertTargetPackageLocks` + `resolveTargetGraph`。
- `target-gc.ts`：从 `./target-graph.js` 导入 `resolveTargetGraph`；`resolveTargetSkillNames` 用 `includeDisabledPackages: true`；`resolveTargetActiveSkillNames` 保持 `!target.enabled` 返回 `[]`，否则默认参数；`resolvePackageSkillNames` 继续用 `resolvePackageGraph`。
- `gc.ts`：每个 target 的 `roots` 解析改为 `resolveTargetGraph(packageFile, skillFile, target, { includeDisabledPackages: true })`。
- `target-resolution.ts` 的 `summarizeTargetSkills`：从 `./target-graph.js` 导入 `checkTargetPackageLocks` 与 `resolveTargetGraph`，替换手写循环；若 checks 中存在 `error`，抛出第一个 error，再由现有 catch 生成 `{ error: "CODE: message" }`。不要从 `target-graph.ts` 反向导入 `route.ts`。

- [ ] **Step 5: 运行定向测试与类型检查**

Run:
```bash
pnpm exec vitest run packages/core/src/target-graph.test.ts packages/core/src/target-resolution.test.ts packages/core/src/apply.test.ts packages/core/src/status.test.ts packages/core/src/doctor.test.ts packages/core/src/route.test.ts packages/core/src/target-gc.test.ts packages/core/src/gc.test.ts
pnpm typecheck
```
Expected: 全部 PASS；`target-graph.ts` 的 import 中不得出现 `./route.js`。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src
git commit -m "refactor(core): centralize target lock validation and graph resolution"
```

## Task P0.2: 收敛“配置变更后清理 target 投影”逻辑

**Files:**
- Modify: `packages/core/src/target-gc.ts`
- Modify: `packages/core/src/route.ts`
- Test: `packages/core/src/target-gc.test.ts`

**Interfaces:**
- Consumes: P0.1 的 `resolveTargetGraph`；现有 `resolveTargetActiveSkillNames`、`subtractSkillNames`、`gcTargetEntries`。
- Produces:
  ```ts
  export interface RemoveObsoleteTargetSkillsInput {
    paths: SkillinkPaths;
    target: TargetRoute;
    previousSkillNames: Iterable<string>;
  }

  export async function removeObsoleteTargetSkills(
    input: RemoveObsoleteTargetSkillsInput,
  ): Promise<string[]>;
  ```
- 行为：`previousSkillNames` 为空直接返回 `[]`；解析当前活跃 skill 失败时返回 `[]`（保留现有“解析失败跳过投影 GC，配置继续写”的语义）；只删除 `previous − current`，返回实际删除的 skill 名。

- [ ] **Step 1: 在 `target-gc.test.ts` 写失败测试**

```ts
it('removes only skills that are no longer required', async () => {
  const removed = await removeObsoleteTargetSkills({
    paths,
    target,
    previousSkillNames: ['pdf', 'review'],
  });

  expect(removed).toEqual(['pdf']);
  expect(await pathExists(path.join(target.path, 'review'))).toBe(true);
  expect(await pathExists(path.join(target.path, 'pdf'))).toBe(false);
});

it('skips projection deletion when the remaining graph cannot resolve', async () => {
  const removed = await removeObsoleteTargetSkills({
    paths,
    target: brokenTarget,
    previousSkillNames: ['pdf'],
  });

  expect(removed).toEqual([]);
  expect(await pathExists(path.join(brokenTarget.path, 'pdf'))).toBe(true);
});

it('removes all previous skills for a disabled target', async () => {
  const removed = await removeObsoleteTargetSkills({
    paths,
    target: { ...target, enabled: false },
    previousSkillNames: ['pdf', 'review'],
  });

  expect(removed).toEqual(['pdf', 'review']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/src/target-gc.test.ts`
Expected: FAIL，提示 `removeObsoleteTargetSkills` 未导出。

- [ ] **Step 3: 在 `target-gc.ts` 实现 helper**

实现顺序：遍历 `previousSkillNames` → 若为空返回 `[]` → `try { const remaining = await resolveTargetActiveSkillNames({ paths, target }); ... } catch { return []; }` → `subtractSkillNames` → `gcTargetEntries`。

- [ ] **Step 4: 替换 `route.ts` 的三处重复块**

- `addRouteEntry`：保留 `previousSkills = resolvePackageSkillNames(...)`；把原 `resolveTargetActiveSkillNames` + `subtractSkillNames` + `gcTargetEntries` 替换为一次 `removeObsoleteTargetSkills({ paths, target: candidate, previousSkillNames: previousSkills })`。
- `setPackageEnabled`：保留“只有 `target.enabled` 且本次是 disable 时才计算 `removedSkills`”的条件；替换后续 resolve/subtract/gc 块。
- `removeRouteEntry`：保留 `removedSkills = resolvePackageSkillNames(...)`；删除 lock 后调用一次 helper。

不要改变写 `route.json` 的时机：仍先完成投影清理，再 `writeRouteFile`；helper 吞掉解析错误，但文件系统删除错误继续抛出。

- [ ] **Step 5: 运行定向测试与类型检查**

Run:
```bash
pnpm exec vitest run packages/core/src/target-gc.test.ts packages/core/src/route.test.ts packages/core/src/target.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/target-gc.ts packages/core/src/target-gc.test.ts packages/core/src/route.ts
git commit -m "refactor(core): extract obsolete target projection cleanup"
```

## Task P0.3: 显式化 core 公共 API

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/public-api.test.ts`（新建）

**Interfaces:**
- Consumes: 各模块现有导出。
- Produces: 仅以下运行时符号可从 `@skillink/core` 导入（类型不在此列表；调用方直接从 `@skillink/shared` 导入类型）：

```text
apply
doctor
gc
planGc
gitAddAll
gitCommit
gitHead
gitLog
gitRepoExists
gitShowFile
gitStatus
ensureControlRepo
ensureSkillsRepo
isGitAvailable
assertCleanControlRepo
commitRepoChanges
ensureCleanOrBootstrap
withHomeLock
withCliMutation
importSkill
stableStringify
getLanguageState
installLanguagePack
removeLanguagePack
setActiveLocale
readSettingsFile
writeSettingsFile
migrateV1ToV2
checkPackageSkillReferences
createPackageVersion
copyPackageVersion
readPackageFile
removePackageVersion
setPackageTag
writePackageFile
addRouteEntry
readRouteFile
removeRouteEntry
setPackageEnabled
writeRouteFile
rollbackTo
scanSkillPackages
readSkillFile
removeSkillVersion
setSkillTag
writeSkillFile
status
addTarget
removeTarget
setTargetEnabled
summarizeTargetSkills
```

`readSettingsFile` 在 P2.3 会移到 `settings-store.ts`，但公共名称保持不变。

- [ ] **Step 1: 写 `public-api.test.ts` 的失败测试**

```ts
import * as core from './index.js';

it('exposes the documented core surface', () => {
  expect(core.apply).toBeTypeOf('function');
  expect(core.resolveTarget).toBeUndefined();
  expect(core.removeObsoleteTargetSkills).toBeUndefined();
  expect(core.findTarget).toBeUndefined();
  expect(core.planMissingSkillContent).toBeUndefined();
  expect(core.resolveLinkTarget).toBeUndefined();
});
```

`withCliMutation` 暂不在这个断言里：P0.3 时它仍是 CLI 的公共依赖，P1.1 移走后再把断言加回来。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/src/public-api.test.ts`
Expected: FAIL，因为当前 `export *` 暴露了 `findTarget` / `planMissingSkillContent` / `resolveLinkTarget` 等内部 helper。

- [ ] **Step 3: 改写 `packages/core/src/index.ts`**

删除所有 `export *`。按模块分组写显式导出；类型一律从 `@skillink/shared` 导入，不在 core index 再导出 shared 类型。内部 helper 即使仍被其他 core 模块使用，也不进入 index。

- [ ] **Step 4: 修复调用方**

Run: `pnpm typecheck`
逐个修复缺失导出。预期只修改 `apps/cli/src/run.ts` 和测试；如果发现 core 内部文件误从 `@skillink/core` 导入自己，改为相对路径。

- [ ] **Step 5: 运行定向测试与完整测试**

Run:
```bash
pnpm exec vitest run packages/core/src/public-api.test.ts
pnpm test
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/index.ts packages/core/src/public-api.test.ts apps/cli/src
git commit -m "refactor(core): publish an explicit public API"
```

## Task P0.4: 加入模块边界测试并移除未声明的 core 依赖

**Files:**
- Create: `packages/core/src/module-boundaries.test.ts`
- Modify: `apps/desktop/src/main/cli-adapter.test.ts`

**Interfaces:**
- Consumes: Node `fs/promises`、`path`、`url`；workspace 各包 `package.json`。
- Produces: 一个在 `pnpm test` 中自动运行的架构测试，失败信息格式为 `<relative file>: <import specifier> (<rule>)`。

规则：

| 范围 | 禁止 |
|---|---|
| `packages/shared/src` | `@skillink/core`、`@skillink/cli`、`@skillink/desktop` |
| `packages/core/src` | `@skillink/cli`、`@skillink/desktop`、`electron`、`react`、`react-dom` |
| `apps/cli/src` | `electron`、`react`、`react-dom` |
| `apps/desktop/src/main`、`apps/desktop/src/preload` | `@skillink/core` |
| `apps/desktop/src/renderer` | `@skillink/core`、`electron`、`node:*`、`../main/`、`../preload/` |

另外：对每个 workspace 包（`apps/cli`、`apps/desktop`、`packages/core`、`packages/shared`），扫描 `src/**/*.{ts,tsx}` 中的 `from '@skillink/<name>...'`，断言该包名出现在自身 `dependencies`、`devDependencies` 或 `peerDependencies` 中。`@skillink/cli/run` 归一化为 `@skillink/cli`。

- [ ] **Step 1: 写测试，先让它失败**

测试骨架：

```ts
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'out' ||
      entry.name === 'dist' ||
      entry.name === 'release'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}
```

测试名：
- `keeps desktop main and preload free of @skillink/core`
- `prevents core from importing CLI, Electron, or React`
- `prevents renderer from importing Node, Electron, or core`
- `declares every workspace cross-package import`

Run: `pnpm exec vitest run packages/core/src/module-boundaries.test.ts`
Expected: FAIL，明确指向 `apps/desktop/src/main/cli-adapter.test.ts: @skillink/core (desktop-core)`。

- [ ] **Step 2: 修复 `cli-adapter.test.ts`**

删除 `import { isGitAvailable } from '@skillink/core';`，在测试文件内用 `node:child_process` 实现本地检查：

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

const gitReady = await gitAvailable();
```

不要给 `apps/desktop/package.json` 增加 `@skillink/core`：desktop 的生产边界仍然是不依赖 core。

- [ ] **Step 3: 运行边界测试与类型检查**

Run:
```bash
pnpm exec vitest run packages/core/src/module-boundaries.test.ts apps/desktop/src/main/cli-adapter.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/module-boundaries.test.ts apps/desktop/src/main/cli-adapter.test.ts
git commit -m "test: enforce workspace module boundaries"
```

**P0 验收：** `pnpm test`、`pnpm typecheck` 通过；任意 core target 解析只有一个入口；route 投影清理只有一个 helper；core 公共 API 不再包含内部 helper；边界测试能阻止 desktop/core 违规依赖。

---

# Phase P1：把 CLI 编排移回 CLI，拆分 run.ts

## Task P1.1: 把 `withCliMutation` 与 commit message 构建移出 core

**Files:**
- Modify: `packages/core/src/git-commit.ts`
- Modify: `packages/core/src/rollback.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/git-commit.test.ts`
- Create: `apps/cli/src/commit-message.ts`
- Create: `apps/cli/src/commit-message.test.ts`
- Create: `apps/cli/src/mutation.ts`
- Create: `apps/cli/src/mutation.test.ts`
- Modify: `apps/cli/src/run.ts`

**Interfaces:**
- Core produces:
  ```ts
  export interface RepoCommitOptions {
    paths: SkillinkPaths;
    repo: GitRepo;
    message?: string;
    buildMessage?: (changedFiles: string[]) => string;
    pathspec?: string[];
  }

  export function buildCommitMessage(input: {
    scope: string;
    action: string;
    summary?: string;
    command?: string;
    changedFiles: string[];
  }): string;

  export async function commitRepoChanges(
    options: RepoCommitOptions,
  ): Promise<string | undefined>;

  export async function ensureCleanOrBootstrap(
    paths: SkillinkPaths,
  ): Promise<void>;
  ```
  `commitRepoChanges` 必须在缺少 `message` 与 `buildMessage` 时抛出 `IO_ERROR`。`ensureCleanOrBootstrap` 不再接收 `argv`，baseline 使用固定消息 `skillink(init): initialize control plane` / `skillink(skills): initialize skills`。

- CLI produces:
  ```ts
  export interface CliMutationOptions<T> {
    paths: SkillinkPaths;
    commandPath: string;
    argv: string[];
    action?: string;
    summary: string | ((result: T) => string);
    skills?: boolean;
    commit?: boolean;
    lockOptions?: HomeLockOptions;
  }

  export async function withCliMutation<T>(
    options: CliMutationOptions<T>,
    task: () => Promise<T>,
  ): Promise<T>;

  export function inferScope(
    commandPath: string,
    changedFiles: string[],
  ): string;

  export function buildCliCommitMessage(input: {
    repo: GitRepo;
    commandPath: string;
    argv: string[];
    action?: string;
    summary?: string;
    changedFiles: string[];
  }): string;
  ```
  `buildCliCommitMessage` 的 `Command:` 行只在 `argv.length > 0` 时输出；skills 仓库强制 scope 为 `skills`。

- [ ] **Step 1: 把消息测试移到 CLI 并改红**

从 `packages/core/src/git-commit.test.ts` 的 `describe('commit messages')` 复制到 `apps/cli/src/commit-message.test.ts`，导入改为：

```ts
import { buildCliCommitMessage, inferScope } from './commit-message.js';
```

保持原断言（scope 推断、Command 行、Changed 列表、72 字符截断、20 个文件截断）。先运行：

`pnpm exec vitest run apps/cli/src/commit-message.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 2: 创建 `apps/cli/src/commit-message.ts`**

从 core 复制 `COMMAND_SCOPES`、`inferScope`、`fileScope`、`truncateList`、`truncateSubject`，并实现 `buildCliCommitMessage`：调用 core 的 `buildCommitMessage` 生成主体，`command` 为 `['skillink', ...argv].join(' ')`。

- [ ] **Step 3: 把 mutation 测试移到 CLI**

从 core `git-commit.test.ts` 的 `describe.skipIf(!gitReady)('repository commits')` 中，把以下用例移到 `apps/cli/src/mutation.test.ts`：
`rejects a dirty control repository before a mutation`、`commits skills before the control plane`、`skips commits for read-only mutations but still locks`、`does not commit when the mutation fails`。
导入改为 `import { withCliMutation } from './mutation.js';`，其余 core git 原语从 `@skillink/core` 导入。

先运行：`pnpm exec vitest run apps/cli/src/mutation.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 创建 `apps/cli/src/mutation.ts`**

实现 `withCliMutation`：`withHomeLock` → `commit === false` 直接执行 → `ensureCleanOrBootstrap(paths)` → 执行 task → 解析 summary → 需要时用 `buildCliCommitMessage` 提交 skills → 提交 control。

- [ ] **Step 5: 收缩 core `git-commit.ts` 与 `rollback.ts`**

- `git-commit.ts` 删除 `withCliMutation`、`inferScope`、`fileScope`、`truncateList`、`COMMAND_SCOPES`；保留 `buildCommitMessage`（通用版本）、`commitRepoChanges`、`assertCleanControlRepo`、`ensureCleanOrBootstrap`。
- `rollback.ts` 的两处 `commitRepoChanges` 改为传 `buildMessage`：
  ```ts
  buildMessage: (changedFiles) => buildCommitMessage({
    scope: 'skills',
    action: 'restore',
    summary: shortRevision,
    command: `skillink rollback ${input.revision}`,
    changedFiles,
  })
  ```
  control 提交使用 `scope: 'rollback'`。
- `core/index.ts` 删除 `withCliMutation`、`inferScope`、`buildControlCommitMessage`、`buildSkillsCommitMessage`、`truncateList`；保留 `buildCommitMessage`。
- `run.ts` 改为从 `./mutation.js` 导入 `withCliMutation`。
- 在 `packages/core/src/public-api.test.ts` 增加 `expect(core.withCliMutation).toBeUndefined();` 与 `expect(core.inferScope).toBeUndefined();`。

- [ ] **Step 6: 更新 core 仓库测试并运行**

`packages/core/src/git-commit.test.ts`：
- 删除 message 测试和 mutation 测试；
- `ensureCleanOrBootstrap(paths, [...])` 改为 `ensureCleanOrBootstrap(paths)`；
- `commitRepoChanges({ commandPath, argv, action, summary })` 改为 `commitRepoChanges({ paths, repo, buildMessage: (files) => buildCommitMessage({ scope, action, summary, changedFiles: files }) })`；
- 保留“stray untracked files”“only when changed”“bootstrap complete control plane”等 core 行为测试。

Run:
```bash
pnpm exec vitest run packages/core/src/git-commit.test.ts packages/core/src/public-api.test.ts apps/cli/src/commit-message.test.ts apps/cli/src/mutation.test.ts apps/cli/src/cli-git.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src apps/cli/src
git commit -m "refactor: move CLI mutation orchestration out of core"
```

## Task P1.2: 把控制面初始化收进 core，并拆出 CLI bootstrap

**Files:**
- Create: `packages/core/src/initialize.ts`
- Modify: `packages/core/src/git-commit.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/initialize.test.ts`
- Create: `apps/cli/src/bootstrap.ts`
- Modify: `apps/cli/src/run.ts`

**Interfaces:**
- Core produces:
  ```ts
  export async function ensureDirectories(paths: SkillinkPaths): Promise<void>;
  export async function ensureControlFiles(paths: SkillinkPaths): Promise<void>;
  export async function ensureHome(paths: SkillinkPaths): Promise<void>;
  export async function writeInitialSettings(paths: SkillinkPaths): Promise<void>;
  ```
  `ensureHome` 的行为与当前 `run.ts` 一致：创建 home/locales/library/cache/logs/tmp；若存在 v1 `skills.json` 且不存在 v2 `skill.json`，抛出 `IO_ERROR` 并提示运行 `init`/`migrate`；随后只补建缺失的三份配置文件（不重写已有文件）。
- CLI produces:
  ```ts
  export interface InitializeHomeResult {
    migrated: boolean;
    skillCount: number;
    packageCount: number;
    targetCount: number;
  }

  export async function initializeHome(
    paths: SkillinkPaths,
    argv: string[],
  ): Promise<InitializeHomeResult>;
  ```

`init` 是 bootstrap 事务，仍显式使用 `withHomeLock`；不要为了“统一”而把 migration/baseline 改造成可重入的 `withCliMutation`。普通写命令统一走 `withCliMutation`；`rollbackTo` 继续作为自带锁的事务级操作。P2.5 在文档中明确这三类边界。

- [ ] **Step 1: 写 core 初始化测试**

`packages/core/src/initialize.test.ts`：
```ts
it('creates missing control files without rewriting existing files', async () => {
  await ensureHome(paths);
  const before = await readFile(paths.routeFile, 'utf8');
  await ensureHome(paths);
  expect(await readFile(paths.routeFile, 'utf8')).toBe(before);
});

it('refuses a v1 home until init or migrate runs', async () => {
  await writeFile(paths.skillsFile, '{"schemaVersion":1,"packages":{}}');
  await expect(ensureHome(paths)).rejects.toMatchObject({ code: 'IO_ERROR' });
});
```
Run: `pnpm exec vitest run packages/core/src/initialize.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 2: 创建 `initialize.ts` 并迁移实现**

从 `run.ts` 迁移 `pathExists`、`ensureDirectories`、`ensureInitialFiles`、`writeInitialSettings`、`ensureHome`；从 `git-commit.ts` 迁移 `ensureControlFiles`。`git-commit.ts` 改为 `import { ensureControlFiles } from './initialize.js';`，删除本地实现。

在 `core/index.ts` 显式导出 `ensureDirectories`、`ensureHome`、`writeInitialSettings`；`ensureControlFiles` 和 `pathExists` 保持内部，不进入公共 API。

- [ ] **Step 3: 创建 `apps/cli/src/bootstrap.ts`**

把 `run.ts` 的 `init` action 主体迁移到 `initializeHome`：git 可用检查、`withHomeLock`、dirty 检查、`writeInitialSettings`、v1 迁移或补建文件、`ensureControlRepo`、`ensureSkillsRepo`、两次 baseline 提交。提交使用 `buildCliCommitMessage` 与 `commitRepoChanges`；skills 提交失败时不提交 control。

- [ ] **Step 4: 修改 `run.ts`**

- 删除本地初始化 helper 与 `node:fs/promises` 中的 `mkdir`/`stat` 导入（如果不再需要）。
- `init` action 只保留：
  ```ts
  const paths = runtime.paths();
  const result = await initializeHome(paths, argv);
  // 原有 JSON/人类输出保持不变
  ```
- 其他命令的 `ensureHome` 改为从 `@skillink/core` 导入 `ensureHome`。

- [ ] **Step 5: 运行定向测试**

Run:
```bash
pnpm exec vitest run packages/core/src/initialize.test.ts packages/core/src/git-commit.test.ts apps/cli/src/run.test.ts
pnpm exec vitest run apps/cli/src/cli.test.ts -t "init"
pnpm typecheck
```
Expected: 全部 PASS；`init` 的 JSON 输出、migration 计数、dirty 拒绝行为不变。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src apps/cli/src
git commit -m "refactor: centralize control plane initialization"
```

## Task P1.3a: 提取 CLI runtime、context 与 skill/package 命令

**Files:**
- Create: `apps/cli/src/cli-context.ts`
- Create: `apps/cli/src/command-runtime.ts`
- Create: `apps/cli/src/specs.ts`
- Create: `apps/cli/src/commands/skill.ts`
- Create: `apps/cli/src/commands/package.ts`
- Modify: `apps/cli/src/run.ts`

**Interfaces:**
- `cli-context.ts` produces:
  ```ts
  export interface CliContext { home?: string; stdout: (line: string) => void; stderr: (line: string) => void; json?: boolean; }
  export function printJson(context: CliContext, value: unknown): void;
  export function printJsonError(context: CliContext, code: string, message: string, details?: unknown): void;
  export function addCommonOptions(command: Command): Command;
  ```
- `command-runtime.ts` produces:
  ```ts
  export interface CommandRuntime {
    context: CliContext;
    argv: string[];
    jsonMode: boolean;
    paths(): SkillinkPaths;
    ensureHome(): Promise<SkillinkPaths>;
    mutate<T>(
      paths: SkillinkPaths,
      commandPath: string,
      action: string,
      summary: string | ((result: T) => string),
      task: () => Promise<T>,
      options?: { skills?: boolean; commit?: boolean },
    ): Promise<T>;
    setExitCode(code: number): void;
  }
  ```
- `specs.ts` produces `parseSpec`、`asArray`、`collectSpecs`（P2.4 改为使用 shared parser）。
- `commands/skill.ts` produces `registerSkillCommands(program: Command, runtime: CommandRuntime): void`。
- `commands/package.ts` produces `registerPackageCommands(program: Command, runtime: CommandRuntime): void`。

- [ ] **Step 1: 写一个 runtime 的失败测试**

在 `apps/cli/src/run.test.ts` 增加：
```ts
it('exposes paths and home initialization through the command runtime', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'skillink-runtime-'));
  const context = { home, stdout: () => undefined, stderr: () => undefined };
  const runtime = createCommandRuntime(context, ['env'], () => undefined);
  expect(runtime.paths().home).toBe(path.resolve(home));
  await runtime.ensureHome();
  await expect(stat(runtime.paths().routeFile)).resolves.toBeDefined();
});
```
`createCommandRuntime` 的签名为 `(context: CliContext, argv: string[], setExitCode: (code: number) => void) => CommandRuntime`。
Run: `pnpm exec vitest run apps/cli/src/run.test.ts`
Expected: FAIL，函数不存在。

- [ ] **Step 2: 创建三个基础文件**

`cli-context.ts` 从 `run.ts` 迁移 `CliContext`、`printJson`、`printJsonError`、`addCommonOptions`。`specs.ts` 迁移 `parseSpec`、`asArray`、`collectSpecs`。`command-runtime.ts` 实现 `createCommandRuntime`，内部调用 `getSkillinkPaths`、core `ensureHome`、`withCliMutation`。

- [ ] **Step 3: 迁移 skill 与 package 命令**

把 `run.ts` 中 `skill` 组（list/scan/add/tag/remove、顶层 `add` 别名）与 `package` 组（list/create/copy/tag/remove/check）整体移入对应 registrar。保持：
- `--json` 输出对象不变；
- `skill add`/`remove` 使用 `skills: true`；
- `package check` 使用 `commit: false`，失败时 `runtime.setExitCode(1)`；
- `parseSpec` 的错误仍为 `ROUTE_INVALID`；
- `add` 顶层别名指向同一个 action。

- [ ] **Step 4: `run.ts` 接入 registrar**

保留 `runCli` 的 program 构建、`exitCode` 变量、try/catch 错误映射。创建 runtime 后调用 `registerSkillCommands`、`registerPackageCommands`。

- [ ] **Step 5: 运行定向测试**

Run:
```bash
pnpm exec vitest run apps/cli/src/run.test.ts apps/cli/src/cli.test.ts apps/cli/src/cli-git.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/cli/src
git commit -m "refactor(cli): extract skill and package command modules"
```

## Task P1.3b: 提取 target 与 route 命令

**Files:**
- Create: `apps/cli/src/commands/target.ts`
- Create: `apps/cli/src/commands/route.ts`
- Modify: `apps/cli/src/run.ts`

**Interfaces:**
- `registerTargetCommands(program: Command, runtime: CommandRuntime): void`
- `registerRouteCommands(program: Command, runtime: CommandRuntime): void`

- [ ] **Step 1: 迁移 target 组**

把 `target add/list/remove/enable/disable` 移入 `commands/target.ts`。保持：
- `target add --mode` 仍作为参数传给 `addTarget`，copy 仍由 core 拒绝；
- `target remove`/`disable` 的写命令提交行为不变；
- `target list` 的 JSON 仍是 `route.targets` 数组。

- [ ] **Step 2: 迁移 route 组**

把 `route add/list/enable/disable/remove` 移入 `commands/route.ts`。保持：
- `route remove --force` 传递；
- `route add` 的 `PackageLock` JSON 输出不变；
- `route list` 的人类输出格式不变。

- [ ] **Step 3: 接入 `run.ts` 并运行测试**

Run:
```bash
pnpm exec vitest run apps/cli/src/cli.test.ts apps/cli/src/cli-git.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/cli/src
git commit -m "refactor(cli): extract target and route command modules"
```

## Task P1.3c: 提取 lifecycle、locale、init 命令并收尾 `run.ts`

**Files:**
- Create: `apps/cli/src/commands/lifecycle.ts`
- Create: `apps/cli/src/commands/locale.ts`
- Create: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/run.ts`

**Interfaces:**
- `registerLifecycleCommands(program: Command, runtime: CommandRuntime): void`：`env`、`snapshot`、`apply`、`status`、`doctor`、`gc`、`history`、`rollback`。
- `registerLocaleCommands(program: Command, runtime: CommandRuntime): void`：`locale list/install/use/remove`。
- `registerInitCommands(program: Command, runtime: CommandRuntime): void`：`init`、`migrate`。

- [ ] **Step 1: 迁移 lifecycle**

保持：
- `apply`  conflicts 相关逻辑在 P2.5 前保持原样；`--json` 输出、退出码 3 分支暂不改；
- `status`/`doctor` 不健康时 `runtime.setExitCode(1)`；
- `gc` 默认 dry-run，`--apply` 才提交；
- `rollback` 仍调用 `rollbackTo`，不在 CLI 外层加锁。

- [ ] **Step 2: 迁移 locale 与 init/migrate**

保持语言包输出、`locale use` 不提交（`commit: false`）、`init` 调用 `initializeHome`、`migrate` 的 `commit` 行为不变。

- [ ] **Step 3: 收尾 `run.ts`**

`run.ts` 最终只保留：
- `runCli` 签名与默认 context；
- `jsonMode` 计算；
- program 基础配置；
- runtime 创建；
- 各 registrar 调用；
- `parseAsync` 与错误映射；
- `addCommonOptions` 不再留在 `run.ts`。

目标：`run.ts` 小于 250 行；不得再直接 import `node:fs/promises`、`@skillink/core` 的具体业务函数（`withCliMutation` 除外，应通过 runtime）。

- [ ] **Step 4: 运行完整 CLI 测试**

Run:
```bash
pnpm exec vitest run apps/cli/src/run.test.ts apps/cli/src/cli.test.ts apps/cli/src/cli-git.test.ts apps/cli/src/commit-message.test.ts apps/cli/src/mutation.test.ts
pnpm typecheck
```
Expected: 全部 PASS；`wc -l apps/cli/src/run.ts` 显示小于 250 行。

- [ ] **Step 5: 提交**

```bash
git add apps/cli/src
git commit -m "refactor(cli): finish command module split"
```

## Task P1.4: 让 `snapshot` 复用一次 status，避免重复扫描

**Files:**
- Modify: `packages/core/src/doctor.ts`
- Modify: `apps/cli/src/commands/lifecycle.ts`（P1.3c 后；若尚未拆分则改 `run.ts`）
- Test: `packages/core/src/doctor.test.ts`

**Interfaces:**
- `DoctorInput` 增加：
  ```ts
  statusReport?: StatusReport;
  ```
- `doctor()` 使用 `input.statusReport ?? await status({ paths })`，不再无条件调用 `status()`。
- `snapshot` 先在并行批次外计算一次 `statusReport`，再并行读取配置、`doctor({ paths, statusReport })`、`summarizeTargetSkills()`。

- [ ] **Step 1: 写失败测试**

在 `doctor.test.ts` 添加：
```ts
it('uses a provided status report instead of rescanning targets', async () => {
  const report = await doctor({
    paths,
    statusReport: {
      healthy: false,
      entries: [
        {
          targetId: 'project-a',
          targetPath: paths.home,
          name: 'fake-skill',
          version: '1.0.0',
          state: 'missing',
          path: paths.home,
        },
      ],
    },
  });

  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: 'LINK_ISSUE', name: 'fake-skill' }),
  );
});
```
Run: `pnpm exec vitest run packages/core/src/doctor.test.ts`
Expected: FAIL（当前 `doctor` 会重新扫描真实 target，不会报告 `fake-skill`）。

- [ ] **Step 2: 实现 `statusReport` 复用**

在 `doctor.ts` 末尾改为 `const currentStatus = input.statusReport ?? (await status({ paths }));`。不要改变 issue 生成顺序。

- [ ] **Step 3: 修改 snapshot**

`snapshot` 的流程改为：
```ts
const paths = runtime.paths();
const statusReport = await status({ paths });
const [skills, packages, route, doctorReport, targetSkills] = await Promise.all([
  readSkillFile(paths),
  readPackageFile(paths),
  readRouteFile(paths),
  doctor({ paths, statusReport }),
  summarizeTargetSkills({ paths }),
]);
```
保持输出对象字段与顺序不变。

- [ ] **Step 4: 运行测试**

Run:
```bash
pnpm exec vitest run packages/core/src/doctor.test.ts packages/core/src/status.test.ts apps/cli/src/cli.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/doctor.ts packages/core/src/doctor.test.ts apps/cli/src
git commit -m "perf(core): reuse status when building doctor reports"
```

**P1 验收：** `run.ts` 小于 250 行且只做注册/错误映射；`withCliMutation` 与 commit message 构建位于 `apps/cli`；core 的 `git-commit.ts` 不再知道 `commandPath`/`argv`；`init` 使用 core 初始化原语；`snapshot` 只扫描一次 target。

---

# Phase P2：领域读取层、模块拆分与遗留清理

## Task P2.1: 建立 config 读取层，移除 store 之间的直接文件读取

**Files:**
- Create: `packages/core/src/config-store.ts`
- Modify: `packages/core/src/route.ts`
- Modify: `packages/core/src/package-store.ts`
- Modify: `packages/core/src/skill-store.ts`
- Test: `packages/core/src/config-store.test.ts`

**Interfaces:**
- `config-store.ts` produces:
  ```ts
  export async function readRouteConfig(paths: SkillinkPaths): Promise<RouteFile>;
  export async function readPackageConfig(paths: SkillinkPaths): Promise<PackageFile>;
  export async function readSkillConfig(paths: SkillinkPaths): Promise<SkillFile>;
  ```
  只依赖 `@skillink/shared` 与 `./json-store.js`；不导入任何领域模块。缺失文件返回对应的空配置；JSON/schema 错误继续由 `readJsonFile` 抛出 `IO_ERROR`。

- [ ] **Step 1: 写失败测试**

`config-store.test.ts`：
```ts
it('returns an empty route when the file is missing', async () => {
  await expect(readRouteConfig(paths)).resolves.toEqual({
    schemaVersion: 2,
    targets: [],
  });
});

it('rejects invalid route JSON with IO_ERROR', async () => {
  await writeFile(paths.routeFile, '{', 'utf8');
  await expect(readRouteConfig(paths)).rejects.toMatchObject({ code: 'IO_ERROR' });
});
```
Run: `pnpm exec vitest run packages/core/src/config-store.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 2: 实现 `config-store.ts`**

用 `readJsonFile(paths.routeFile, RouteFileSchema, createEmptyRouteFile())` 等三份实现。

- [ ] **Step 3: 让现有 store 委托**

- `route.ts` 的 `readRouteFile` → `return readRouteConfig(paths);`
- `package-store.ts` 的 `readPackageFile` → `return readPackageConfig(paths);`
- `skill-store.ts` 的 `readSkillFile` → `return readSkillConfig(paths);`

- [ ] **Step 4: 移除跨域直接读取**

- `skill-store.ts` 删除 `readJsonFile`、`RouteFileSchema`、`PackageFileSchema`、`createEmptyRouteFile`、`createEmptyPackageFile` 导入；改用 `readRouteConfig`、`readPackageConfig`。
- `package-store.ts` 删除 `readJsonFile`、`RouteFileSchema`、`createEmptyRouteFile` 导入；改用 `readRouteConfig`。
- 不要改变 `removeSkillVersion` / `removePackageVersion` 的引用检查逻辑。

- [ ] **Step 5: 运行测试**

Run:
```bash
pnpm exec vitest run packages/core/src/config-store.test.ts packages/core/src/route.test.ts packages/core/src/package-store.test.ts packages/core/src/skill-store.test.ts packages/core/src/skill-store-failure.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src
git commit -m "refactor(core): add a single config reading layer"
```

## Task P2.2: 拆分 `doctor.ts` 为独立检查模块

**Files:**
- Create: `packages/core/src/doctor/issues.ts`
- Create: `packages/core/src/doctor/config.ts`
- Create: `packages/core/src/doctor/packages.ts`
- Create: `packages/core/src/doctor/skills.ts`
- Create: `packages/core/src/doctor/links.ts`
- Create: `packages/core/src/doctor/index.ts`
- Delete: `packages/core/src/doctor.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/doctor.test.ts`
- Test: `packages/core/src/doctor/packages.test.ts`
- Test: `packages/core/src/doctor/skills.test.ts`

**Interfaces:**
- `doctor/index.ts` 保持 `doctor(input?: DoctorInput): Promise<DoctorReport>` 公共签名不变。
- 内部：
  ```ts
  export interface DoctorContext {
    paths: SkillinkPaths;
    route: RouteFile;
    packageFile: PackageFile;
    skillFile: SkillFile;
  }

  export function checkTargetConfiguration(ctx: DoctorContext): DoctorIssue[];
  export function checkPackageGraph(ctx: DoctorContext): DoctorIssue[];
  export function checkPackageUsage(ctx: DoctorContext): DoctorIssue[];
  export async function checkSkillContent(ctx: DoctorContext): Promise<DoctorIssue[]>;
  export async function checkTargetLinks(
    ctx: DoctorContext,
    statusReport: StatusReport,
  ): Promise<DoctorIssue[]>;
  ```
- `issues.ts` 提供 `issueFromGraphError(error, targetId?)`、`pathIsDirectory`、`pathIsFile`、`detailString`。
- `doctor/index.ts` 只读配置、调用各 check、合并 `issues`；`ok = issues.length === 0`。

- [ ] **Step 1: 写 packages 检查的失败测试**

`packages/core/src/doctor/packages.test.ts`：
```ts
it('does not report a nested package version as unused', () => {
  const issues = checkPackageUsage(ctxWithNestedPackage);
  expect(issues.filter((issue) => issue.code === 'UNUSED_PACKAGE_VERSION'))
    .toEqual([]);
});

it('reports an unused package version', () => {
  const issues = checkPackageUsage(ctxWithUnusedPackage);
  expect(issues).toContainEqual(
    expect.objectContaining({
      code: 'UNUSED_PACKAGE_VERSION',
      name: 'orphan',
      version: '1.0.0',
    }),
  );
});
```
Run: `pnpm exec vitest run packages/core/src/doctor/packages.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 2: 迁移 `issues.ts` 与 `config.ts`**

从 `doctor.ts` 复制 `issueFromGraphError`、`detailString`、`pathIsDirectory`、`pathIsFile` 到 `issues.ts`。把大小写冲突、target id 重复、target 路径安全/重复/嵌套、`UNSUPPORTED_MODE` 检查移到 `config.ts` 的 `checkTargetConfiguration`。保持 issue 的 `code`、`message`、`name`、`version`、`targetId`、`path` 字段不变。

- [ ] **Step 3: 迁移 `packages.ts`**

把 `validateAllPackages`、package 引用缺失 skill/package、route lock 校验、`referencedPackages` 计算、`UNUSED_PACKAGE_VERSION` 移到 `packages.ts`。`checkPackageUsage` 接收已解析的 `ctx`，返回 issue 数组。保留“先全部根、再启用根”的引用计数语义。

- [ ] **Step 4: 迁移 `skills.ts` 与 `links.ts`**

- `skills.ts`：skill 内容目录存在、`SKILL.md`、`verifySkillIntegrity`、`ORPHAN_CONTENT` 扫描。
- `links.ts`：复用 `statusReport`，只把非 `ok`/`disabled` 且名称不以 `<` 开头的条目转成 `LINK_ISSUE`。
- `doctor/index.ts` 按原顺序合并：config → package graph → package usage → skill content → links。顺序会影响测试断言，保持现有顺序。

- [ ] **Step 5: 更新导入与类型检查**

- `core/index.ts` 的 `doctor` 导出改为 `./doctor/index.js`。
- 所有 core 内部 `./doctor.js` 改为 `./doctor/index.js`。
- 删除旧 `doctor.ts`。

- [ ] **Step 6: 运行测试**

Run:
```bash
pnpm exec vitest run packages/core/src/doctor.test.ts packages/core/src/doctor/packages.test.ts packages/core/src/doctor/skills.test.ts
pnpm typecheck
```
Expected: 全部 PASS；`doctor.test.ts` 无需修改断言即可通过（允许只改 import 路径）。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src
git commit -m "refactor(core): split doctor checks into focused modules"
```

## Task P2.3: 拆分 settings 与语言包存储，统一内置英文摘要

**Files:**
- Create: `packages/core/src/settings-store.ts`
- Modify: `packages/core/src/language-store.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/language-store.test.ts`
- Modify: `packages/shared/src/i18n.ts`
- Modify: `packages/shared/src/i18n.test.ts`
- Modify: `apps/desktop/src/renderer/src/i18n.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n.test-utils.tsx`

**Interfaces:**
- `settings-store.ts` produces:
  ```ts
  export async function readSettingsFile(paths: SkillinkPaths): Promise<SettingsFile>;
  export async function writeSettingsFile(paths: SkillinkPaths, settings: SettingsFile): Promise<void>;
  ```
- `shared/i18n.ts` produces:
  ```ts
  export const EN_LANGUAGE_SUMMARY: LanguagePackSummary;
  export function summarizeLanguagePack(pack: LanguagePack): LanguagePackSummary;
  ```
  `EN_LANGUAGE_SUMMARY` 的 `messageCount` 为 `Object.keys(EN_MESSAGES).length`，`coverage` 为 1，`builtIn` 为 true。
- `language-store.ts` 不再定义 `BUILTIN_EN` 和本地 `summarize`；改用 shared 的两个导出。

- [ ] **Step 1: 写 shared 摘要测试**

`packages/shared/src/i18n.test.ts`：
```ts
it('summarizes a language pack against the English catalog', () => {
  const summary = summarizeLanguagePack({
    schemaVersion: 1,
    locale: 'zh-CN',
    name: '简体中文',
    nativeName: '简体中文',
    version: '1.0.0',
    direction: 'ltr',
    messages: { 'app.brand': 'Skillink' },
  });

  expect(summary.coverage).toBeGreaterThan(0);
  expect(summary.coverage).toBeLessThan(1);
  expect(summary.builtIn).toBe(false);
});
```
Run: `pnpm exec vitest run packages/shared/src/i18n.test.ts`
Expected: FAIL，`summarizeLanguagePack` 未导出。

- [ ] **Step 2: 实现 shared 摘要**

把 core `language-store.ts` 的 `summarize` 逻辑移到 `shared/i18n.ts`，使用 `EN_MESSAGES` 计算 known keys。添加 `EN_LANGUAGE_SUMMARY` 常量。

- [ ] **Step 3: 创建 `settings-store.ts`**

把 `readSettingsFile` / `writeSettingsFile` 从 `language-store.ts` 原样移出；`language-store.ts` 改为导入它们。`core/index.ts` 从 `./settings-store.js` 导出这两个函数。

- [ ] **Step 4: 更新语言存储与 renderer**

- `language-store.ts`：`listLanguagePacks` 初始值为 `[{ ...EN_LANGUAGE_SUMMARY }]`；`installLanguagePack` 返回 `summarizeLanguagePack(pack)`。
- `renderer/i18n.tsx`：删除本地 `ENGLISH_PACK`，使用 `EN_LANGUAGE_SUMMARY`。
- `renderer/i18n.test-utils.tsx`：同样使用 shared 常量。
- `language-store.test.ts` 的 settings 导入改为 `./settings-store.js`；语言包测试不变。

- [ ] **Step 5: 运行测试**

Run:
```bash
pnpm exec vitest run packages/shared/src/i18n.test.ts packages/core/src/language-store.test.ts apps/desktop/src/renderer/src/i18n.test.tsx apps/desktop/src/renderer/src/LanguageDialog.test.tsx
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src packages/core/src apps/desktop/src/renderer/src
git commit -m "refactor(i18n): split settings storage and share language summaries"
```

## Task P2.4: 抽取 renderer 格式化工具与共享 `name@version` 解析

**Files:**
- Create: `packages/shared/src/spec.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/spec.test.ts`
- Create: `apps/desktop/src/renderer/src/format.ts`
- Test: `apps/desktop/src/renderer/src/format.test.ts`
- Modify: `apps/cli/src/specs.ts`
- Modify: `apps/desktop/src/renderer/src/SkillsView.tsx`
- Modify: `apps/desktop/src/renderer/src/SnapshotView.tsx`
- Modify: `apps/desktop/src/renderer/src/PackagesView.tsx`

**Interfaces:**
- `shared/spec.ts` produces:
  ```ts
  export interface NameVersionSpec { name: string; version: string; }
  export function parseNameVersionSpec(value: string): NameVersionSpec | undefined;
  ```
  规则：取最后一个 `@`；`name` 与 `version` 都必须非空；不校验 semver（调用方决定）；`@scope/name@1.0.0` 返回 `{ name: '@scope/name', version: '1.0.0' }`。
- `renderer/format.ts` produces:
  ```ts
  export function formatBytes(bytes: number): string;
  export function errorMessage(error: unknown): string;
  export function compositionText(
    value: { skills: Record<string, string>; packages: Record<string, string> },
    t: Translator['t'],
    keys: { skills: string; packages: string },
  ): string;
  ```

- [ ] **Step 1: 写 shared 解析测试**

`packages/shared/src/spec.test.ts`：
```ts
it('parses the last @ as the version separator', () => {
  expect(parseNameVersionSpec('pdf@1.0.0')).toEqual({
    name: 'pdf',
    version: '1.0.0',
  });
  expect(parseNameVersionSpec('@scope/pdf@1.0.0')).toEqual({
    name: '@scope/pdf',
    version: '1.0.0',
  });
});

it('rejects missing name or version', () => {
  expect(parseNameVersionSpec('pdf')).toBeUndefined();
  expect(parseNameVersionSpec('@1.0.0')).toBeUndefined();
  expect(parseNameVersionSpec('pdf@')).toBeUndefined();
});
```
Run: `pnpm exec vitest run packages/shared/src/spec.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 2: 实现 shared parser 并接入 CLI**

在 `packages/shared/src/index.ts` 增加 `export * from './spec.js';`。`apps/cli/src/specs.ts` 的 `parseSpec` 改为：
```ts
const parsed = parseNameVersionSpec(spec);
if (!parsed) {
  throw new SkillinkError('ROUTE_INVALID', 'Invalid spec; expected name@version.', { spec });
}
return parsed;
```
保持错误码与消息不变。`collectSpecs` 继续复用 `parseSpec`。

- [ ] **Step 3: 写 renderer 工具测试**

`apps/desktop/src/renderer/src/format.test.ts`：
```ts
it('formats bytes at each unit boundary', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(1024)).toBe('1.0 KB');
  expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
});

it('extracts an error message', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage('boom')).toBe('boom');
});
```
Run: `pnpm exec vitest run apps/desktop/src/renderer/src/format.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 `format.ts` 并替换重复实现**

- 删除 `SkillsView.tsx`、`SnapshotView.tsx` 中的本地 `formatBytes`；从 `format.js` 导入。
- 删除 `SkillsView.tsx` 中的本地 `errorMessage`；从 `format.js` 导入。
- 删除 `SnapshotView.tsx` 与 `PackagesView.tsx` 中的本地 `compositionText`；改用 `compositionText(value, t, { skills: 'overview.composition.skills', packages: 'overview.composition.packages' })` 等对应 key。
- `PackagesView.tsx` 的 `parseDependencies` 改为调用 `parseNameVersionSpec`，遇到 `undefined` 时跳过该行（保持现有“忽略非法行”行为）。

- [ ] **Step 5: 运行测试**

Run:
```bash
pnpm exec vitest run packages/shared/src/spec.test.ts apps/desktop/src/renderer/src/format.test.ts apps/desktop/src/renderer/src/SkillsView.test.tsx apps/desktop/src/renderer/src/SnapshotView.test.tsx apps/desktop/src/renderer/src/PackagesView.test.tsx apps/cli/src/cli.test.ts
pnpm typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src apps/desktop/src/renderer/src apps/cli/src
git commit -m "refactor: share spec parsing and renderer formatting helpers"
```

## Task P2.5: 清理遗留冲突模型与文档漂移

**Files:**
- Modify: `packages/shared/src/reports.ts`
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/i18n-en.ts`
- Modify: `locales/zh-CN.json`
- Modify: `packages/core/src/apply.ts`
- Modify: `apps/cli/src/commands/lifecycle.ts`（P1.3c 后；若尚未拆分则改 `run.ts`）
- Modify: `apps/desktop/src/renderer/src/TargetsView.tsx`
- Modify: `apps/desktop/src/main/cli-adapter.test.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `apps/desktop/src/renderer/src/TargetsView.test.tsx`
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`

**Interfaces:**
- `ApplyReport` 变为：
  ```ts
  export interface ApplyReport {
    dryRun: boolean;
    ok: boolean;
    operations: ApplyOperation[];
  }
  ```
- 删除 `ApplyConflict`、`ApplyReport.conflicts`、`SKILLINK_ERROR_CODES` 中的 `UNMANAGED_CONFLICT`、EN/zh-CN 的 `errors.UNMANAGED_CONFLICT`、`targets.apply.conflict`、`targets.apply.conflicts`。
- CLI `apply` 不再检查/输出 conflicts；不再返回退出码 3；`UNMANAGED_CONFLICT` 的错误码特殊映射删除，所有 `SkillinkError` 返回 1。
- `target add --mode` 描述改为 “Projection mode (v2.0 supports link only)”。

- [ ] **Step 1: 先更新测试为“无 conflicts”**

- `apps/cli/src/cli.test.ts` 的 apply 测试：删除 `conflicts` 字段断言，保留 `ok === true`。
- `TargetsView.test.tsx` 的 `applyReport` fixture 删除 `conflicts: []`。
- `cli-adapter.test.ts` 删除 “returns apply conflict reports when the CLI exits 3” 用例；保留退出码 1/0 的 JSON 解析用例。
- 增加一个断言：`expect(report).not.toHaveProperty('conflicts')`。

Run: `pnpm exec vitest run apps/cli/src/cli.test.ts apps/desktop/src/renderer/src/TargetsView.test.tsx apps/desktop/src/main/cli-adapter.test.ts`
Expected: FAIL，因为生产类型/输出仍包含 conflicts。

- [ ] **Step 2: 删除 shared 与 core 的遗留字段**

- `reports.ts` 删除 `ApplyConflict` 和 `conflicts`。
- `errors.ts` 删除 `UNMANAGED_CONFLICT`。
- `apply.ts` 返回 `{ dryRun, ok: true, operations }`。
- `run.ts`/`commands/lifecycle.ts` 删除 conflicts 输出、`exitCode = 3`、`UNMANAGED_CONFLICT ? 3 : 1` 分支。

- [ ] **Step 3: 更新 UI 与 i18n**

- `TargetsView.tsx` 删除 conflicts 计数与冲突行。
- `i18n-en.ts` 删除 `targets.apply.conflicts`、`targets.apply.conflict`、`errors.UNMANAGED_CONFLICT`。
- `locales/zh-CN.json` 删除对应三个 key，确保 `language-store.test.ts` 的 `extraKeys === []` 仍通过。

- [ ] **Step 4: 更新文档**

- `ARCHITECTURE.md`：
  - §3.4 模块表补齐 `initialize`、`config-store`、`doctor/*`、`settings-store`、`target-resolution`、`json-store`、`fs-retry`、`links`、`skill-md`、`skill-integrity`、`package-name`、`path-policy`；
  - 删除 `UNMANAGED_CONFLICT` 与退出码 3 的描述；
  - 新增“导入方向规则”段落：shared 不依赖 core/cli；core 不依赖 cli/Electron/React；desktop main/preload 不依赖 core；renderer 不依赖 Node/Electron/core；
  - 说明 `withCliMutation` 位于 CLI、`rollbackTo` 是自带锁的事务操作。
- `README.md`：退出码改为只有 `0`/`1`；删除 `UNMANAGED_CONFLICT` 与 apply conflict 相关说明；更新 `target add --mode` 描述。

- [ ] **Step 5: 运行完整验证**

Run:
```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```
Expected: 全部 PASS；`git diff --check` 无输出（仅允许既有 CRLF 提示）。

- [ ] **Step 6: 提交**

```bash
git add packages apps locales ARCHITECTURE.md README.md
git commit -m "refactor: remove legacy apply conflict surface and update docs"
```

**P2 验收：** 三份配置只有一个只读加载入口；`doctor.ts` 不再存在，检查按职责拆分；settings 与语言包存储分离；renderer 不再重复格式化/解析实现；`ApplyReport` 不再有永远为空的 `conflicts`；文档与实际模块、退出码一致。

---

## 3. 阶段检查点

每个阶段结束必须是一个可交付检查点：

1. **P0 后**：行为不变，重复校验/投影清理已收敛，公共 API 与边界测试建立。
2. **P1 后**：CLI 编排与 core 分离，`run.ts` 变小，snapshot 不重复扫描。
3. **P2 后**：config/doctor/i18n/UI 边界清晰，遗留冲突模型和文档漂移清理完成。

不要在 P1 中途把 P2 的文件移动混进来；也不要在一个提交里同时改行为和移动文件。

## 4. 最终验证命令

```bash
git status --short
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:
- `git status --short` 无输出（所有任务已提交）；
- `pnpm test` 全部通过（测试数量会因新增/移动测试变化，不要求固定为 507）；
- `pnpm typecheck` 无输出；
- `pnpm build` 成功（允许既有 Electron externalization warning）；
- `git diff --check` 无新增空白错误。
