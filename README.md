# Skillink

Skillink 是一个纯本地、以 **skill** 为实体、以 **package** 为组合配置的文件系统包管理器。

```text
target -> package -> skill -> 实体内容
```

- **Skill 是唯一安装单位，也是唯一实体**：内容存放在 `%USERPROFILE%\.agents\skillink\skills\<skill>\<version>\`，根目录必须有 `SKILL.md`。
- **Package 只是配置文件**：`package.json` 描述 package 版本如何组合 skill 和其他 package；它没有内容目录，也不会投影到 target。
- **Route 只依赖 package**：`route.json` 的 target 声明 package 版本，不直接声明 skill。
- **Target 最终只包含 skill**：apply 会把 package 图展开为 skill 集合，再链接 skill 文件夹（v2.0 只实现 link；copy target 在创建时直接拒绝）。
- **三个全局配置**：`route.json`、`package.json`、`skill.json` 同级，均位于控制面。
- **可复现**：route 锁定 package 版本；package 版本锁定精确 skill/package 版本；package 使用传递闭包哈希校验。
- **不在项目中生成配置**：target 是普通目录，只放投影结果。

完整架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 当前状态

- skill 导入强制检查根级 `SKILL.md`，并限制文件数/大小/深度；
- `skill.json` 管理所有 skill 版本、完整性、标签；
- `apply` / `doctor` / history 回滚会重新校验 skill 内容完整性；
- `package.json` 管理 package 组合，支持 package 嵌套 package；
- DFS 环检测、skill 同版本去重、不同版本冲突报错；
- `package copy` 支持复制 package 并覆盖/删除依赖，用于解决 skill 版本冲突；
- `route.json` 只写 package lock；
- Windows junction / POSIX symlink 投影；
- `apply` / `status` / `doctor` / `gc`；
- apply 先完成全量预检再写文件系统，执行失败有进程内回滚；
- 三个配置文件的历史快照；普通写入失败会尝试恢复三文件，恢复本身失败会报 `IO_ERROR` 并列出 `restoreFailures`；
- v1 `skills.json` -> v2 全有或全无迁移；
- target/import 路径支持 `~`、`%USERPROFILE%`、`$HOME`；
- Windows 大小写不敏感名称冲突检测、文件占用重试；
- GUI 的 Targets / Skills / Packages / History / Doctor 页面；
- GUI 通过 CLI command layer 在进程内执行所有业务操作，CLI 是唯一业务入口；
- Electron 打包（NSIS + portable）。

> v2.0 仅支持 `mode: link`。copy target 会被拒绝，迁移遗留的 copy target 由 `doctor` 报 `UNSUPPORTED_MODE`。

## 快速开始

```bash
# 初始化控制面：route.json + package.json + skill.json
pnpm dev:cli -- init

# 导入 skill；文件夹根目录必须有 SKILL.md
pnpm dev:cli -- skill add <folder-with-SKILL.md> --name pdf --version 1.0.0

# 创建 package：组合 skill 和其他 package
pnpm dev:cli -- package create base@1.0.0 --skill pdf@1.0.0
pnpm dev:cli -- package create frontend@1.0.0 \
  --package base@1.0.0 \
  --skill review@1.0.0

# 添加 target，并把 package 分配给 target
pnpm dev:cli -- target add <empty-target-dir> --id project-a
pnpm dev:cli -- route add project-a frontend@1.0.0

# 投影 skill 到 target
pnpm dev:cli -- apply

# 查看状态 / 健康检查
pnpm dev:cli -- status
pnpm dev:cli -- doctor
```

`target` 下最终只会出现 skill 文件夹，例如：

```text
<target>/
├─ pdf     -> ~/.agents/skillink/skills/pdf/1.0.0
└─ review  -> ~/.agents/skillink/skills/review/1.0.0
```

不会出现 `frontend` 或 `base` 目录，因为 package 只是配置。

## 解决 skill 版本冲突

同一个 target 中，同一个 skill 只能有一个版本：

```text
frontend@1.0.0 -> pdf@1.2.0
docs@1.0.0     -> pdf@1.3.0
=> SKILL_VERSION_CONFLICT
```

用 `package copy` 复制其中一个 package，覆盖依赖后把 route 指向新版本：

```bash
pnpm dev:cli -- package copy frontend@1.0.0 frontend@1.1.0 --skill pdf@1.3.0
pnpm dev:cli -- route add project-a frontend@1.1.0
pnpm dev:cli -- apply
```

嵌套冲突时先复制嵌套 package，再复制父 package：

```bash
pnpm dev:cli -- package copy base@2.0.0 base@2.1.0 --skill pdf@1.3.0
pnpm dev:cli -- package copy frontend@1.0.0 frontend@1.1.0 --package base@2.1.0
```

## 常用命令

```bash
skillink init [--json]
skillink migrate [--json]

