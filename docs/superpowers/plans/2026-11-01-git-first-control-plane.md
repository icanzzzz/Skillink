# Git-first 控制面实施计划

> 日期：2026-11-01  
> 状态：已执行（2026-11-01）  
> 目标：用 git 替代 history/trash，实现控制面版本、审计、回滚；skills 内容使用独立 git；写操作自动提交并自动生成提交范围。

---

## 0. 给执行会话的前置说明

当前工作区已经有一批未提交改动，主要包括：

- 删除 `history` / `trash` 体系；
- `skill remove` / `gc` 改为直接删除，并改成“先删实体，再删 catalog 记录”；
- 新增 `package check`；
- 删除 CLI `history` / `rollback`；
- 删除 GUI History 页面；
- 更新 README / ARCHITECTURE 的部分内容。

**执行前先做：**

```bash
git status
git diff --stat
pnpm typecheck
pnpm test
```

要求：

- 不要回退、覆盖用户已有的改动；
- 本计划是在当前工作区基础上继续；
- 如果当前改动尚未提交，先确认/备份，再开始新功能；
- 每个阶段完成后运行 `pnpm typecheck` 和 `pnpm test`；
- 不要重新引入 `apply --prune`、`trash`、history 快照系统。

---

## 1. 目标与边界

### 1.1 目标

1. `SKILLINK_HOME` 成为一个 git 仓库，用于控制面版本、审计和回滚。
2. `skills/` 使用独立的 git 仓库，用于 skill 内容版本。
3. 所有产生数据变化的写命令自动提交；无变化不提交。
4. commit message 根据命令、变更文件、受影响对象自动生成。
5. 回退时通过现有 `target-gc` 删除所有当前 target 的受管投影，再恢复配置、重新 apply。
6. 保留现有 package 图、route lock、skill integrity、apply 预检。
7. 不引入 `apply --prune`；不清理未受管条目。

### 1.2 边界

**受管 skill** 定义为：

```text
当前 route.json 中 target -> package lock -> package 图 -> skill 名称
```

`target-gc` 只删除这些名称对应的投影。target 根目录中的：

- `.git`
- 普通文件
- 未知目录
- 不在 route 解析结果中的链接/目录

都视为未受管，不处理。

**因此本计划不实现：**

- `apply --prune`
- 全目录扫描删除
- trash / history 快照
- 空目录、权限位、CRLF 的完整恢复
- 损坏 target 图的强制修复（P4，可后续单独加 `--force`）

### 1.3 非目标

- 不恢复 GUI History 页面；本阶段回退能力在 CLI。
- 不改变 target-gc 的删除边界。
- 不自动清理 package.json 中的悬空 package 引用；`package check` 只清理受影响的 target 投影。
- 不追求 git 内容快照的字节级完整性；skills git 作为粗粒度内容历史。

---

## 2. 当前基线

以下内容已存在，不要重复实现：

- `packages/core/src/history.ts` 已删除；
- `packages/shared/src/paths.ts` 已移除 `historyDir` / `trashDir`；
- `skill remove` / `gc` 已改为直接删除；
- `skill remove` 当前顺序：删除实体 -> 写 `skill.json`；
- `gc` 当前顺序：删除实体 -> 写 `skill.json`；
- `package check` 已实现：检查 package 中引用的 skill 是否可用，并通过 `target-gc` 清理受影响 target 投影；
- GUI History 组件已删除；
- CLI `history` / `rollback` 已删除；
- `pnpm typecheck` 和 `pnpm test` 在最近一次检查中通过（49 个测试文件、443 个测试）。

当前缺少：

- 控制面 git 仓库初始化；
- skills 独立 git；
- 自动提交；
- git-backed `history` / `rollback`；
- home 级跨进程锁；
- 相关错误码、测试、文档。

---

## 3. 最终架构

```text
git（控制面）      -> route.json / package.json / skill.json / locales
git（skills）      -> skills/<name>/<version>/ 内容
gc                 -> 未引用 skill 内容清理
target-gc          -> 受管 target 投影清理
apply              -> 正常投影收敛（不带 prune）
CLI                -> 语义操作 + 校验 + 自动提交
```

### 3.1 目录结构

