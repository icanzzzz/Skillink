# Package/Skill 三层重写实施计划

> **执行状态：已完成（2026-10-31）。** 后续 hardening 见 `ARCHITECTURE.md`、README 和 `.opencode/plan/2026-10-31-skillink-architecture-hardening-plan.md`。复选框保留为原始计划格式。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Skillink 从“target -> package（同时是内容实体）”重写为“target -> package（纯配置）-> skill（唯一实体）”，并支持 package 引用 package、环检测、skill 去重/冲突和 package 复制。

**Architecture:** 三个全局配置文件 `route.json`、`package.json`、`skill.json` 同级；`skillink/skills/<skill>/<version>/` 是唯一实体；package 是带版本的组合配置，不投影；target 最终只投影 skill。package 图用 DFS 解析，每次 package 生命周期和每次 route/apply 都校验环和 skill 版本冲突。

**Tech Stack:** TypeScript、Node.js、zod、vitest、commander、Electron、React。

**Spec:**
- `docs/superpowers/specs/2026-10-30-package-skill-split-design.md`
- `docs/superpowers/specs/2026-10-30-package-graph-addendum.md`

## Global Constraints

- 安装单位只能是 skill；skill 根目录必须有 `SKILL.md`。
- 纯文件夹包不合法；package 版本必须至少有一个 `packages` 或 `skills` 依赖。
- 三个配置文件统一 `schemaVersion: 2`。
- `package.json` 内的 package/skill 引用必须是精确版本；range/tag 只出现在 `route.json` 的 `requested`。
- package 版本创建后不可变；修改组合用 `package copy` 生成新版本。
- target 只投影 skill，不投影 package 目录。
- 同一 target 中同一 skill 不同版本 -> `SKILL_VERSION_CONFLICT`；同版本 -> 去重。
- 包引用图有环 -> `PACKAGE_CYCLE`，任何 package 生命周期都必须检测。
- route 只写 package lock，不写 skill lock、source、内容 integrity。
- 写配置前先创建历史快照；所有 JSON 写入使用临时文件 + rename。
- 不删除未托管内容；删除内容先进入 `trash/`。
- Windows 优先；沿用 junction/symlink/copy 逻辑。
- 不联网；测试全部使用临时目录。
- 存储依赖方向：`package-graph`（纯函数）<- `skill-store` <- `package-store` <- `route` <- `apply/status/doctor/gc/history`。低层模块不要反向 import 高层模块；需要读别的配置时用 `readJsonFile` + schema，避免循环依赖。

## Review Focus

- 导入没有根级 `SKILL.md` 的文件夹必须失败，且失败后不写 `skill.json`、不复制内容。
- package 版本为空、引用不存在的 package/skill、或形成环时必须失败，且失败后 `package.json` 不变。
- 自环、两节点环、三节点环、跨版本同名包环都必须被 DFS 捕获并给出完整路径。
- 同一 skill 同版本经多个 package 引用时只投影一次；不同版本必须在 route add 和 apply 都报 `SKILL_VERSION_CONFLICT`。
- `route.json` 不能出现 `skills` 键或 skill 版本；target 下不能出现 package 目录。
- `package copy` 的 `--skill` / `--package` override 必须能生成可解析的新版本，并拒绝制造新环/冲突。
- 历史回滚必须同时恢复三个文件；旧 v1 快照不能破坏新回滚。
- 迁移必须能从旧 `skills.json` 生成 `skill.json` + `package.json` + 新 route，失败时旧文件不变。

---

### Task 1: 三个全局配置文件的 schema 与路径

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/paths.ts`
- Modify: `packages/shared/src/errors.ts`
- Test: `packages/shared/src/schemas.test.ts`
- Test: `packages/shared/src/paths.test.ts` (create)

**Interfaces:**
- Produces:
  - `SkillVersion`, `SkillEntry`, `SkillFile`, `SkillFileSchema`
  - `PackageVersion`, `PackageEntry`, `PackageFile`, `PackageFileSchema`
  - `PackageLock`, `PackageLockSchema`
  - `TargetRoute`, `TargetRouteSchema`
  - `RouteFile`, `RouteFileSchema`
  - `createEmptySkillFile()`, `createEmptyPackageFile()`, `createEmptyRouteFile()`
  - `SkillinkPaths.packageFile`, `SkillinkPaths.skillFile`, `getSkillDir(paths, name, version)`

- [ ] **Step 1: 写失败的 schema 测试**

覆盖：
- `SkillFileSchema` 解析 `{ schemaVersion: 2, skills: { pdf: { versions: { '1.0.0': { integrity, fileCount, size } } } } }`。
- skill version 缺 `integrity` 失败。
- `PackageFileSchema` 解析只含 `skills` 的版本、只含 `packages` 的版本、两者都有的版本。
- package 版本 `packages` 和 `skills` 都为空时失败，错误信息包含 `at least one`。
- package 条目 `versions` 为空时失败，错误信息包含 `at least one version`。
- `RouteFileSchema` 解析 `targets[].packages`，lock 含 `requested/resolved/integrity/enabled`。
- 旧 `targets[].skills` 键不能满足新 schema（缺少 `packages` 时失败）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/shared/src/schemas.test.ts`
Expected: FAIL，缺少新导出。

- [ ] **Step 3: 实现 schema**

`packages/shared/src/schemas.ts`：

```ts
export const SkillVersionSchema = z.object({
  integrity: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  built: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const SkillEntrySchema = z.object({
  description: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  versions: z.record(z.string(), SkillVersionSchema),
});

export const SkillFileSchema = z.object({
  schemaVersion: z.literal(2),
  skills: z.record(z.string(), SkillEntrySchema),
});

export const PackageVersionSchema = z
  .object({
    packages: z.record(z.string(), z.string()).optional().default({}),
    skills: z.record(z.string(), z.string()).optional().default({}),
  })
  .refine(
    (value) =>
      Object.keys(value.packages).length + Object.keys(value.skills).length > 0,
    { message: 'Package version must contain at least one package or skill.' },
  );

export const PackageEntrySchema = z
  .object({
    description: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    versions: z.record(z.string(), PackageVersionSchema),
  })
  .refine((value) => Object.keys(value.versions).length > 0, {
    message: 'Package must contain at least one version.',
  });

export const PackageFileSchema = z.object({
  schemaVersion: z.literal(2),
  packages: z.record(z.string(), PackageEntrySchema),
});

export const PackageLockSchema = z.object({
  requested: z.string().optional(),
  resolved: z.string().min(1),
  integrity: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

export const TargetRouteSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  path: z.string().min(1),
  mode: z.enum(['link', 'copy']),
  enabled: z.boolean().optional().default(true),
  packages: z.record(z.string(), PackageLockSchema),
});

export const RouteFileSchema = z.object({
  schemaVersion: z.literal(2),
  targets: z.array(TargetRouteSchema),
});
```

