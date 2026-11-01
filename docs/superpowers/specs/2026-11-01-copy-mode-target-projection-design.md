# Copy Mode Target Projection Design

> 日期：2026-11-01
> 状态：设计待确认
> 范围：实现 `target.mode: copy` 的受管投影

## 1. 意图

target 目录已经有 `link` 和 `copy` 两种连接方式。`link` 已完整实现；`copy` 目前被 `COPY_MODE_UNSUPPORTED` 拦截，doctor 会报 `UNSUPPORTED_MODE`。本次实现 copy 模式，让 `target add --mode copy`、`apply`、`status`、`doctor`、target GC 和 GUI 都能正常工作。

copy 模式复用与 link 相同的受管目标锁定机制：

- `route.json` 是唯一所有权来源；
- route 期望集合中的同名条目就是受管条目，不看它由谁创建；
- 集合外条目不被 apply/status 触碰；
- 同名条目形态或内容不符时，由 apply 删除并重建；
- `target remove` / `target disable` / `package disable` / `route remove` 按 route 解析结果清理同名链接或真实目录。

## 2. 目标与非目标

### 目标

1. `target add --mode copy` 创建 copy target；GUI 可选择 copy。
2. `apply` 把 skill 库内容完整复制到 `target/<skill>`，生成真实目录，不生成链接。
3. copy 目标中的受管目录与 `skill.json` 的 `integrity/fileCount/size` 一致。
4. copy 目标被用户修改后，`status` 报 `wrong-version`，`apply` 整目录替换为 skill 库版本。
5. copy 目标中同名条目是链接、文件或其他形态时，`status` 报 `wrong-mode`，`apply` 删除并重建为真实目录。
6. link 目标中同名条目是真实目录时，保持现有行为：删除并重建为链接。
7. copy 目录清理复用现有 target GC。
8. 更新 CLI 帮助、GUI、i18n、README、ARCHITECTURE 和测试。

### 非目标

- 不做增量同步，不保留 copy 目标 skill 目录中的额外文件；
- 不把 copy 目标当作新的所有权来源；
- 不实现 link/copy 之间的原地转换命令；转换仍通过重新添加 target 或手工修改 route 后 apply；
- 不改变 package、skill、route 的配置格式；
- 不改动历史设计文档。

## 3. 行为契约

### 3.1 apply

对每个启用的 target、每个 route 解析出的 skill：

| 目标现状 | `link` mode | `copy` mode |
|---|---|---|
| 不存在 | `create-link` | `create-copy` |
| 链接指向正确内容 | `skip` | `wrong-mode` → `replace-copy` |
| 真实目录内容正确 | `wrong-mode` → `replace-link` | `skip` |
| 内容不符 | `wrong-version` → `replace-link` | `wrong-version` → `replace-copy` |
| 普通文件 / 其他形态 | `wrong-mode` → `replace-link` | `wrong-mode` → `replace-copy` |
| 断链 | `broken-link` → `replace-link` | `wrong-mode` → `replace-copy` |

copy 执行规则：

1. 先在 target 目录内部的临时目录 `.skillink-tmp-<uuid>` 中完成复制并校验，再替换目标条目。临时目录必须位于 target 内部，因为 target 本身可能是 junction/symlink；放在 target 父目录不能保证与最终条目同卷。
2. 复制保留空目录、隐藏文件、普通文件和可用的权限位，规则与导入 skill 一致。
3. 复制完成后重新扫描临时目录，必须与 `skill.json` 的 `integrity/fileCount/size` 一致。
4. 校验通过后删除旧条目（链接用 unlink，其他用 `rm -rf`），再把临时目录 rename 到 `target/<skill>`。
5. 同一 target 内先完成全部配置、package 图、skill 内容、路径和条目预检，再开始写文件系统。
6. 进程内回滚会删除本次创建/替换的 copy 目录，并恢复被替换的旧链接；被删除的旧真实目录不恢复。这与现有 link 替换真实目录的限制一致。
7. 不自动清扫崩溃遗留的 `.skillink-tmp-*` 目录，因为合法 skill 名称也可能以 `.` 开头；清理由用户手工完成，doctor 暂不报告。临时目录名称不参与 route 所有权判断。

