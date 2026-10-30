# Skillink

Skillink 是一个纯本地、pnpm 风格的文件系统包管理器，用于管理任意文件夹的版本、公用库和目标目录投影。

- 管理单位是任意文件夹（Package），不要求 `SKILL.md`；
- 公用库目录：`%USERPROFILE%\.agents\skillink\skills.json` / `~/.agents/skillink/skills.json`；
- 目标路由：`%USERPROFILE%\.agents\skillink\route.json` / `~/.agents/skillink/route.json`；
- 目标目录由用户填写，不在项目中生成配置；
- 单向声明式收敛：`route.json` 是期望状态，目标目录是投影结果。

完整架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 当前状态

MVP 基础建设中。首个可用切片：

```text
skillink library list
skillink add <folder> --name <name> --version <version>
skillink target add <path> --label <label>
skillink route add <target-id> <package>@<version>
skillink apply [--target <id>] [--dry-run]
skillink status
skillink doctor
```

## 开发

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## 目录

```text
apps/cli          CLI
apps/desktop      Electron GUI（后续）
packages/core     领域逻辑、公用库、路由、apply
packages/shared   类型、zod schema、错误码
docs/             计划与文档
```