删除旧 `PackageKindSchema`、`LibraryVersionSchema`、`LibraryPackageSchema`、`SkillsFileSchema`、`SkillLockSchema` 及其类型/空构造函数。新增空构造函数。

- [ ] **Step 4: 更新 paths 和 errors**

`paths.ts`：
```ts
packageFile: path.join(resolvedHome, 'package.json'),
skillFile: path.join(resolvedHome, 'skill.json'),
```
保留 `libraryDir: path.join(resolvedHome, 'skills')`。
新增：
```ts
export function getSkillDir(paths: SkillinkPaths, name: string, version: string): string {
  return path.join(paths.libraryDir, name, version);
}
```

`errors.ts` 增加：
```ts
| 'SKILL_MD_REQUIRED'
| 'PACKAGE_CYCLE'
| 'SKILL_VERSION_CONFLICT'
| 'PACKAGE_IN_USE'
| 'PACKAGE_EMPTY'
| 'PACKAGE_INTEGRITY_MISMATCH'
```

- [ ] **Step 5: 写 paths 测试**

`packages/shared/src/paths.test.ts`：
- `getSkillinkPaths('C:/tmp/home')` 返回 `package.json`、`skill.json`、`skills`。
- `getSkillDir` 返回 `<home>/skills/pdf/1.0.0`。

- [ ] **Step 6: 运行测试**

Run: `pnpm vitest run packages/shared/src/schemas.test.ts packages/shared/src/paths.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/paths.ts packages/shared/src/errors.ts packages/shared/src/schemas.test.ts packages/shared/src/paths.test.ts
git commit -m "feat: add package/skill/route v2 schemas"
```

---

### Task 2: Package 引用图解析、环检测、skill 去重与冲突、传递闭包哈希

**Files:**
- Create: `packages/core/src/package-graph.ts`
- Test: `packages/core/src/package-graph.test.ts`

**Interfaces:**
- Consumes: `PackageFile`, `SkillFile`, `PackageVersion`, `SkillVersion` from `@skillink/shared`。
- Produces:
  - `PackageRef = { name: string; version: string }`
  - `ResolvedPackageNode = { name: string; version: string; entry: PackageVersion }`
  - `ResolvedSkill = { name: string; version: string; entry: SkillVersion; requiredBy: string[] }`
  - `PackageResolution = { packages: Map<string, ResolvedPackageNode>; skills: Map<string, ResolvedSkill> }`
  - `resolvePackageGraph(packages: PackageFile, skills: SkillFile, roots: PackageRef[]): PackageResolution`
  - `computePackageIntegrity(packages: PackageFile, roots: PackageRef[]): string`
  - `validateAllPackages(packages: PackageFile, skills: SkillFile): void`

- [ ] **Step 1: 写失败的图测试**

覆盖：
- 单 package 单 skill 解析。
- package 嵌套 package，skill 传递解析。
- 同一 skill 同版本被两个 package 引用：`resolution.skills.size === 1`，`requiredBy` 含两个节点。
- 同一 skill 不同版本：抛 `SKILL_VERSION_CONFLICT`，message 含 skill 名和两个版本。
- 自环：`a@1.0.0 -> a@1.0.0` 抛 `PACKAGE_CYCLE`。
- 两节点环：`a@1 -> b@1 -> a@1`。
- 三节点环：`a@1 -> b@1 -> c@1 -> a@1`。
- 同名包不同版本、无环、skill 不冲突：允许，`packages` 含两个节点。
- 缺失 package / 缺失 package 版本 / 缺失 skill：抛 `PACKAGE_NOT_FOUND` 或 `VERSION_NOT_FOUND`。
- `computePackageIntegrity`：同一输入不同 key 顺序哈希相同；嵌套 package 内容变化哈希变化；根版本变化哈希变化；前缀 `sha256-`。
- `validateAllPackages` 能发现 package.json 中任意一个版本的环。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/package-graph.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `package-graph.ts`**

DFS 细节：
```ts
const visiting = new Set<string>();
const visited = new Set<string>();
const packagesByName = new Map<string, ResolvedPackageNode>();
const skillsByName = new Map<string, ResolvedSkill>();

function visit(root: PackageRef): void {
  const id = `${root.name}@${root.version}`;
  if (visiting.has(id)) {
    throw new SkillinkError('PACKAGE_CYCLE', `Package cycle detected: ${[...path, id].join(' -> ')}`, { path: [...path, id] });
  }
  if (visited.has(id)) return;
  visiting.add(id);
  path.push(id);
  const entry = packages.packages[root.name]?.versions[root.version];
  if (!entry) throw new SkillinkError('VERSION_NOT_FOUND', ...);
  for (const [skillName, skillVersion] of Object.entries(entry.skills)) {
    const skillEntry = skills.skills[skillName]?.versions[skillVersion];
    if (!skillEntry) throw new SkillinkError('VERSION_NOT_FOUND', ...);
    const existing = skillsByName.get(skillName);
    if (existing && existing.version !== skillVersion) {
      throw new SkillinkError('SKILL_VERSION_CONFLICT', `Skill "${skillName}" ...`, { skillName, versions: [existing.version, skillVersion], requiredBy: [existing.requiredBy, id] });
    }
    if (existing) existing.requiredBy.push(id);
    else skillsByName.set(skillName, { name: skillName, version: skillVersion, entry: skillEntry, requiredBy: [id] });
  }
  for (const [packageName, packageVersion] of Object.entries(entry.packages)) {
    visit({ name: packageName, version: packageVersion });
  }
  path.pop();
  visiting.delete(id);
  visited.add(id);
  packagesByName.set(id, { name: root.name, version: root.version, entry });
}
```