```text
%USERPROFILE%\.agents\skillink\
├─ .git/                      控制面 git
├─ .gitignore
├─ .gitattributes
├─ route.json                 tracked
├─ package.json               tracked
├─ skill.json                 tracked
├─ locales/                   tracked
├─ skills/                    独立 git 仓库；控制面 git 忽略
│  ├─ .git/
│  ├─ .gitattributes
│  └─ <name>/<version>/...
├─ settings.json              ignored（UI 偏好，不进入回滚）
├─ cache/                     ignored
├─ logs/                      ignored
├─ tmp/                       ignored
└─ .skillink.lock             ignored
```

旧版本的 `history/` / `trash/` 如果存在：

- 不主动删除；
- 加入 `.gitignore`；
- 文档说明不再使用。

### 3.2 `.gitignore`（控制面）

至少包含：

```text
/skills/
/trash/
/history/
/cache/
/logs/
/tmp/
/settings.json
.skillink.lock
```

### 3.3 `.gitattributes`

控制面和 skills 仓库都写入：

```text
* -text
```

目的：避免 Windows `core.autocrlf` 改写内容。

---

## 4. 回退设计

### 4.1 回退流程

`rollback` 的默认流程：

```ts
async function rollbackTo(revision: string) {
  // 1. 校验 revision 和历史
  const target = await git.resolveCommit(revision);
  const targetSkillFile = await git.showJson(target, 'skill.json');

  // 2. 规划 skill 内容恢复（仅检查，不修改）
  const missing = await planMissingSkillContent(paths, targetSkillFile);
  const restorable = await planSkillsGitRestores(paths, missing);
  if (restorable.missing.length > 0) {
    throw new SkillinkError(
      'SKILL_CONTENT_NOT_IN_GIT',
      'Cannot restore skill content from skills git.',
      { missing: restorable.missing },
    );
  }

  // 3. 删除当前所有 target 记录
  //    每个 removeTarget 内部会调用 target-gc
  const route = await readRouteFile(paths);
  for (const target of [...route.targets]) {
    await removeTarget({ paths, id: target.id });
  }

  // 4. 恢复三个控制面配置
  await git.checkoutPaths(target, [
    'route.json',
    'package.json',
    'skill.json',
  ]);

  // 5. 从 skills git 恢复缺失内容
  await restoreSkillContentFromGit(paths, restorable);

  // 6. 重新投影
  const applyReport = await apply({ paths });

  // 7. 一次性提交控制面 + skills
  await commitRollback(...);
}
```

### 4.2 关键规则

- **不要逐个 target 自动提交**。整个 rollback 是一个 git batch，最后只提交一次。
- 删除 target 必须调用 core 的 `removeTarget`，不能循环调用 CLI 子进程。
- `removeTarget` 会先解析该 target 的全部 package lock（含 disabled），再调用 `target-gc` 删除受管名称；这正是需要的。
- 当前 route 中所有 target 都被删除后，`route.json` 为空；随后用 git 恢复旧 route。
- 如果 target 在旧 route 中但不在当前 route 中，它不会被“删除当前 target”覆盖；这是边界外的情况，按受管定义不处理。
- 如果 `removeTarget` 因 package 图损坏失败，回退中止；P4，后续可加 `--force` 或 fallback。
- 回退失败时：
  - 控制面配置应恢复到 rollback 开始前的 HEAD，避免留下半完成配置；
  - 已经删除的 target 投影可以由下一次 `apply` 重新创建；
  - 错误中列出失败 target。

### 4.3 默认行为

建议：

```bash
skillink rollback <revision>            # 默认恢复并 apply
skillink rollback <revision> --no-apply # 只恢复配置，不重建投影
skillink rollback <revision> --json
```

不沿用旧的 `--apply` 可选参数；回退默认应该收敛 target。`--no-apply` 仅用于诊断。

---

## 5. 自动提交设计

### 5.1 提交触发

| 命令类型 | 控制面提交 | skills 提交 |
|---|---|---|
| `init` | 是（baseline） | 是（baseline） |
| `migrate` | 是 | 是（如有内容变化） |
| `skill add` | 是 | 是 |
| `skill tag` | 是 | 否 |
| `skill remove` | 是 | 是 |
| `package create/copy/tag/remove` | 是 | 否 |
| `target add/remove/enable/disable` | 是 | 否 |
| `route add/remove/enable/disable` | 是 | 否 |
| `gc --apply` | 是 | 是 |
| `locale install/remove` | 是（locales） | 否 |
| `locale use` | 否（settings 被忽略） | 否 |
| `apply` | 否（不改配置） | 否 |
| `package check` | 否（只改 target） | 否 |
| `rollback` | 是（一次） | 是（如有内容恢复） |
| 只读命令 / dry-run | 否 | 否 |

