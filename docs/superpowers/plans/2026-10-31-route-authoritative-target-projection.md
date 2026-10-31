# Route-Authoritative Target Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `route.json` the single source of truth for which target-directory entries Skillink owns, and delete/reconcile same-name entries by mode and content hash.

**Architecture:** Add a shared target-entry comparison module used by both `apply` and `status`. Apply replaces same-name entries whose mode or content differs from the route-resolved skill, without using link destinations for ownership. Extend the existing target GC so route remove, package disable, target disable, and route version replacement clean obsolete target entries.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest, pnpm, Electron/CLI shared core.

**Spec:** This document, `Behavioral Contract` section (conversation-approved; no separate spec file).

## Global Constraints

- `route.json` is the only ownership source. Do not use `isManagedLink` or link destinations to decide whether a target entry is managed.
- Only same-name entries in the route's active desired set are touched. Entries outside that set are never touched by `apply` or `status`.
- v2 supports `link` mode only. `copy` targets continue to fail with `COPY_MODE_UNSUPPORTED` in `apply`.
- Replacement is destructive: delete the existing entry with `rm -rf` / `unlink`, then recreate the link. Do not back up or restore replaced real directories or files.
- `apply --prune` is removed. Do not add a replacement prune flag or command.
- Target GC failure aborts the config write. Already deleted target entries are not restored.
- `target remove` keeps its current failure behavior: if route resolution fails, the target is not removed.
- For `route remove`, `route add` version replacement, `package disable`, and `target disable`, if graph resolution fails, skip GC and keep the config change repairable.
- Do not commit. The workspace contains pre-existing staged changes unrelated to this plan.
- Every new/changed English i18n key must have a Simplified Chinese translation; bump `locales/zh-CN.json` version from `1.0.5` to `1.0.6`.
- Windows junction and Linux/macOS symlink behavior must both keep working.

## Review Focus

- A same-name real directory with identical content is still replaced because its mode differs from `link`.
- A same-name real directory with different content is replaced without hashing.
- A link to an external directory with identical content is kept.
- A link to different content is replaced.
- A broken link is detected and replaced.
- `package disable` must not delete a skill still needed by another enabled package in the same target.
- `route remove` must not delete a skill still needed by another enabled package in the same target.
- GC failure leaves `route.json` unchanged and does not restore deleted target entries.
- `history rollback` does not run target GC; document that target entries may remain.

---

### Task 1: Shared target-entry comparison

**Files:**
- Create: `packages/core/src/target-entry.ts`
- Create: `packages/core/src/target-entry.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/shared/src/reports.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TargetEntryComparison =
    | { kind: 'missing' }
    | { kind: 'ok'; actual: PathInspection }
    | { kind: 'wrong-mode'; actual: PathInspection }
    | { kind: 'wrong-version'; actual: PathInspection }
    | { kind: 'broken-link'; actual: PathInspection }
    | { kind: 'error'; actual: PathInspection; error: unknown };

  export interface CompareTargetEntryInput {
    destination: string;
    sourcePath: string;
    mode: TargetMode;
    expected: SkillVersion;
  }

  export async function compareTargetEntry(
    input: CompareTargetEntryInput,
  ): Promise<TargetEntryComparison>;
  ```
- `PathInspection` comes from `./links.js`; `TargetMode` and `SkillVersion` come from `@skillink/shared`.

- [ ] **Step 1: Write failing comparison tests**

Cover:
- missing path → `missing`
- link to `sourcePath` → `ok`
- link to another directory with identical content → `ok`
- link to another directory with changed content → `wrong-version`
- real directory → `wrong-mode`
- regular file → `wrong-mode`
- broken link → `broken-link`