`computePackageIntegrity`：先用 DFS 收集闭包节点（不校验 skill），按 `name@version` 排序，`stableStringify({ name, version, entry })` 拼接，SHA-256，返回 `sha256-${base64}`。
`validateAllPackages`：对每个 package 的每个版本调用 `resolvePackageGraph(packages, skills, [ref])`。

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run packages/core/src/package-graph.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/package-graph.ts packages/core/src/package-graph.test.ts
git commit -m "feat: add package graph resolver and cycle detection"
```

---

### Task 3: Skill 存储与导入（强制 SKILL.md）

**Files:**
- Create: `packages/core/src/skill-store.ts`
- Create: `packages/core/src/import-skill.ts`
- Modify: `packages/core/src/folder-scan.ts` only if needed (keep `kind` detection)
- Delete: `packages/core/src/library.ts`
- Delete: `packages/core/src/import-folder.ts`
- Delete tests: `packages/core/src/library-management.test.ts`, `packages/core/src/library-failure.test.ts`, `packages/core/src/import-folder.test.ts`
- Test: `packages/core/src/skill-store.test.ts`
- Test: `packages/core/src/import-skill.test.ts`

**Interfaces:**
- Produces:
  - `readSkillFile(paths): Promise<SkillFile>`
  - `writeSkillFile(paths, file): Promise<void>`
  - `upsertSkillVersion(paths, input): Promise<{ created: boolean }>`
  - `setSkillTag(paths, name, version, tag): Promise<void>`
  - `removeSkillVersion(paths, name, version): Promise<void>`
  - `createTrashDirectory(paths): Promise<string>`
  - `importSkill(input): Promise<ImportSkillResult>`
  - `ImportSkillResult = { name; version; integrity; path; fileCount; size; created }`

- [ ] **Step 1: 写失败的 skill-store 测试**

覆盖：
- 写入/读取空 `skill.json`。
- `upsertSkillVersion` 创建版本，`skill.json.skills.demo.versions['1.0.0']` 存在，且没有 `source`。
- 同版本同 integrity 返回 `{ created: false }`。
- 同版本不同 integrity 抛 `PACKAGE_EXISTS`。
- tag 存在/缺失版本错误。
- 删除未引用版本：内容进 `trash/`，skill.json 更新。
- 删除最后一个版本：skill 条目删除。
- 删除仍被 route package 传递闭包引用的版本：`VERSION_IN_USE`。
- 删除被 tag 保留的版本：`VERSION_IN_USE`。
- 删除仅被未引用 package 版本引用的 skill：允许；之后 doctor 会把该 package 标为悬空。

- [ ] **Step 2: 实现 `skill-store.ts`**

从旧 `library.ts` 迁移，但：
- `packages` -> `skills`。
- 删除 `kind`、`source`。
- `librarySourcePath` 删除；路径统一用 `getSkillDir`。
- `removeSkillVersion` 检查 route 的 `targets[].packages` 和 skill tags：
  - route 引用 `resolvedPackageVersion` 的传递闭包中包含该 skill@version -> 拒绝。
  - 该 skill 版本被 tag 指向 -> 拒绝。
  - 仅被未引用 package 版本引用 -> 允许删除；doctor 负责报告悬空 package。
- 失败回滚逻辑保留。

- [ ] **Step 3: 写失败的 import-skill 测试**

覆盖：
- 没有 `SKILL.md`：抛 `SKILL_MD_REQUIRED`，`skill.json` 不存在或为空，`skills/` 下无内容。
- 有 `SKILL.md`：成功，`skill.json.skills.demo.versions['1.0.0']` 存在，无 `source`，内容复制完整。
- 同版本同内容复用。
- 同版本不同内容拒绝。
- 省略版本生成 `0.0.0+<hash8>`。
- 源目录含 symlink 拒绝。
- 导入不创建 `package.json`，不修改 `route.json`。

- [ ] **Step 4: 实现 `import-skill.ts`**

复用 `scanFolder`、`assertSafePackageName`、`normalizeVersion`、`createAutoVersion`、`getSkillDir`、`skillSourcePath`（改为 `skills/${name}/${version}` 仅用于报告，不写入配置）。
`scanFolder` 返回 `kind`；如果 `scan.kind !== 'skill'`，抛：
```ts
new SkillinkError('SKILL_MD_REQUIRED', `Skill root must contain SKILL.md: ${sourceDir}`, { sourceDir })
```

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run packages/core/src/skill-store.test.ts packages/core/src/import-skill.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-store.ts packages/core/src/import-skill.ts packages/core/src/skill-store.test.ts packages/core/src/import-skill.test.ts
git rm packages/core/src/library.ts packages/core/src/import-folder.ts packages/core/src/library-management.test.ts packages/core/src/library-failure.test.ts packages/core/src/import-folder.test.ts
git commit -m "feat: require SKILL.md and store skills in skill.json"
```

---

### Task 4: Package 存储、创建、复制、标签、删除

**Files:**
- Create: `packages/core/src/package-store.ts`
- Test: `packages/core/src/package-store.test.ts`

**Interfaces:**
- Consumes: `package-graph.ts`, `skill-store.ts`。
- Produces:
  - `readPackageFile(paths): Promise<PackageFile>`
  - `writePackageFile(paths, file): Promise<void>`
  - `resolvePackageVersion(file, name, requested): { version: string; entry: PackageVersion }`
  - `createPackageVersion(input): Promise<PackageVersion>`
  - `copyPackageVersion(input): Promise<PackageVersion>`
  - `setPackageTag(paths, name, version, tag): Promise<void>`
  - `removePackageVersion(paths, name, version): Promise<void>`
  - `listPackageReverseReferences(file, name, version): string[]`

`CreatePackageVersionInput`:
```ts
{
  paths: SkillinkPaths;
  name: string;
  version: string;
  description?: string;
  packages?: Record<string, string>;
  skills?: Record<string, string>;
}
```

`CopyPackageVersionInput`:
```ts
{
  paths: SkillinkPaths;
  sourceName: string;
  sourceVersion: string;
  targetName: string;
  targetVersion: string;
  description?: string;
  skillOverrides?: Record<string, string>;
  packageOverrides?: Record<string, string>;
  dropSkills?: string[];
  dropPackages?: string[];
}
```

