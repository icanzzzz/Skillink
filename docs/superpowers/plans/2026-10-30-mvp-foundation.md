# Skillink MVP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 打通 Skillink MVP 的首个可用闭环：导入任意本地文件夹到公用库、写入 `skills.json`、配置 `route.json`、apply 到用户指定目标目录，并能 status/doctor。

**Architecture:** pnpm monorepo。`packages/shared` 定义 zod schema、类型、错误码与路径常量；`packages/core` 实现公用库、路由、apply、status/doctor；`apps/cli` 用 Commander 暴露命令；Electron GUI 在核心稳定后接入。

**Tech Stack:** TypeScript、Node.js、pnpm workspaces、Vitest、zod、Commander、tsx、tsup。

**Spec:** `ARCHITECTURE.md`

## Global Constraints

- 管理单位是任意文件夹；不要求、不校验 `SKILL.md`。
- MVP 来源只支持用户选中的本地文件夹，不支持 tar/Git/registry。
- 公用库目录固定为 `SKILLINK_HOME/skills.json`，路由固定为 `SKILLINK_HOME/route.json`。
- 默认 `SKILLINK_HOME` 为 `~/.agents/skillink`；测试必须通过环境变量覆盖。
- 目标目录由用户填写；不在目标目录或项目根生成配置文件。
- 默认链接：Windows junction，Linux/macOS symlink；失败时报错，MVP 不静默复制。
- 永不覆盖未托管的同名文件/文件夹；`--prune` 只删除指向版本库的托管链接。
- 所有 JSON 写入采用临时文件 + rename；写入前 schema 校验。
- Package 名必须是安全的文件夹名；版本默认 `0.0.0+<hash8>`。
- 测试使用真实临时目录，不 mock 文件系统。
- TypeScript strict；Node 24+；Windows 11 是首要验证平台。

## Review Focus

- 目标路径误填到系统目录、用户主目录根或 `SKILLINK_HOME` 内部时，必须拒绝。
- 目标目录已有未托管同名文件夹时，必须保留并报告冲突，不能覆盖。
- Windows junction 创建失败时，不能偷偷降级为复制；必须明确报错。
- `route.json` 引用 `skills.json` 中不存在的版本时，`apply` 必须拒绝。
- `skills.json` 有记录但版本目录缺失时，`doctor` 必须报告，`apply` 必须拒绝。
- 同名同版本但内容不同时，导入必须拒绝，不能覆盖不可变版本。
- 任何 JSON 写入中断后，不能留下半个有效文件。

---

### Task 1: Monorepo scaffold and shared contracts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/paths.ts`
- Test: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces: `RouteFileSchema`, `SkillsFileSchema`, `RouteFile`, `SkillsFile`, `SkillinkError`, `getSkillinkPaths(home?)`, `getDefaultSkillinkHome(env?)`.

- [x] **Step 1: Write failing schema tests**

Test that a minimal `route.json` and `skills.json` parse, that malformed target mode fails, and that missing `integrity` in a library version fails.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/shared/src/schemas.test.ts`
Expected: FAIL because schemas do not exist.

- [x] **Step 3: Implement scaffold and schemas**

Create workspace files and zod schemas matching `ARCHITECTURE.md` sections 8.1–8.5.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm test packages/shared/src/schemas.test.ts && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json vitest.config.ts packages/shared
git commit -m "chore: scaffold workspace and shared schemas"
```

### Task 2: Atomic JSON persistence and path safety

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/json-store.ts`
- Create: `packages/core/src/path-policy.ts`
- Create: `packages/core/src/package-name.ts`
- Test: `packages/core/src/json-store.test.ts`
- Test: `packages/core/src/path-policy.test.ts`
- Test: `packages/core/src/package-name.test.ts`

**Interfaces:**
- Consumes: `getSkillinkPaths`, schemas.
- Produces: `readJsonFile`, `writeJsonAtomic`, `assertSafeTargetPath`, `assertSafePackageName`, `normalizeVersion`.

- [x] **Step 1: Write failing tests**

Cover: atomic write leaves valid JSON; invalid schema rejected; target path inside `SKILLINK_HOME` rejected; drive root rejected; unsafe package names (`..`, `CON`, `a/b`) rejected; `0.0.0+abc12345` accepted.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/core/src/json-store.test.ts packages/core/src/path-policy.test.ts packages/core/src/package-name.test.ts`
Expected: FAIL because implementations do not exist.

- [x] **Step 3: Implement persistence and policies**

Use `fs.mkdtemp`/temp file + `fs.rename`; no schema mutation on read; reject unsafe paths with `SkillinkError` codes.

- [x] **Step 4: Run tests**

Run: `pnpm test packages/core/src/json-store.test.ts packages/core/src/path-policy.test.ts packages/core/src/package-name.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: add atomic JSON store and path policies"
```

### Task 3: Import local folder into the public library