规则：

- 命令成功后才提交；
- `git status --porcelain` 无变化则跳过；
- 不创建空提交；
- 失败命令不提交；
- 批量操作只提交一次；
- 内容变更时先提交 skills，再提交控制面，保证配置不先于内容落库。

### 5.2 提交顺序

```text
1. 执行命令（写入 skills 内容 / 配置）
2. 如果 skills 有变化：git -C skills add -A && git -C skills commit
3. 如果控制面有变化：git add -A && git commit
```

如果 skills commit 失败，不提交控制面，并返回明确错误。

### 5.3 工作区状态

- 每次写命令开始时要求控制面工作区干净（上一次自动提交后应为干净）。
- 如果发现脏工作区，建议返回 `GIT_DIRTY`，提示用户先 commit 或 restore；不要把失败状态自动提交。
- `rollback` 在开始时记录 HEAD；失败时尝试恢复到该 HEAD，避免半完成配置。
- skills 仓库失败后的内容状态由 skills git 处理，不自动 reset；错误信息列出仓库和变更路径。

### 5.4 锁

所有写命令必须获取 home 级锁：

```text
<home>/.skillink.lock
```

锁内容建议：

```json
{ "pid": 1234, "startedAt": "2026-11-01T..." }
```

行为：

- `open(..., 'wx')` 获取；
- 已存在则短暂重试；
- 超过 5–10 分钟视为 stale 并清理；
- 命令结束 `finally` 释放；
- 锁覆盖命令执行 + git commit；
- 只读命令不加锁（`history` 可以不加）。

---

## 6. Commit message 自动生成

### 6.1 格式

控制面：

```text
skillink(<scope>): <action> <summary>

Command: skillink <argv...>
Changed:
- route.json
- package.json
```

skills 仓库：

```text
skillink(skills): <action> <summary>

Command: skillink <argv...>
Changed:
- pdf/1.0.0/SKILL.md
- pdf/1.0.0/file.txt
```

### 6.2 scope 推导

优先使用命令路径：

```text
init       -> init
migrate    -> migrate
skill ...  -> skill
package ...-> package
target ... -> target
route ...  -> route
gc         -> gc
locale ... -> locale
rollback   -> rollback
```

如果命令跨多个配置，或者无法判断，则从变更文件推导：

| 变更文件 | scope |
|---|---|
| `route.json` | `target` / `route` |
| `package.json` | `package` |
| `skill.json` | `skill` |
| `locales/**` | `locale` |
| `skills/**` | `skills` |
| 多个配置 | `config` |

### 6.3 示例

```text
skillink(skill): add pdf@1.0.0
skillink(package): copy frontend@1.0.0 -> frontend@1.1.0
skillink(route): add project-a frontend@1.1.0
skillink(target): remove project-a
skillink(gc): remove 3 unreferenced skill versions
skillink(rollback): restore 3f2a1c9
skillink(init): initialize control plane
```

### 6.4 生成规则

- 不调用 AI；
- 根据 argv、命令结果、`git diff --cached --name-status -z` 生成；
- subject 控制在 72 字符左右；
- body 中的变更路径最多列 20 条，超出写 `... and N more`；
- 使用英文 subject，避免 Windows git 编码和长度问题；
- 不把完整 skill 文件列表写入 subject。

### 6.5 Git 身份与 hooks

提交时使用：

```text
git -c user.name=Skillink \
    -c user.email=skillink@local \
    commit --no-verify -m "..."
```

不依赖用户全局 git 身份，不触发用户 hooks。

---

## 7. 代码改动清单

### 7.1 新增 `packages/core/src/git.ts`

职责：

```ts
isGitAvailable()
ensureControlRepo(paths)
ensureSkillsRepo(paths)
gitStatus(paths, repo)
gitAddAll(paths, repo)
gitCommit(paths, repo, message)
gitLog(paths, repo, options)
gitResolveCommit(paths, revision)
gitShowFile(paths, revision, file)
gitShowJson(paths, revision, file)
gitCheckoutPaths(paths, revision, files)
gitHead(paths, repo)
```

实现要求：