- [ ] **Step 1: 写失败的 package-store 测试**

覆盖：
- 创建只含 skill 的版本。
- 创建只含 package 的版本。
- 创建同时含 package + skill 的版本。
- 空依赖：`PACKAGE_EMPTY`。
- 引用不存在的 skill / package：`VERSION_NOT_FOUND` / `PACKAGE_NOT_FOUND`。
- 形成自环：`PACKAGE_CYCLE`。
- 形成两节点环：`PACKAGE_CYCLE`。
- 新版本在传递闭包中造成 skill 不同版本：`SKILL_VERSION_CONFLICT`。
- 同 package 版本重复创建：`PACKAGE_EXISTS`。
- `resolvePackageVersion` 支持 exact、semver range、tag。
- `copyPackageVersion` 无 override 复制直接依赖。
- `copyPackageVersion` 用 `skillOverrides` 把 pdf 从 1.2.0 改为 1.3.0，复制版本可解析。
- `copyPackageVersion` 用 `packageOverrides` 替换嵌套 package。
- `copyPackageVersion` 的 `dropSkills` / `dropPackages` 生效。
- 复制到已存在版本：`PACKAGE_EXISTS`。
- 复制源不存在：`PACKAGE_NOT_FOUND`。
- `setPackageTag` 校验版本存在和图可解析。
- `removePackageVersion`：
  - 被 route（含 `enabled: false` 的 target/lock）引用 -> `VERSION_IN_USE`。
  - 被另一个 package 版本直接引用 -> `PACKAGE_IN_USE`。
  - 未被引用 -> 删除；最后一个版本删除 package 条目；tag 清理。
- 每个写操作都创建 history 快照（可用 `listHistory` 断言）。

- [ ] **Step 2: 实现 `package-store.ts`**

关键逻辑：
- `createPackageVersion`：构建候选 `PackageFile`，调用 `resolvePackageGraph(candidate, skillFile, [{ name, version }])`；失败不写。
- `copyPackageVersion`：从源版本复制 `packages` / `skills`，应用 overrides/drops；目标 package 不存在时创建条目；`description` 缺省继承源；构建候选并解析；写。
- `setPackageTag`：先解析目标版本，再写。
- `removePackageVersion`：
  - 读 route，检查 `target.packages[name]?.resolved === version`。
  - 读 package，检查其他 package 版本的 `packages[name] === version`。
  - 构建候选，删除版本；如果 package 没有版本则删除条目；清理指向该版本的 tags。
  - 对候选执行 `validateAllPackages`。
  - 写。
- 所有写操作包在 `withHistory(paths, '<reason>', async () => { ... })`。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/package-store.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/package-store.ts packages/core/src/package-store.test.ts
git commit -m "feat: add versioned package composition store"
```

---

### Task 5: Route v2（package lock、range/tag、target 图校验）

**Files:**
- Modify: `packages/core/src/route.ts`
- Modify: `packages/core/src/route.test.ts`
- Modify: `packages/core/src/target.ts`
- Modify: `packages/core/src/target.test.ts`

**Interfaces:**
- Consumes: `package-store.ts`, `package-graph.ts`, `skill-store.ts`。
- Produces:
  - `readRouteFile(paths): Promise<RouteFile>`
  - `writeRouteFile(paths, file): Promise<void>`
  - `findTarget(route, targetId): TargetRoute | undefined`
  - `addRouteEntry(input: { paths; targetId; name; requested }): Promise<PackageLock>`
  - `removeRouteEntry(input: { paths; targetId; name }): Promise<boolean>`

- [ ] **Step 1: 更新 target 测试**

`addTarget` 结果必须是 `packages: {}`，不再是 `skills: {}`。

- [ ] **Step 2: 写失败的 route 测试**

覆盖：
- 添加 exact package 版本：lock 有 `requested`、`resolved`、`integrity`（`sha256-` 前缀）、`enabled: true`；route 中 key 是 `packages`。
- semver range 解析到最高版本。
- tag 解析。
- 添加包含嵌套 package 的 package，lock integrity 与传递闭包一致。
- 添加第二个 package，使用同一 skill 同版本 -> 允许。
- 添加第二个 package，使用同一 skill 不同版本 -> `SKILL_VERSION_CONFLICT`，route 不变。
- 添加内部有环的 package（手工写入 package.json）-> `PACKAGE_CYCLE`，route 不变。
- 缺失 package / 版本 -> `PACKAGE_NOT_FOUND` / `VERSION_NOT_FOUND`。
- 删除 route entry 只改 route。
- `resolvePackageVersion` 的 tag/range/exact 测试可保留在 package-store 测试中；route 测试只验证 lock。

- [ ] **Step 3: 实现 route v2**

`addRouteEntry`：
```ts
const route = await readRouteFile(paths);
const packageFile = await readPackageFile(paths);
const skillFile = await readSkillFile(paths);
const resolved = resolvePackageVersion(packageFile, input.name, input.requested);
const candidate: TargetRoute = {
  ...target,
  packages: {
    ...target.packages,
    [input.name]: {
      requested: input.requested,
      resolved: resolved.version,
      integrity: computePackageIntegrity(packageFile, [{ name: input.name, version: resolved.version }]),
      enabled: true,
    },
  },
};
resolvePackageGraph(packageFile, skillFile, Object.entries(candidate.packages)
  .filter(([, lock]) => lock.enabled !== false)
  .map(([name, lock]) => ({ name, version: lock.resolved })));
route.targets[index] = candidate;
await withHistory(paths, 'add-route-entry', () => writeRouteFile(paths, route));
return lock;
```
- 失败时 route 不写。
- `target.ts` 初始化 `packages: {}`。

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run packages/core/src/route.test.ts packages/core/src/target.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/route.ts packages/core/src/route.test.ts packages/core/src/target.ts packages/core/src/target.test.ts
git commit -m "feat: route targets to package versions"
```

---

### Task 6: Apply v2（package 展开为 skill 投影）

**Files:**
- Modify: `packages/core/src/apply.ts`
- Modify: `packages/core/src/apply.test.ts`