Use a temp skill directory built with `scanFolder`-compatible files (`SKILL.md`, `content.txt`). Copy with `cp(..., { recursive: true })` for the identical content case and modify a file for the different content case.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/target-entry.test.ts`
Expected: FAIL because `target-entry.ts` does not exist.

- [ ] **Step 3: Implement `compareTargetEntry`**

Behavior:
1. `inspectPath(destination)`.
2. If missing → `{ kind: 'missing' }`.
3. If `mode === 'link'` and actual kind is not `link` → `wrong-mode`.
4. If `mode === 'copy'` and actual kind is not `directory` → `wrong-mode`.
5. For links, resolve `realpath(destination)` and `realpath(sourcePath)`; if they are the same path → `ok`.
6. Scan the destination with `scanFolder(destination, DEFAULT_IMPORT_LIMITS)`.
7. Compare `scan.kind === 'skill'`, `scan.integrity === expected.integrity`, `scan.fileCount === expected.fileCount`, `scan.totalSize === expected.size`.
8. Map `ENOENT` during the scan to `broken-link`; `UNSAFE_PATH`, `IMPORT_LIMIT_EXCEEDED`, and `ENOTDIR` to `wrong-version`; other errors to `error`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/target-entry.test.ts`
Expected: PASS.

- [ ] **Step 5: Export the module**

Add `export * from './target-entry.js';` to `packages/core/src/index.ts`.

---

### Task 2: Apply uses route-authoritative comparison

**Files:**
- Modify: `packages/core/src/apply.ts`
- Modify: `packages/core/src/apply.test.ts`
- Modify: `packages/core/src/links.ts` (remove `isManagedLink`)
- Modify: `packages/shared/src/reports.ts` (remove `remove-link` operation kind)

**Interfaces:**
- Consumes `compareTargetEntry` from Task 1.
- Produces:
  ```ts
  export interface ApplyInput {
    paths?: SkillinkPaths;
    home?: string;
    targetId?: string;
    dryRun?: boolean;
  }
  ```
- `ApplyReport.conflicts` remains in the DTO but is always `[]`.

- [ ] **Step 1: Update tests to the new behavior**

Replace the “unmanaged folder conflict” test with:
- a real directory `target/pdf` containing `keep.txt` is removed
- `target/pdf` becomes a link to `skills/pdf/<resolved version>`
- `report.ok === true`
- the operation is `replace-link`

Replace the prune test with:
- create an extra link in the target that is not in route
- run `apply`
- the extra link remains

Keep and extend:
- a link to the wrong version is replaced
- an identical-content external link is skipped (new test)
- a different-content external link is replaced (new test)
- `apply({ paths, dryRun: true })` reports the replacement and leaves the real directory intact

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/apply.test.ts`
Expected: FAIL on the new real-directory replacement and no-prune assertions.

- [ ] **Step 3: Rewrite `planTarget`**

Remove `prune` from `ApplyInput` and the `planTarget` signature. For each desired skill:
1. Keep source content, source integrity, source-library containment, and destination containment checks.
2. Call `compareTargetEntry({ destination, sourcePath: sourceDir, mode: target.mode, expected: skillFile.skills[skill.name]!.versions[skill.version]! })`.
3. `missing` → `create-link`.
4. `ok` → `skip`.
5. `error` → throw the contained error.
6. `wrong-mode`, `wrong-version`, `broken-link` → `replace-link`, recording `previousKind: comparison.actual.kind` and `previousSourcePath` when the previous kind is `link`.

Remove the prune block entirely.

- [ ] **Step 4: Rewrite replacement execution**

In `executePlan` for `replace-link`:
- If `previousSourcePath` exists, push `restore-link` undo.
- If `previousKind === 'link'`, call `removeLink(operation.path)`.
- Otherwise call `withFsRetry(() => rm(operation.path, { recursive: true, force: true }))`.
- Then call `createDirectoryLink(operation.sourcePath!, operation.path)`.

Remove the `remove-link` operation branch and the public `remove-link` kind.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/apply.test.ts`
Expected: PASS.

---

### Task 3: Status uses the same comparison