- 使用 `node:child_process.execFile`，不要拼接 shell；
- 设置 `GIT_TERMINAL_PROMPT=0`；
- 捕获 stderr，包装成 `SkillinkError`；
- 不引入新 npm 依赖；
- 支持控制面 repo 和 skills repo 两种 cwd。

### 7.2 新增 `packages/core/src/git-lock.ts`（或 `lock.ts`）

职责：

```ts
withHomeLock(paths, task)
```

实现要求：

- 锁文件在 home 根目录；
- 支持 PID/时间戳；
- stale lock 清理；
- 超时错误 `LOCK_TIMEOUT`；
- 所有写命令统一使用。

### 7.3 新增 `packages/core/src/git-commit.ts`

职责：

```ts
buildControlCommitMessage(input)
buildSkillsCommitMessage(input)
inferScope(commandPath, changedFiles)
truncateList(...)
```

输入：

- argv；
- 命令结果（可选）；
- 变更文件；
- repo 类型。

### 7.4 修改 `packages/shared/src/errors.ts`

新增错误码：

```text
GIT_UNAVAILABLE
GIT_NOT_REPOSITORY
GIT_COMMAND_FAILED
GIT_COMMIT_FAILED
GIT_DIRTY
GIT_RESTORE_FAILED
LOCK_TIMEOUT
SKILL_CONTENT_NOT_IN_GIT
```

如需要恢复 `HISTORY_NOT_FOUND`（用于 rollback 的 revision 不存在）。

### 7.5 修改 `packages/shared/src/reports.ts`

新增：

```ts
export interface GitHistoryEntry {
  id: string;        // commit hash
  createdAt: string; // ISO date
  reason: string;    // commit subject
}
```

`SnapshotReport` 保持当前状态，不重新加入 history；GUI History 不在本计划。

### 7.6 修改 `packages/core/src/init` / CLI `init`

`init` 流程：

1. 检查 `git --version`，缺失时报 `GIT_UNAVAILABLE`；
2. 创建目录（home、locales、skills、cache、logs、tmp；不创建 history/trash）；
3. 执行 v1 迁移（如需要）；
4. 创建/补全控制面 `.gitignore`、`.gitattributes`；
5. 初始化控制面 git（如果 home 下没有 `.git`）；
6. 初始化 `skills/.git`（如果不存在），写入 skills `.gitattributes`；
7. 提交 baseline：
   - `skillink(init): initialize control plane`
   - `skillink(init): initialize skills`
   - 如果 skills 仓库为空，可跳过提交，或使用 `git commit --allow-empty` 建立 baseline。
8. 输出初始化结果。

要求：

- 已有 git 仓库则复用；
- 已有 home 数据但无 git，则初始化并提交当前状态；
- 不覆盖已有的 `.gitignore` / `.gitattributes`，只补全缺失项；
- 控制面 `.gitignore` 必须包含 `/skills/`，避免 nested repo。

### 7.7 修改 `apps/cli/src/run.ts`

新增/调整：

- 写命令统一包装：

```ts
await withAutoCommit(
  { command: 'skill add', args: [...] },
  async () => { ... }
);
```

- `history` 命令（重新添加）：

```bash
skillink history [--json]
```

输出 git commits，映射为 `GitHistoryEntry`：

```text
<shortHash>  <createdAt>  <subject>
```

- `rollback` 命令（重新添加）：

```bash
skillink rollback <revision> [--no-apply] [--json]
```

实现按第 4 节。

- `package check` 已存在，确保：
  - 获取 home 锁；
  - 不产生控制面提交；
  - 输出/JSON 报告；
  - 文档加入命令参考。

- `snapshot` 保持现状（不包含 history）。

### 7.8 修改 `packages/core/src/doctor.ts`

如果 `skills/` 是独立 git 仓库，`doctor` 的 library 扫描必须跳过：

```text
skills/.git
```

否则 `.git` 会被误报为 `ORPHAN_CONTENT`。

同时检查是否有其他对 `skills/` 顶层的扫描需要跳过 `.git`。

### 7.9 修改 `packages/core/src/package-check.ts`（已有）

保持现有逻辑：

- 检查 package 版本引用的 skill 是否可用；
- 清理受影响 target 的受管投影；
- 不修改 package.json；
- 不产生 git 提交。

仅补充：

- CLI 文档；
- 测试覆盖；
- 如需在 `skill remove` / `gc` 后自动调用，先不要做；保持手动命令。

### 7.10 删除/清理

确认以下已删除内容不再被引用：