**Interfaces:**
- Consumes: `route.ts`, `package-store.ts`, `skill-store.ts`, `package-graph.ts`, `links.ts`。
- Produces: 现有 `ApplyReport` / `ApplyOperation` / `ApplyConflict` 类型保持不变；`name` 表示 skill 名。

- [ ] **Step 1: 写失败的 apply 测试**

覆盖：
- 两个 skill，一个 package 同时组合两者，apply 后 target 有两个 skill 链接。
- package -> nested package -> skill，apply 后 target 有传递 skill 链接。
- 两个 package 引用同一 skill 同版本：target 只有一个链接，operations 只有一个 create。
- 两个 package 引用同一 skill 不同版本：apply 抛 `SKILL_VERSION_CONFLICT`，target 不变。
- dry-run 不创建链接。
- 已正确链接 -> `skip`。
- route 版本变化 -> `replace-link`，链接指向新 skill 版本。
- `--prune` 只删除受管且不再需要的链接。
- 未托管同名目录 -> conflict，不删除。
- route 引用缺失 skill 内容 -> 抛错。
- 操作不出现 package 目录；`target/<package>` 不存在。

- [ ] **Step 2: 实现 apply v2**

```ts
const route = await readRouteFile(paths);
const packageFile = await readPackageFile(paths);
const skillFile = await readSkillFile(paths);

for (const target of selectedTargets) {
  const roots = Object.entries(target.packages)
    .filter(([, lock]) => lock.enabled !== false)
    .map(([name, lock]) => ({ name, version: lock.resolved }));
  const resolution = resolvePackageGraph(packageFile, skillFile, roots);
  const desired = new Map(
    [...resolution.skills.values()].map((skill) => [skill.name, skill]),
  );
  // 投影 desired 中的 skill
}
```
- 每个 package lock 先验证 integrity：
```ts
const expected = computePackageIntegrity(packageFile, [{ name, version: lock.resolved }]);
if (expected !== lock.integrity) throw new SkillinkError('PACKAGE_INTEGRITY_MISMATCH', ...);
```
- `sourceDir = getSkillDir(paths, skill.name, skill.version)`。
- `desired` key 是 skill 名。
- `--prune` 逻辑沿用旧实现，desired 为 skill 名集合。
- copy 模式保持现有明确错误（或 Task 13 可选实现）。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/apply.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/apply.ts packages/core/src/apply.test.ts
git commit -m "feat: project package compositions as skills"
```

---

### Task 7: Status v2

**Files:**
- Modify: `packages/core/src/status.ts`
- Modify: `packages/core/src/status.test.ts`

**Interfaces:**
- Consumes: `route.ts`, `package-store.ts`, `skill-store.ts`, `package-graph.ts`。
- Produces: `StatusEntry` 增加可选 `packageName?: string`；现有 state 不变。

- [ ] **Step 1: 写失败的 status 测试**

覆盖：
- 正确链接的 skill -> `ok`。
- 缺失链接 -> `missing`。
- 未托管真实目录 -> `conflict`。
- 链接指向旧版本 -> `wrong-version`。
- 移除 route package 后，受管链接 -> `extra`。
- package 解析失败（缺失 package 版本）-> 一条 `missing`，`packageName` 有值。
- 两个 package 同 skill 同版本 -> 一条 entry。
- 两个 package 同 skill 不同版本 -> 一条 `conflict`，detail 含 `SKILL_VERSION_CONFLICT`。

- [ ] **Step 2: 实现 status v2**

- 先解析每个 target 的 package 根；捕获 `SkillinkError`：
  - `SKILL_VERSION_CONFLICT` / `PACKAGE_CYCLE` / `PACKAGE_INTEGRITY_MISMATCH` -> 添加一条 `targetId` 级 conflict entry，`name: '<package>'`，`packageName` 可选。
- 解开 skill map 后按 skill 比较链接。
- `desired` 为 skill 名集合。
- `extra` 只报告受管链接。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/status.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/status.ts packages/core/src/status.test.ts
git commit -m "feat: report status for resolved skills"
```

---

### Task 8: Doctor v2

**Files:**
- Modify: `packages/core/src/doctor.ts`
- Modify: `packages/core/src/doctor.test.ts`

**Interfaces:**
- Consumes: 三个 store + `package-graph.ts` + `status.ts`。
- Produces: `DoctorIssueCode` 增加 `PACKAGE_MISSING_VERSION`, `PACKAGE_INTEGRITY_MISMATCH`, `SKILL_VERSION_CONFLICT`, `SKILL_MD_MISSING`, `UNUSED_PACKAGE_VERSION`, `SKILL_NOT_FOUND`。

- [ ] **Step 1: 写失败的 doctor 测试**

覆盖：
- skill 内容目录缺失 -> `MISSING_CONTENT`。
- 孤儿 skill 目录 -> `ORPHAN_CONTENT`。
- skill 内容目录缺少 `SKILL.md` -> `SKILL_MD_MISSING`。
- package 引用不存在的 skill -> `SKILL_NOT_FOUND`。
- route 引用不存在的 package 版本 -> `ROUTE_MISSING_VERSION`。
- route integrity 与 package 传递闭包不符 -> `PACKAGE_INTEGRITY_MISMATCH`。
- package 图有环 -> `INVALID_CONFIG` 或 `PACKAGE_CYCLE` issue。
- target 内 skill 版本冲突 -> `SKILL_VERSION_CONFLICT`。
- 未被 route 引用的 package 版本 -> `UNUSED_PACKAGE_VERSION`（warning，仍使 `ok: false` 或单独 warning？统一 `ok: false` 太严格；增加 `warnings` 或忽略。为简单，MVP 只报告 `issues`，`UNUSED_PACKAGE_VERSION` 作为 issue，`ok: false`。后续可加 severity）。
- 链接问题沿用 status。

- [ ] **Step 2: 实现 doctor v2**

- 读取三文件；任一 schema 失败 -> `INVALID_CONFIG`。
- `validateAllPackages` 捕获环/冲突 -> issue。
- 遍历 `skill.json.skills` 检查内容和 `SKILL.md`。
- 遍历 `skills/` 检查孤儿。
- 遍历 package 版本检查引用的 skill/package。
- 遍历 route target 的 package lock：
  - package/version 存在。
  - integrity 匹配。
  - `resolvePackageGraph` 可解析。