### 3.2 status

- copy 模式下真实目录内容匹配 → `ok`；
- 真实目录内容不匹配 → `wrong-version`；
- 不存在 → `missing`；
- 链接、文件或其他形态 → `wrong-mode`；
- 只报告 route 期望集合中的同名条目；
- disabled target/package 行为与 link 相同。

### 3.3 doctor

- 删除 `v2.0 only supports link mode` 的 `UNSUPPORTED_MODE` 检查；
- copy target 参与现有链接/目录健康检查；
- `UNSUPPORTED_MODE` 错误码暂时保留，避免破坏外部类型消费；当前 schema 不会再产生该问题。

### 3.4 target GC

现有 `gcTargetEntries` 已能删除链接和真实目录，copy 模式无需新增所有权字段或 manifest。`target remove`、`target disable`、`package disable`、`route remove`、`route add` 覆盖版本时继续使用 route 解析结果清理。

### 3.5 错误码

- `COPY_MODE_UNSUPPORTED` 不再由 `target add` / `apply` 抛出；错误码和 i18n 文案暂时保留，兼容旧调用方。
- 无效 `--mode` 值由 `addTarget` 直接拒绝，返回 `ROUTE_INVALID`，避免写入非法配置。
- 临时目录扫描后 `kind` 不是 skill（例如复制期间 `SKILL.md` 消失）时报 `SKILL_MD_MISSING`。
- 临时目录重扫结果与 `skill.json` 的 `integrity/fileCount/size` 不一致时报 `SKILL_INTEGRITY_MISMATCH`。
- 文件复制、chmod、rename、清理等文件系统操作失败统一包装为 `IO_ERROR`，details 包含 target、skill、源路径和目标路径，原始错误放在 `cause`。
- 源目录扫描自身抛出的 `UNSAFE_PATH` / `IMPORT_LIMIT_EXCEEDED` 保留原错误码，不转换成 `IO_ERROR`。

## 4. 实现方案

### 4.1 复制原语

新增 `packages/core/src/copy.ts`（名称可随实现调整）：

```ts
export async function copySkillDirectory(
  sourceDir: string,
  destination: string,
  expected: SkillVersion,
): Promise<void>;
```

职责：

- 用 `scanFolder(sourceDir, DEFAULT_IMPORT_LIMITS)` 获取目录清单；
- 拒绝非 skill 目录和目录内链接；
- 创建空目录、复制文件、按清单 chmod；
- 扫描 destination 并校验 `kind/integrity/fileCount/size`；
- 失败时清理 destination 并抛出带上下文的错误。

不修改现有 `importSkill` 行为；如果实现中发现两者复制逻辑重复过多，可以后续单独抽公共 helper，但不属于本次范围。

### 4.2 apply

- `planTarget` 删除 `mode !== 'link'` 拦截。
- 根据 comparison 和 target mode 生成 `create-copy` / `replace-copy` 新操作类型。
- `executePlan`：
  - `create-copy`：复制到临时目录 → 校验 → rename 到目标 → 注册回滚；
  - `replace-copy`：复制到临时目录 → 校验 → 删除旧条目 → rename → 注册回滚；
  - link 分支保持不变。
- `ApplyOperationKind` 增加 `create-copy` 和 `replace-copy`，GUI 通过 i18n 显示。

### 4.3 target / status / doctor

- `addTarget` 允许 `copy`，拒绝未知 mode。
- `status` 删除 `mode !== 'link'` 的 unsupported 分支；`compareTargetEntry` 已支持 copy。
- `doctor/config.ts` 删除 `UNSUPPORTED_MODE` 检查。
- `target-gc.ts` 无需改动。

### 4.4 CLI 与 GUI