**Files:**
- Modify: `packages/core/src/status.ts`
- Modify: `packages/core/src/status.test.ts`
- Modify: `packages/shared/src/reports.ts`

**Interfaces:**
- Consumes `compareTargetEntry` from Task 1.
- `StatusState` becomes:
  ```ts
  export type StatusState =
    | 'ok'
    | 'missing'
    | 'wrong-mode'
    | 'wrong-version'
    | 'broken-link'
    | 'conflict'
    | 'disabled';
  ```

- [ ] **Step 1: Update status tests**

- Real folder same-name → `wrong-mode`.
- Keep `wrong-version` for a link to an older version with different content.
- Remove the `extra` assertions; replace with a test that an unmatched link outside the route is ignored.
- Keep target-level `conflict` coverage.
- Add a broken-link case → `broken-link`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/status.test.ts`
Expected: FAIL on `wrong-mode` and removed `extra`.

- [ ] **Step 3: Rewrite the per-skill loop**

For each resolved skill:
1. Keep the source-existence check.
2. Call `compareTargetEntry`.
3. Map:
   - `missing` → `missing`
   - `ok` → `ok`
   - `wrong-mode` → `wrong-mode`
   - `wrong-version` → `wrong-version`
   - `broken-link` → `broken-link`
   - `error` → `conflict` with `errorDetail`
4. Set `sourcePath` on the entry.

Remove the `readdir`/`lstat`/`isManagedLink` extra scan. Remove `unmanaged` and `extra` from the shared type. Add an unsupported-mode target entry when `target.mode !== 'link'` after the disabled-target check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/status.test.ts`
Expected: PASS.

---

### Task 4: Extend target GC triggers

**Files:**
- Modify: `packages/core/src/target-gc.ts`
- Modify: `packages/core/src/route.ts`
- Modify: `packages/core/src/target.ts`
- Modify: `packages/core/src/route.test.ts`
- Modify: `packages/core/src/target.test.ts`
- Modify: `packages/core/src/target-gc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function resolvePackageSkillNames(input: {
    paths: SkillinkPaths;
    packageRef: { name: string; version: string };
  }): Promise<string[]>;

  export async function resolveTargetActiveSkillNames(input: {
    paths: SkillinkPaths;
    target: TargetRoute;
  }): Promise<string[]>;
  ```
- `resolveTargetSkillNames` keeps its current all-locks behavior.
- `gcTargetEntries` keeps its current deletion behavior.

- [ ] **Step 1: Write GC trigger tests**

- `route remove` deletes a skill only provided by the removed package.
- `route remove` keeps a skill shared with another enabled package.
- `package disable` deletes a skill only provided by the disabled package.
- `package disable` keeps a skill shared with another enabled package.
- `target disable` deletes all route-resolved target entries and keeps the target directory.
- `route add` replacing a package version deletes a skill dropped by the new version.
- GC failure leaves `route.json` unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/route.test.ts packages/core/src/target.test.ts packages/core/src/target-gc.test.ts`
Expected: FAIL because the triggers are not wired.

- [ ] **Step 3: Implement GC helpers**

`resolvePackageSkillNames`:
- Read `package.json` and `skill.json`.
- Resolve the single package root with `resolvePackageGraph`.
- Return sorted skill names.

`resolveTargetActiveSkillNames`:
- Return `[]` when `target.enabled === false`.
- Use only locks whose `enabled !== false`.
- Resolve and return sorted skill names.

- [ ] **Step 4: Wire `removeRouteEntry`**

Before deleting the lock, save the removed lock and best-effort resolve its skill names. Delete the lock. Validate the remaining graph as today when `!force`. Best-effort resolve the remaining active skill names. Compute `removedSkills - remainingSkills`. Call `gcTargetEntries` inside `withHistory` before writing `route.json`. If resolution fails, skip GC and still write the route change.

- [ ] **Step 5: Wire `setPackageEnabled(false)`**

Only when disabling and the lock was enabled:
- Best-effort resolve the package’s skill names before mutation.
- Mutate `enabled`.
- Best-effort resolve the remaining active skill names.
- Compute the difference.
- Call `gcTargetEntries` inside `withHistory` before writing.
- Skip GC when the target is disabled.
- Enabling keeps validation and never runs GC.

- [ ] **Step 6: Wire `setTargetEnabled(false)`**

Only when transitioning enabled → disabled:
- Best-effort resolve all target skill names with `resolveTargetSkillNames`.
- Mutate `enabled`.
- Call `gcTargetEntries` with the resolved names inside `withHistory` before writing.
- If resolution fails, skip GC and still write.
- Enabling keeps validation and never runs GC.

- [ ] **Step 7: Wire `addRouteEntry` version replacement**

When a lock for the same package already exists and the target is enabled:
- Best-effort resolve the old package skill names.
- Build and validate the candidate graph as today.
- Best-effort resolve the candidate active skill names.
- Compute the difference.
- Call `gcTargetEntries` inside `withHistory` before writing.
- Skip GC when the target is disabled or resolution fails.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/route.test.ts packages/core/src/target.test.ts packages/core/src/target-gc.test.ts`
Expected: PASS.