- 调用 `status` 检查链接。
- 统计被 route 引用的 package 版本，未引用 -> `UNUSED_PACKAGE_VERSION`。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/doctor.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/doctor.ts packages/core/src/doctor.test.ts
git commit -m "feat: diagnose package graph and skill content"
```

---

### Task 9: GC v2

**Files:**
- Modify: `packages/core/src/gc.ts`
- Modify: `packages/core/src/gc.test.ts`
- Modify: `packages/core/src/gc-failure.test.ts`

**Interfaces:**
- Consumes: `route.ts`, `package-store.ts`, `skill-store.ts`, `package-graph.ts`。
- Produces: `GcCandidate` 仍表示 skill 版本；`name` 是 skill 名。

- [ ] **Step 1: 写失败的 GC 测试**

覆盖：
- 未被任何 route 引用的 skill 版本 -> candidate。
- 被 route package 直接引用 -> 不 candidate。
- 被 route package 嵌套引用 -> 不 candidate。
- `enabled: false` 的 target/package lock 仍算引用 -> 不 candidate。
- 被 tag 保留 -> 不 candidate（`keepTagged` true）。
- 仅被未引用 package 版本引用 -> candidate；删除后 doctor 报 `SKILL_NOT_FOUND`。
- `maxAgeDays` 生效。
- apply 后内容进 `trash/`，`skill.json` 更新。
- 写 `skill.json` 失败时内容回滚。
- package 配置不受 GC 影响。

- [ ] **Step 2: 实现 GC v2**

- 引用集合：遍历所有 target（不过滤 `enabled`），把每个 `packages` lock 作为根，用 `resolvePackageGraph` 展开，收集 `skill@version`；再收集 `skill.json` 中所有 tag 指向的版本。
- 未被 route 引用的 package 版本不参与引用集合；它们引用的 skill 可以被 GC，doctor 后续报告悬空。
- 遍历 `skillFile.skills`，跳过 referenced/tagged/recent。
- 删除时先 `rename` 到 `trash/`，再更新 `skill.json`；失败回滚。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/gc.test.ts packages/core/src/gc-failure.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/gc.ts packages/core/src/gc.test.ts packages/core/src/gc-failure.test.ts
git commit -m "feat: collect unreferenced skills through package graph"
```

---

### Task 10: History v2（三文件快照与回滚）

**Files:**
- Modify: `packages/core/src/history.ts`
- Modify: `packages/core/src/history.test.ts`

**Interfaces:**
- Consumes: 三个 store + `package-graph.ts`。
- Produces: `HistoryEntry` 不变；快照目录包含 `route.json`、`package.json`、`skill.json`、`meta.json`；`meta.json` 增加 `format: 2`。

- [ ] **Step 1: 写失败的 history 测试**

覆盖：
- 添加 target 后快照包含三个文件，`schemaVersion` 都是 2。
- 空配置快照：`targets: []`、`packages: {}`、`skills: {}`。
- 快照 newest first、最多 50。
- 回滚同时恢复三个文件。
- 回滚前校验 package 图；快照中图有环 -> 拒绝，当前文件不变。
- skill 内容缺失但从 `trash/` 可恢复 -> 恢复。
- skill 内容缺失且不在 trash -> `VERSION_NOT_FOUND`，当前文件不变。
- 旧 v1 快照（没有 `skill.json`/`format: 2`）不出现在 `listHistory`，不能回滚。
- 写入顺序：`skill.json` -> `package.json` -> `route.json`（可通过失败注入测试或代码审查断言）。

- [ ] **Step 2: 实现 history v2**

- `createHistorySnapshot` 读取三文件，写三个文件，`meta.json` 写 `{ id, createdAt, reason, format: 2 }`。
- `listHistory` 只读取 `meta.format === 2` 的条目。
- `restoreHistorySnapshot` 读取并解析三文件；调用 `validateAllPackages`；检查所有被引用的 skill 内容存在或 trash 可恢复；快照当前状态；恢复内容；写 `skill.json`、`package.json`、`route.json`。
- `planContentRestores` 遍历 `skillFile.skills`。
- 旧 `skills.json` 逻辑删除。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/history.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/history.ts packages/core/src/history.test.ts
git commit -m "feat: snapshot and restore all three config files"
```

---

### Task 11: v1 -> v2 迁移

**Files:**
- Create: `packages/core/src/migrate.ts`
- Test: `packages/core/src/migrate.test.ts`

**Interfaces:**
- Produces: `migrateV1ToV2(paths): Promise<{ migrated: boolean; skillCount: number; packageCount: number; targetCount: number }>`
- `migrate` 检测 `paths.skillsFile`（旧 `skills.json`）是否存在，且 `paths.skillFile` 不存在。

- [ ] **Step 1: 写失败的迁移测试**

覆盖：
- 旧 `skills.json` 有 demo@1.0.0，旧 route 有 target.skills.demo -> 生成 `skill.json`、`package.json`、新 route：
  - `skill.json.skills.demo.versions['1.0.0']` 存在，无 `source`。
  - `package.json.packages.demo.versions['1.0.0'].skills.demo === '1.0.0'`。
  - 新 route `targets[0].packages.demo.resolved === '1.0.0'`，integrity 为 `sha256-`。
  - 旧 `skills.json` 移入 `trash/<timestamp>/`。
- 旧 package 有多个版本 -> 新 package 多版本。
- 旧 target 有多个 skill -> 每个生成同名 package。
- 旧 package 的 `description` 和 `tags` 同时出现在新 skill 条目和新 package 条目。
- 旧 route 的 `requested: "latest"` 保留；因为 package tags 已复制，之后 `route add` 仍能解析。
- 没有旧文件 -> `{ migrated: false }`，不写新文件。
- 已有新 `skill.json` -> 不覆盖，抛错提示已迁移。
- 旧 package 没有版本 -> 预检失败，列出 package 名，旧文件不变。
- 旧版本内容目录缺失 -> 预检失败。
- 旧版本内容根目录没有 `SKILL.md` -> 预检失败，即使旧 `kind` 是 `skill`。
- 旧 tag 指向缺失版本 -> 预检失败。
- 旧 route 引用缺失版本 -> 预检失败，旧文件不变。
- 迁移失败时三个新文件都不存在或保持迁移前状态。

- [ ] **Step 2: 实现 `migrate.ts`**

- 读取旧 `skills.json` 和旧 route（用局部 schema，不依赖已删除的旧类型）。
- 预检所有旧条目：package 至少一个版本；每个版本内容目录存在且根目录有 `SKILL.md`；tag 指向存在版本；route 引用存在。任一失败：收集完整问题列表，抛 `IO_ERROR`/`ROUTE_INVALID`，不写任何新文件。
- 构建候选三文件：
  - skill 条目保留旧 versions 的 integrity/fileCount/size/built/metadata；
  - skill 条目和同名 package 条目都复制旧 description/tags；
  - package 版本 `skills` 为 `{ <name>: <version> }`；
  - route `requested` 原样保留，`resolved` 取旧 lock，`integrity` 用 `computePackageIntegrity`。
- 校验新 package 图（`validateAllPackages`）。
- 先把旧 `skills.json` 复制到 `trash/<timestamp>/skills.json`，再写三个新文件。
- 任一写入失败：删除已写的新文件，保留旧 `skills.json` 和旧 route。
- 成功后旧 `skills.json` 从控制面移除（已在 trash 中保留）。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run packages/core/src/migrate.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/migrate.ts packages/core/src/migrate.test.ts
git commit -m "feat: migrate v1 skills.json to package and skill files"
```