- `history.ts`
- `withHistory`
- `historyDir` / `trashDir`
- `HistoryEntry`
- GUI HistoryView
- `history` / `rollback` 旧实现

新增 git 相关代码后，再更新文档。

---

## 8. 测试计划

### 8.1 Git 基础设施

- `init` 创建控制面 `.git` 和 `skills/.git`；
- `.gitignore` 包含 `/skills/`、`/trash/`、`/history/`、`/settings.json`；
- `.gitattributes` 包含 `* -text`；
- 已有 home 数据时初始化 git 并 baseline commit；
- `git` 不可用时返回 `GIT_UNAVAILABLE`；
- commit 身份使用 `Skillink <skillink@local>`；
- `--no-verify` 生效；
- 控制面 repo 不跟踪 `skills/`、`settings.json`。

### 8.2 自动提交

- `skill add` 产生控制面 + skills 两个 commit；
- `skill tag` 只产生控制面 commit；
- `package create/copy/tag/remove` 产生控制面 commit；
- `target add/remove/enable/disable` 产生控制面 commit；
- `route add/remove/enable/disable` 产生控制面 commit；
- `gc --apply` 产生控制面 + skills commit；
- `apply` 和 `package check` 不产生 commit；
- 只读命令不产生 commit；
- dry-run 不产生 commit；
- 无变化的命令不产生空 commit；
- commit subject 包含正确的 scope 和命令摘要；
- body 包含变更文件列表。

### 8.3 Rollback

- 建立 target A/B，apply 后提交；
- 修改 route 为另一个状态；
- `rollback` 到旧 commit：
  - 删除所有当前 target 记录；
  - 每个 target 触发 target-gc；
  - 恢复旧 route/package/skill；
  - 重新 apply；
  - 只产生一条 rollback commit；
- target 被回退删除：旧 target 的投影被清理；
- target 路径被回退修改：旧路径投影被清理，新路径重新 apply；
- target 根目录中的 `.git`、普通文件、未知目录保持不变；
- 回退时缺失 skill 内容可从 skills git 恢复；
- skills git 中没有对应内容时报 `SKILL_CONTENT_NOT_IN_GIT`；
- 回退失败时控制面配置恢复到开始前 HEAD；
- `history --json` 输出 commit 列表。

### 8.4 边界与回归

- `target-gc` 只删除传入的受管名称；
- `target-gc` 删除真实目录、保留普通文件；
- 不引入 `apply --prune`；
- `package check` 能清理 broken package 影响的 target 投影；
- `skill remove` / `gc` 先删实体再删 catalog；
- `doctor` 不把 `skills/.git` 报为 orphan；
- 并发写命令被 home lock 串行化；
- 现有 package 图、route lock、apply 预检测试保持通过。

### 8.5 最终验证

```bash
pnpm typecheck
pnpm test
pnpm build        # 如果环境允许
git diff --check
```

---

## 9. 文档更新

### 9.1 README

- 增加“Git 版本控制”章节：
  - 控制面 git 跟踪范围；
  - skills 独立 git；
  - auto-commit 行为；
  - commit message 示例；
  - `--no-apply` / rollback 流程；
  - git 安装要求；
  - `settings.json` 不跟踪。
- 更新 CLI 命令参考：
  - 新增 `package check`；
  - 新增 `history`；
  - 新增 `rollback`；
  - 删除旧 `history` 快照 / trash 描述。
- 更新目录结构；
- 更新当前状态和已知限制；
- 说明 `apply` 不做 prune，target-gc 只处理受管名称。

### 9.2 ARCHITECTURE

- 数据布局：移除 `history/` / `trash/`，增加控制面 `.git` 和 `skills/.git`；
- 生命周期：增加 git auto-commit、history、rollback；
- CLI 列表：增加 `package check`、`history`、`rollback`；
- 测试策略：增加 git/rollback 测试；
- 已知限制：
  - 需要系统 git；
  - skills git 不保证空目录/权限位/CRLF 的字节级恢复；
  - 回退不处理未受管 target 条目；
  - 损坏 target 图的 rollback 失败（P4）；
  - GUI History 不在本阶段。

### 9.3 docs/language-packs.md

确认不再提 history/trash；如错误码新增，更新语言包 key 说明。

---

## 10. 验收标准