skillink skill add <folder> [--name <name>] [--version <version>] [--json]
skillink skill list [--json]
skillink skill tag <skill@version> <tag> [--json]
skillink skill remove <skill@version> [--json]

skillink package create <name@version> --skill <skill@version>... [--package <package@version>...] [--description <text>] [--json]
skillink package copy <source@version> <target@version> [--skill ...] [--package ...] [--drop-skill ...] [--drop-package ...] [--description <text>] [--json]
skillink package list [--json]
skillink package tag <package@version> <tag> [--json]
skillink package remove <package@version> [--json]

skillink target add <path> [--id <id>] [--label <label>] [--mode <mode>] [--json]
skillink target list [--json]
skillink target remove <id> [--json]
skillink target enable|disable <id> [--json]

skillink route add <target-id> <package@range-or-tag> [--json]
skillink route remove <target-id> <package> [--force] [--json]
skillink route list [--json]
skillink route enable|disable <target-id> <package> [--json]

skillink apply [--target <id>] [--dry-run] [--prune]
skillink snapshot [--json]
skillink status [--json] [--target <id>]
skillink doctor [--json]
skillink gc [--apply] [--max-age-days <n>] [--no-keep-tagged] [--json]
skillink history [--json]
skillink rollback <snapshot-id> [--apply] [--json]
```

所有写命令（包括 `init` / `migrate`）都支持 `--json`；失败时会向 stderr 输出结构化错误。

`add` 是 `skill add` 的顶层别名。

## GUI

```bash
pnpm dev:desktop
```

GUI 主进程通过 CLI adapter 在进程内执行 CLI 命令，Renderer 不接触 Core；刷新数据来自一次只读 `snapshot --json`。

GUI 页面：

- **Overview**：skills、packages、targets、links、doctor 概览；
- **Targets**：添加/删除 target、分配/删除 package、target/package enable/disable、显示 package 数与解析后的 skill 数、apply 预览（dry-run）、prune、apply 结果；
- **Skills**：导入 skill（必须 `SKILL.md`）、标签、删除、GC；
- **Packages**：创建/复制 package、查看组合、标签、删除；
- **History**：查看三文件快照并回滚；
- **Doctor**：健康问题与重新 apply。

## 开发

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

首次运行 GUI 前如 Electron 二进制缺失，执行：

```bash
pnpm setup:electron
```

如果 Electron 官方下载超时，可改用镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
pnpm setup:electron
```

## 打包桌面应用

```bash
# 生成未压缩目录：apps/desktop/release/win-unpacked/Skillink.exe
pnpm package:desktop

# 生成 NSIS 安装包与 portable 包（同时携带 CLI）
pnpm package:win
```

`package:win` 会先构建 CLI，再构建桌面端，最后生成：

```text
apps/desktop/release/Skillink Setup 0.0.0.exe   # NSIS 安装包
apps/desktop/release/Skillink 0.0.0.exe         # portable
apps/desktop/release/win-unpacked/              # 未压缩目录
```

安装包里同时包含两个入口：

- `Skillink.exe`：GUI；
- `skillink`：CLI 启动器。

NSIS 安装包会把 CLI 注册到 PATH；portable 版以 GUI 为主，CLI 文件仍在解包资源中，但不会修改 PATH，可直接运行 `resources\cli\skillink.cmd`。

CLI bundle 位于 `resources/cli/skillink.mjs`，启动器是 `resources/cli/skillink.cmd`。NSIS 安装时会把 `resources\cli` 加入当前用户 PATH；卸载时移除。启动器通过 `ELECTRON_RUN_AS_NODE=1` 使用安装包自带的 Electron 运行 CLI，因此不需要另外安装 Node.js。

GUI 和 CLI 共用同一个控制面：

```text
%USERPROFILE%\.agents\skillink\     # 或 SKILLINK_HOME
```

两者读取和写入完全相同的 `route.json`、`package.json`、`skill.json` 与 `skills/` 内容。

安装后如果当前终端找不到 `skillink`，重新打开一个终端，或直接运行：

```text
<install-dir>\resources\cli\skillink.cmd
```

## 目录

```text
apps/cli          CLI
apps/desktop      Electron GUI（Overview / Targets / Skills / Packages / History / Doctor）
packages/core     领域逻辑、package 图、skill 库、route、apply、history、GC、迁移
packages/shared   类型、zod schema、错误码
docs/             计划与文档
```