---

### Task 12: CLI 重写

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: 所有新 core 导出。
- Produces: 命令组 `skill`、`package`、`target`、`route`，以及 `init/migrate/apply/status/doctor/gc/history/rollback`。

- [ ] **Step 1: 重写 CLI 测试**

覆盖：
- `--help` 退出 0。
- `init` 创建 `route.json`、`package.json`、`skill.json`。
- `skill add` 无 `SKILL.md` -> 退出 1，错误含 `SKILL_MD_REQUIRED`。
- `skill add` 有 `SKILL.md` -> 成功，`skill.json` 有记录。
- `package create demo@1.0.0 --skill pdf@1.0.0` -> 成功。
- `route add project-a demo@1.0.0` -> route lock 是 package。
- `apply` -> target 有 skill 链接，没有 package 目录。
- `status --json` -> skill entry。
- `package copy demo@1.0.0 demo@1.1.0 --skill pdf@1.1.0` -> 成功。
- 两个 package 需要 pdf 不同版本 -> `route add` 退出非 0，错误含 `SKILL_VERSION_CONFLICT`。
- `skill tag` / `skill remove` / `package tag` / `package remove`。
- `history --json` / `rollback --apply` 恢复三文件。
- `gc` dry-run/apply。
- `migrate` 从 v1 迁移；旧条目缺少 `SKILL.md` 时退出非 0，错误列出条目，旧文件不变。
- `add` 作为 `skill add` 别名。

- [ ] **Step 2: 实现 CLI**

- `ensureHome` 创建目录和三个空文件。
- `init` 检测旧 `skills.json` 并调用 `migrateV1ToV2`；否则写空文件。
- 命令解析：
  - `skill add <folder> [--name] [--version]` -> `importSkill`。
  - `skill list` -> `readSkillFile`。
  - `skill tag <skill@version> <tag>`。
  - `skill remove <skill@version>`。
  - `package create <name@version> --skill <skill@version>... [--package <package@version>...] [--description]`。
  - `package copy <source@version> <target@version> [--skill ...] [--package ...] [--drop-skill ...] [--drop-package ...] [--description]`。
  - `package list`、`package tag`、`package remove`。
  - `route add` 语义改为 package。
  - 其余命令沿用。
- 退出码：`UNMANAGED_CONFLICT` 3；其他 1。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run apps/cli/src/cli.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/index.ts apps/cli/src/cli.test.ts
git commit -m "feat: expose skill/package workflow in CLI"
```

---

### Task 13: Desktop IPC 与快照

**Files:**
- Modify: `apps/desktop/src/shared.ts`
- Modify: `apps/desktop/src/ipc-schemas.ts`
- Modify: `apps/desktop/src/ipc-schemas.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- `DesktopSnapshot = { home; skills: SkillFile; packages: PackageFile; route: RouteFile; status; doctor }`
- `DesktopApi`：
  - `importSkill(input: ImportSkillRequest)`
  - `createPackage(input: CreatePackageRequest)`
  - `copyPackage(input: CopyPackageRequest)`
  - `removePackage(input: PackageRemoveRequest)`
  - `packageTag(input: PackageTagRequest)`
  - `skillTag(input: SkillTagRequest)`
  - `skillRemove(input: SkillRemoveRequest)`
  - `routeAdd(input: RouteAddRequest)`（`name` 是 package 名）
  - `routeRemove`、`addTarget`、`apply`、`gc`、`history`、`rollback`、`chooseFolder`

- [ ] **Step 1: 更新 IPC schema 测试**

覆盖：
- `ImportSkillRequestSchema` 接受 sourceDir/name/version，拒绝空 sourceDir。
- `CreatePackageRequestSchema` 接受 `{ name, version, skills: { pdf: '1.0.0' } }`、`packages`；拒绝空依赖。
- `CopyPackageRequestSchema` 接受 source/target/overrides/drops。
- `PackageRemoveRequestSchema`、`PackageTagRequestSchema`、`SkillTagRequestSchema`、`SkillRemoveRequestSchema`。
- `RouteAddRequestSchema` 的 `name` 是 package；空值拒绝。

- [ ] **Step 2: 实现 IPC**