- CLI `target add --mode` 帮助改为 `Projection mode (link or copy)`。
- GUI 移除 copy 选项的 `disabled`。
- `targets.mode.copy` 文案改为 `copy` / `复制`，不再显示“coming later / 稍后支持”。
- 新增 `apply.kind.create_copy` / `apply.kind.replace_copy` 文案。
- 递增 `locales/zh-CN.json` 版本并补全新 key。

### 4.5 文档

- `README.md`：删除 copy 返回 `COPY_MODE_UNSUPPORTED` 的说明，补充 copy 示例。
- `ARCHITECTURE.md`：
  - target mode 字段说明；
  - apply/status/doctor 行为；
  - 已知限制删除“copy 未实现”；
  - 验收标准改为 copy 可用。
- 历史 `docs/superpowers/specs/2026-10-30-*` 与 plan 不修改。

## 5. 测试

### 单元 / 集成

- `target.test.ts`：copy target 可添加；未知 mode 被拒绝。
- `target-entry.test.ts`：copy 模式下真实目录内容匹配/不匹配、链接 wrong-mode。
- `apply.test.ts`：
  - copy 创建真实目录且内容一致；
  - 重复 apply 为 `skip`；
  - 修改 copy 后 apply 整目录替换并删除额外文件；
  - copy 目标中的链接被替换为真实目录；
  - link 目标中的真实目录仍被替换为链接；
  - dry-run 不创建 copy；
  - copy 源内容缺失/完整性错误时不写目标。
- `status.test.ts`：copy 的 `ok`、`missing`、`wrong-version`、`wrong-mode`，集合外条目忽略。
- `doctor.test.ts`：copy target 不报 `UNSUPPORTED_MODE`。
- `target-gc.test.ts` / `package-check.test.ts`：copy 真实目录可被清理。
- CLI 测试：`target add --mode copy --json` 成功，`target list` 输出 copy。
- GUI 测试：copy 选项可用；apply 操作标签。
- i18n 测试：新 key 在 `en` 和 `zh-CN` 都存在，locale 校验通过。

### 验证命令

```powershell
pnpm vitest run packages/core/src/target.test.ts packages/core/src/target-entry.test.ts packages/core/src/apply.test.ts packages/core/src/status.test.ts packages/core/src/doctor.test.ts
pnpm vitest run apps/cli/src/cli.test.ts apps/desktop/src/renderer/src/TargetsView.test.tsx
pnpm typecheck
pnpm test
pnpm build
```

## 6. 风险与取舍

- copy 会占用额外磁盘空间；这是 copy 模式的预期成本。
- 每次 apply 替换 copy 都会重新复制并哈希；大 skill 会变慢，但保证可复现和完整性。
- 替换旧真实目录不可恢复；沿用现有应用回滚边界。
- 临时目录位于 target 内部，进程崩溃可能留下隐藏临时目录；不把临时目录纳入 route 所有权。
- copy 目标中的修改一律视为 drift；用户需要修改 skill 时应修改 skill 库并重新导入新版本，而不是直接改 target。
- `scanFolder` 的完整性包含权限位；FAT/exFAT、部分 SMB 挂载等无法保留 mode 的文件系统上，copy target 可能持续 `wrong-version` 并导致 apply 校验失败。本次沿用现有完整性规则，不引入 content-only 模式。

## 7. 验收标准

1. `skillink target add <path> --mode copy` 成功，route 写入 `mode: "copy"`。
2. `skillink apply` 在 copy target 生成 `target/<skill>` 真实目录，内容哈希与 skill 库一致。
3. 修改 copy 目录后 `status` 报 `wrong-version`，再次 apply 恢复为 skill 库内容。
4. copy target 中同名链接被 apply 替换为真实目录。
5. link 模式行为不回归。
6. `doctor` 不再对 copy target 报 `UNSUPPORTED_MODE`。
7. GUI 可以选择 copy，CLI/GUI 的 apply 结果能显示 `create-copy` / `replace-copy`。
8. `pnpm typecheck`、相关测试、`pnpm test`、`pnpm build` 通过。
