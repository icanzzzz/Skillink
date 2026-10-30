# Skillink

Skillink 是一个纯本地、pnpm 风格的文件系统包管理器，用于管理任意文件夹的版本、公用库和目标目录投影。

- 管理单位是任意文件夹（Package），不要求 `SKILL.md`；
- 公用库目录：`%USERPROFILE%\.agents\skillink\skills.json` / `~/.agents/skillink/skills.json`；
- 目标路由：`%USERPROFILE%\.agents\skillink\route.json` / `~/.agents/skillink/route.json`；
- 目标目录由用户填写，不在项目中生成配置；
- 单向声明式收敛：`route.json` 是期望状态，目标目录是投影结果。

完整架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 当前状态

MVP 基础切片已可用：

- 任意本地文件夹导入公用库；
- `skills.json` + `route.json`；
- target 由用户填写；
- Windows junction / POSIX symlink 投影；
- `apply` / `status` / `doctor`；
- 历史快照与成对回滚（`route.json` + `skills.json`）；
- 公用库标签、版本删除（进入 `trash/`）与 GC；
- GUI 的 Targets / Library / History / Doctor 管理页面；
- Electron 打包（NSIS + portable）。

```text
skillink library list
skillink library tag <package@version> <tag>
skillink library remove <package@version>
skillink add <folder> --name <name> --version <version>
skillink target add <path> --label <label>
skillink route add <target-id> <package>@<version>
skillink apply [--target <id>] [--dry-run] [--prune]
skillink status [--json]
skillink doctor [--json]
skillink gc [--apply] [--max-age-days <n>] [--json]
skillink history [--json]
skillink rollback <snapshot-id> [--apply] [--json]
```

GUI：

```bash
pnpm dev:desktop
```

GUI 提供 Overview / Targets / Library / History / Doctor 五个页面：

- Targets：添加目标目录、分配包版本、应用路由；
- Library：导入文件夹、打标签、删除未引用版本、GC dry-run/apply；
- History：查看历史快照并成对回滚 `route.json` + `skills.json`；回滚时会从 `trash/` 恢复快照引用的版本内容，找不到内容则拒绝恢复；
- Doctor：查看健康问题并重新应用路由。

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

# 生成 NSIS 安装包与 portable 包
pnpm --filter @skillink/desktop package:win
```

## 目录

```text
apps/cli          CLI
apps/desktop      Electron GUI（Targets / Library / History / Doctor）
packages/core     领域逻辑、公用库、路由、apply、history、GC
packages/shared   类型、zod schema、错误码
docs/             计划与文档
```