**Files:**
- Create: `packages/core/src/library.ts`
- Create: `packages/core/src/folder-scan.ts`
- Create: `packages/core/src/import-folder.ts`
- Create: `packages/core/src/library.test.ts`
- Create: `packages/core/src/import-folder.test.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `writeJsonAtomic`, `assertSafePackageName`, `normalizeVersion`.
- Produces: `readSkillsFile`, `writeSkillsFile`, `importFolder(input): Promise<ImportResult>`.

- [x] **Step 1: Write failing import tests**

Cover: arbitrary folder without `SKILL.md` imports; `skills.json` gets name/version/integrity/fileCount/size; empty directory preserved; hidden file copied; symlink rejected; same version + same content reuses; same version + different content rejects.

- [x] **Step 2: Run tests to verify fail**

Run: `pnpm test packages/core/src/import-folder.test.ts`
Expected: FAIL because `importFolder` does not exist.

- [x] **Step 3: Implement folder scan and import**

Scan recursively, reject symlinks, compute a canonical manifest hash, copy to staging, move to `skills/<name>/<version>/`, then atomically update `skills.json`.

- [x] **Step 4: Run tests**

Run: `pnpm test packages/core/src/import-folder.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: import arbitrary local folders into public library"
```

### Task 4: Target and route management

**Files:**
- Create: `packages/core/src/route.ts`
- Create: `packages/core/src/target.ts`
- Create: `packages/core/src/route.test.ts`
- Create: `packages/core/src/target.test.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `writeJsonAtomic`, `readSkillsFile`, `assertSafeTargetPath`, `normalizeVersion`.
- Produces: `readRouteFile`, `writeRouteFile`, `addTarget`, `removeTarget`, `addRouteEntry`, `removeRouteEntry`, `resolveVersion`.

- [x] **Step 1: Write failing tests**

Cover: add target with user path; duplicate target id rejected; add route with exact version; semver range resolves highest matching version from `skills.json`; missing version rejected; remove target removes its route entry; target path remains untouched.

- [x] **Step 2: Run tests to verify fail**

Run: `pnpm test packages/core/src/route.test.ts packages/core/src/target.test.ts`
Expected: FAIL because implementations do not exist.

- [x] **Step 3: Implement route/target services**

Route entries store exact `resolved`, `integrity`, `source`; `requested` optional. `addRouteEntry` validates cross-file references.

- [x] **Step 4: Run tests**

Run: `pnpm test packages/core/src/route.test.ts packages/core/src/target.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: manage targets and route entries"
```

### Task 5: Apply, status, and doctor

**Files:**
- Create: `packages/core/src/apply.ts`
- Create: `packages/core/src/status.ts`
- Create: `packages/core/src/doctor.ts`
- Create: `packages/core/src/apply.test.ts`
- Create: `packages/core/src/status.test.ts`
- Create: `packages/core/src/doctor.test.ts`

**Interfaces:**
- Consumes: `readRouteFile`, `readSkillsFile`, `assertSafeTargetPath`.
- Produces: `apply(input): Promise<ApplyReport>`, `status(input): Promise<StatusReport>`, `doctor(input): Promise<DoctorReport>`.

- [x] **Step 1: Write failing tests**

Cover: apply creates per-package links; dry-run makes no changes; existing correct link is skipped; wrong managed link is replaced; unmanaged real folder conflicts and is not deleted; `--prune` removes only managed links; missing library version fails apply; status reports drift; doctor reports missing content/orphan directory.

- [x] **Step 2: Run tests to verify fail**

Run: `pnpm test packages/core/src/apply.test.ts packages/core/src/status.test.ts packages/core/src/doctor.test.ts`
Expected: FAIL because implementations do not exist.

- [x] **Step 3: Implement apply/status/doctor**

Use `lstat` to distinguish links from real directories; Windows `junction`, POSIX `symlink`; never follow unknown links for deletion.

- [x] **Step 4: Run tests**

Run: `pnpm test packages/core/src/apply.test.ts packages/core/src/status.test.ts packages/core/src/doctor.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: apply routes with safe link reconciliation"
```

### Task 6: CLI

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/commands/*.ts`
- Test: `apps/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: all core services.
- Produces: `skillink init`, `library list`, `add`, `target add/list/remove`, `route add/list/remove`, `apply`, `status`, `doctor`.

- [x] **Step 1: Write failing CLI tests**

Cover: `--help` exits 0; `add` imports a temp folder; `target add` then `route add` then `apply` creates a link; `status --json` is valid JSON.

- [x] **Step 2: Run tests to verify fail**

Run: `pnpm test apps/cli/src/cli.test.ts`
Expected: FAIL because CLI does not exist.

- [x] **Step 3: Implement Commander CLI**

Use `SKILLINK_HOME` and core services; human-readable output by default, `--json` for status/doctor/list.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm test apps/cli/src/cli.test.ts && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat: add Skillink CLI"
```

### Task 7: Electron GUI shell

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: core services via typed IPC.
- Produces: a running Electron window with four views: Library, Targets, Status, Settings.

- [x] **Step 1: Write failing renderer test**

Test that the app renders package list from a mocked typed IPC client and shows empty state.

- [x] **Step 2: Run test to verify fail**

Run: `pnpm test apps/desktop/src/renderer/App.test.tsx`
Expected: FAIL because app does not exist.

- [x] **Step 3: Implement minimal Electron shell**

Use electron-vite, React, Tailwind, contextIsolation, sandbox. Main process calls core; preload exposes typed methods.

- [x] **Step 4: Run test/typecheck**

Run: `pnpm test apps/desktop/src/renderer/App.test.tsx && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat: add Electron GUI shell"
```

---

## Verification

Before claiming MVP foundation complete:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Manual smoke test on Windows:

```text
1. Create a temp folder with a few files; no SKILL.md.
2. skillink add <folder> --name demo --version 1.0.0
3. skillink target add C:\Temp\skillink-target --label demo
4. skillink route add <target-id> demo@1.0.0
5. skillink apply
6. Verify C:\Temp\skillink-target\demo is a junction to the library.
7. skillink status
8. skillink doctor
```