---

### Task 5: Remove prune surfaces

**Files:**
- Modify: `apps/cli/src/run.ts`
- Modify: `apps/desktop/src/ipc-schemas.ts`
- Modify: `apps/desktop/src/ipc-schemas.test.ts`
- Modify: `apps/desktop/src/main/cli-commands.ts`
- Modify: `apps/desktop/src/main/cli-commands.test.ts`
- Modify: `apps/desktop/src/renderer/src/TargetsView.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/TargetsView.test.tsx`
- Delete: `ApplyOptionsInput` / prune state in `TargetsView`

- [ ] **Step 1: Update tests and snapshots**

- IPC schema rejects `prune`.
- `buildApplyArgs` no longer emits `--prune`.
- Targets view renders no prune checkbox and calls apply/preview without options.

- [ ] **Step 2: Remove the surfaces**

- Remove `--prune` option and option type from `apps/cli/src/run.ts`.
- Remove `prune` from `ApplyRequestSchema`.
- Remove `prune` from `buildApplyArgs`.
- Remove the prune checkbox and state from `TargetsView`.
- Change `applyRoutes` / `previewRoutes` in `App.tsx` to take no options.
- Remove `ApplyOptionsInput` and the callback options.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run apps/desktop/src/ipc-schemas.test.ts apps/desktop/src/main/cli-commands.test.ts apps/desktop/src/renderer/src/TargetsView.test.tsx`
Expected: PASS.

---

### Task 6: i18n, docs, and full verification

**Files:**
- Modify: `packages/shared/src/i18n-en.ts`
- Modify: `locales/zh-CN.json`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `packages/core/src/doctor.test.ts` if status states change assertions

- [ ] **Step 1: Update i18n**

- Add `status.wrong_mode` in English and Chinese.
- Remove `status.unmanaged`, `status.extra`, `targets.prune`, and `apply.kind.remove_link`.
- Bump `locales/zh-CN.json` version to `1.0.6`.
- Update `targets.confirm.removeRoute` to mention target entries being deleted.
- CLI descriptions for `target disable`, `route disable`, and `route remove` mention cleanup.

- [ ] **Step 2: Update docs**

- README: remove `--prune` from `skillink apply`; update Targets description.
- ARCHITECTURE: update apply, status, GC, deletion rules, GUI description, and behavior checklists.
- Note that `history rollback` restores config only and does not run target GC.

- [ ] **Step 3: Run full verification**

Run:
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Expected: all pass.

---

## Known Consequences

- Applying over a real directory or regular file deletes it permanently; rollback cannot restore it.
- `history rollback` does not clean target directories. A rollback that removes route entries can leave target entries behind until manually cleaned or the target is removed.
- `skillink gc` still only collects unreferenced skill-library versions; it does not scan target directories.