1. `init` 创建控制面 git 和 skills git，生成 `.gitignore` / `.gitattributes`，并产生 baseline commit。
2. 所有成功且有数据变化的写命令自动提交；无变化、只读、dry-run 不提交。
3. 控制面和 skills 的 commit message 由命令和变更范围自动生成，且不产生空提交。
4. `history` 能列出 git commit；`rollback <rev>` 能：
   - 删除当前所有 target 记录并触发 target-gc；
   - 恢复旧配置；
   - 重新 apply；
   - 只产生一次 rollback 提交。
5. rollback 后 target 中不存在旧 route 的受管投影；target 根目录和 `.git`/普通文件不被删除。
6. `skill remove` / `gc` 保持“先删实体，再删 catalog”；不再使用 trash。
7. `package check` 可用，并通过 target-gc 清理受影响投影。
8. `pnpm typecheck`、`pnpm test` 通过；如环境允许，`pnpm build` 通过。
9. README / ARCHITECTURE 不再包含旧 history/trash 语义。
10. 当前工作区已有改动不被回退或覆盖。

---

## 11. 风险与已知限制

1. **系统 git 依赖**  
   桌面应用用户必须安装 git。若后续要内置，可换 `isomorphic-git` 或 `dugite`，但本计划不做。

2. **提交失败**  
   命令成功但 git commit 失败时，数据已变化。建议返回 `GIT_COMMIT_FAILED`，错误详情列出仓库、变更文件和手动提交提示。

3. **skills git 内容恢复**  
   git 不保存空目录，权限位也只部分保存；按约定排除。若未来 skill 包含空子目录或特殊权限，恢复后可能 integrity 失败。建议保持 `.gitattributes * -text`，并在文档中声明限制。

4. **skills/.git 扫描**  
   如果 skills 仓库在 `skills/.git`，`doctor` 和任何目录扫描必须跳过 `.git`，否则误报 orphan。

5. **rollback 与损坏 target 图**  
   `removeTarget` 解析失败会中止回退；这是 P4，可后续加 `--force` 或 fallback scan。

6. **未受管 target 条目**  
   按约定不处理；rollback 只保证受管投影收敛。

7. **并发**  
   git 的 index.lock 不能保护 skillink 的读改写；必须使用 home lock。

8. **GUI History**  
   本阶段不恢复；CLI 提供 `history` / `rollback`。GUI 后续可按需接入 `history --json`。

9. **当前工作区改动**  
   不要执行 `git reset --hard` / `git checkout -- .` 之类的命令；用户的未提交改动是基线。

---

## 12. 建议执行顺序

1. **Git 基础设施**  
   `git.ts`、`git-lock.ts`、错误码、init 仓库初始化、`.gitignore`/`.gitattributes`。

2. **自动提交**  
   `git-commit.ts`、CLI mutation wrapper、提交顺序、无空提交、锁。

3. **History / Rollback**  
   `history` 映射 git log；`rollback` 删除所有 target + 恢复配置 + apply + 单次提交。

4. **skills 独立 git**  
   skills repo 初始化、内容提交、rollback 内容恢复、doctor 跳过 `.git`。

5. **package check / 文档 / 测试**  
   补 CLI 文档、README、ARCHITECTURE、完整测试。

6. **最终验证**  
   `pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`。

---

## 13. 执行完成后的交付物

- 新增/修改的 core git 模块；
- CLI 自动提交和 lock；
- `history` / `rollback`；
- skills 独立 git 支持；
- 测试；
- README / ARCHITECTURE 更新；
- 一份简短实现说明，列出 commit message 规则、回退流程、已知限制。

---

## 14. 执行结果（2026-11-01）

- 新增 core 模块：`git.ts`、`git-lock.ts`、`git-commit.ts`、`rollback.ts`，并新增对应测试；
- `init` 初始化控制面 git 与 `skills/.git`，写入 ignore/attributes 并提交 baseline；
- 所有写命令在 `<home>/.skillink.lock` 下执行并按需自动提交；控制面只提交受管路径；
- 新增 CLI `history` / `rollback`，rollback 会清理当前 target、恢复配置与缺失内容、删除旧 catalog 不包含的受管 skill 版本、重新 apply，并只提交一次；
- `doctor` 跳过 `skills/.git`；`package check` 保持 lock-only；
- 更新 README、ARCHITECTURE、docs/language-packs.md、简体中文语言包与测试；
- 验证：`pnpm typecheck`、`pnpm test`（56 个文件 / 507 个测试）、`pnpm build`、`git diff --check` 通过。