- `getSnapshot` 读 `readSkillFile`、`readPackageFile`、`readRouteFile`。
- handlers 调用新 core 函数。
- preload 暴露新 API。

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run apps/desktop/src/ipc-schemas.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/shared.ts apps/desktop/src/ipc-schemas.ts apps/desktop/src/ipc-schemas.test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/preload/index.ts
git commit -m "feat: expose package/skill model over desktop IPC"
```

---

### Task 14: Desktop 页面

**Files:**
- Rename: `apps/desktop/src/renderer/src/LibraryView.tsx` -> `SkillsView.tsx`
- Rename test: `LibraryView.test.tsx` -> `SkillsView.test.tsx`
- Create: `apps/desktop/src/renderer/src/PackagesView.tsx`
- Create test: `PackagesView.test.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/TargetsView.tsx`
- Modify: `apps/desktop/src/renderer/src/TargetsView.test.tsx`
- Modify: `apps/desktop/src/renderer/src/SnapshotView.tsx`
- Modify: `apps/desktop/src/renderer/src/SnapshotView.test.tsx`
- Modify: `apps/desktop/src/renderer/src/DoctorView.tsx` if type changes
- Modify: `apps/desktop/src/renderer/src/HistoryView.tsx` if type changes

**Interfaces:**
- `SkillsView` props: `skills: SkillFile`, `gcReport`, `busy`, `onBrowse`, `onImportSkill`, `onSkillTag`, `onSkillRemove`, `onGc`。
- `PackagesView` props: `packages: PackageFile`, `skills: SkillFile`, `busy`, `onCreatePackage`, `onCopyPackage`, `onPackageTag`, `onPackageRemove`。
- `TargetsView` props: `targets`, `packages`, `statusEntries`, `busy`, `onAddTarget`, `onRouteAdd`（package）, `onApply`。
- `SnapshotView` 显示 skills/packages/targets。

- [ ] **Step 1: 更新 SkillsView 测试**

断言：
- 标题 `Skills`。
- 导入表单提示必须含 `SKILL.md`。
- 列表显示 skill 版本，不显示 `kind`/`source`。
- tag/remove/GC 回调参数是 skill。

- [ ] **Step 2: 写 PackagesView 测试**

断言：
- 创建表单有 package 名、版本、描述、技能行（每行 `skill@version`）和嵌套 package 行。
- 提交调用 `onCreatePackage`，参数为 `{ name, version, description, skills, packages }`。
- 列表显示 package 版本和 composition。
- Copy 按钮调用 `onCopyPackage`。
- 空依赖前端阻止提交。

- [ ] **Step 3: 更新 Targets/Snapshot 测试**

- Targets 显示 package 数量，不显示 skill 数量作为依赖。
- 分配表单的 label 是 `Package`。
- Snapshot 统计 skills/packages/targets。
- 文案中不再出现 `skills.json`，改为 `skill.json`。

- [ ] **Step 4: 实现页面**

- App 导航：Overview / Targets / Skills / Packages / History / Doctor。
- App handlers 调用新 API。
- `SkillsView` 从 `LibraryView` 改名并调整类型/文案。
- `PackagesView` 使用 textarea 输入每行 `skill@version` / `package@version`（MVP 简单方案）。
- `TargetsView` 的 route 表单输入 package 名。
- `SnapshotView` 更新统计和文案。

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run apps/desktop/src/renderer/src`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat: add package composition view and skill-first UI"
```

---

### Task 15: 清理、文档、全量验证

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/paths` usages
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Delete any remaining v1 modules/tests not used:
  - `packages/core/src/library.ts` (already deleted)
  - `packages/core/src/import-folder.ts` (already deleted)
  - old `skills.json` references
- Test: full suite

- [ ] **Step 1: 清理导出**

`packages/core/src/index.ts` 导出：
```ts
apply, doctor, folder-scan, gc, history, import-skill, json-store,
links, migrate, package-graph, package-name, package-store, path-policy,
route, skill-store, status, target
```

- [ ] **Step 2: 全局搜索旧引用**

Run: `rg "skills\.json|readSkillsFile|writeSkillsFile|importFolder|target\.skills|SkillLock|SkillsFile|LibraryVersion|kind" packages apps`
Expected: 只剩迁移代码中刻意保留的 v1 字段、旧历史快照说明、或文案。删除其余。

- [ ] **Step 3: 更新 README**

- 三个全局文件：`route.json`、`package.json`、`skill.json`。
- 唯一实体：`skills/<skill>/<version>/SKILL.md`。
- 命令示例：`skill add`、`package create`、`package copy`、`route add`、`apply`。
- 说明 package 是配置，不投影。

- [ ] **Step 4: 更新 ARCHITECTURE.md**

把 v1.2 的 `skills.json` 模型替换为 v2：
- 三层依赖图。
- package 引用 package/skill。
- DFS 环检测和生命周期校验。
- skill 去重/冲突。
- package copy。
- 三文件历史快照。
- 迁移：全有或全无，旧条目必须有 `SKILL.md`，旧 tags/description 同时复制到 skill 和 package。
- GC 引用口径：route 传递闭包 + skill tags；未引用 package 不保护内容，doctor 报悬空。
- 删除“包是任意文件夹”“SKILL.md 可选”的表述。

- [ ] **Step 5: 全量测试**

Run: `pnpm test`
Expected: 所有测试 PASS。

- [ ] **Step 6: 类型检查**

Run: `pnpm typecheck`
Expected: 0 errors。

- [ ] **Step 7: 构建**

Run: `pnpm build`
Expected: CLI 和桌面端构建成功。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: document package/skill three-layer model"
```

---

## 执行顺序与验证

- 任务 1-4 是纯新增/替换底层，先跑对应测试。
- 任务 5-10 按 route -> apply -> status -> doctor -> gc -> history 顺序，避免接口互相等待。
- 任务 11 迁移依赖前三层完成。
- 任务 12 CLI 是第一个完整用户闭环，完成后手动跑一次：
  ```bash
  pnpm dev:cli -- init
  pnpm dev:cli -- skill add <folder-with-SKILL.md> --name pdf --version 1.0.0
  pnpm dev:cli -- package create base@1.0.0 --skill pdf@1.0.0
  pnpm dev:cli -- package create frontend@1.0.0 --package base@1.0.0 --skill review@1.0.0
  pnpm dev:cli -- target add <empty-target-dir> --id project-a
  pnpm dev:cli -- route add project-a frontend@1.0.0
  pnpm dev:cli -- apply
  pnpm dev:cli -- status
  ```
  预期：target 下有 `pdf`、`review` 两个 skill 链接，没有 `frontend`/`base` 目录。
- 任务 13-14 完成 GUI。
- 任务 15 全量验证。
