# Skillink

Skillink 是一个纯本地、以 **skill** 为实体、以 **package** 为组合配置的文件系统包管理器。

```text
target -> package -> skill -> 实体内容
```

- **Skill 是唯一安装单位，也是唯一实体**：内容存放在 `%USERPROFILE%\.agents\skillink\skills\<skill>\<version>\`，根目录必须有 `SKILL.md`。
- **Package 只是配置文件**：`package.json` 描述 package 版本如何组合 skill 和其他 package；它没有内容目录，也不会投影到 target。
- **Route 只依赖 package**：`route.json` 的 target 声明 package 版本，不直接声明 skill。
- **Target 最终只包含 skill**：apply 会把 package 图展开为 skill 集合，再链接或复制 skill 文件夹（`link` / `copy` 两种投影模式）。
- **三个数据配置 + 用户偏好**：`route.json`、`package.json`、`skill.json` 同级，均位于控制面并由 git 跟踪；`settings.json` 只保存 UI 语言等用户偏好，不进入 git 版本控制。
- **可复现**：route 锁定 package 版本；package 版本锁定精确 skill/package 版本；package 使用传递闭包哈希校验。
- **不在项目中生成配置**：target 是普通目录，只放投影结果。

完整架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 当前状态

- skill 导入强制检查根级 `SKILL.md`，并限制文件数/大小/深度；
- `skill.json` 管理所有 skill 版本、完整性、标签；
- `apply` / `doctor` 会重新校验 skill 内容完整性；
- `package.json` 管理 package 组合，支持 package 嵌套 package；
- DFS 环检测、skill 同版本去重、不同版本冲突报错；
- `package copy` 支持复制 package 并覆盖/删除依赖，用于解决 skill 版本冲突；
- `route.json` 只写 package lock；
- Windows junction / POSIX symlink 投影；
- `apply` / `status` / `doctor` / `gc`；
- apply 先完成全量预检再写文件系统；执行失败会回滚本次创建的链接/副本，但被替换的真实目录/文件不会恢复；
- apply 只处理 route 期望集合中的同名条目；集合外条目不动，不再提供 `--prune`；route 版本覆盖或删除时由 target GC 清理不再需要的投影；
- v1 `skills.json` -> v2 全有或全无迁移；
- target/import 路径支持 `~`、`%USERPROFILE%`、`$HOME`；
- Windows 大小写不敏感名称冲突检测、文件占用重试；
- GUI 的 Targets / Skills / Packages / Doctor 页面；
- GUI 通过 CLI command layer 在进程内执行所有业务操作，CLI 是唯一业务入口；
- 可安装、可切换的数据型语言包（`locale` 命令 + GUI 语言弹窗），当前语言保存到 `settings.json`；
- 控制面是 git 仓库：`route.json` / `package.json` / `skill.json` / `locales/` 自动提交，可用 `history` 查看、`rollback` 回退；
- `skills/` 是独立 git 仓库，保存 skill 内容历史；控制面 git 忽略 `skills/`；
- 所有写命令自动提交，无变化不提交；读命令、`apply`、`package check`、dry-run 不提交；
- 写命令通过 `<home>/.skillink.lock` 串行化；
- Electron 打包（NSIS + portable）。

> target 支持 `mode: link` 和 `mode: copy`。copy target 会在目标目录中生成完整的真实目录副本；副本内容与 skill 库不一致时，`status` 报 `wrong-version`，`apply` 会整目录替换。

## 快速开始

```bash
# 初始化控制面：route.json + package.json + skill.json
# 同时初始化控制面 git 与 skills 独立 git，并建立 baseline commit
pnpm dev:cli -- init

# 导入 skill；文件夹根目录必须有 SKILL.md
# 目录名形如 pdf@1.0.0 时自动解析名称和版本
pnpm dev:cli -- skill add <folder>/pdf@1.0.0

# 普通目录：手动指定名称；版本省略时自动生成 1.0.0+hash
pnpm dev:cli -- skill add <folder-with-SKILL.md> --name pdf

# 创建 package：组合 skill 和其他 package
pnpm dev:cli -- package create base@1.0.0 --skill pdf@1.0.0
pnpm dev:cli -- package create frontend@1.0.0 \
  --package base@1.0.0 \
  --skill review@1.0.0

# 添加 target，并把 package 分配给 target
pnpm dev:cli -- target add <empty-target-dir> --id project-a
pnpm dev:cli -- route add project-a frontend@1.0.0

# 需要真实目录副本而不是链接时使用 copy 模式
pnpm dev:cli -- target add <empty-target-dir> --id project-copy --mode copy
pnpm dev:cli -- route add project-copy frontend@1.0.0

# 投影 skill 到 target
pnpm dev:cli -- apply

# 查看状态 / 健康检查
pnpm dev:cli -- status
pnpm dev:cli -- doctor

# 查看控制面提交历史，回退到某个提交
pnpm dev:cli -- history
pnpm dev:cli -- rollback <revision>

# 安装并启用简体中文语言包
pnpm dev:cli -- locale install ./locales/zh-CN.json --use
```

`target` 下最终只会出现 skill 文件夹，例如：

```text
<target>/
├─ pdf     -> ~/.agents/skillink/skills/pdf/1.0.0
└─ review  -> ~/.agents/skillink/skills/review/1.0.0
```

不会出现 `frontend` 或 `base` 目录，因为 package 只是配置。

## 控制面目录与 git

```text
%USERPROFILE%\.agents\skillink\
├─ .git/              控制面 git
├─ .gitignore
├─ .gitattributes
├─ route.json         tracked
├─ package.json       tracked
├─ skill.json         tracked
├─ locales/           tracked
├─ skills/            独立 git 仓库；控制面 git 忽略
│  ├─ .git/
│  ├─ .gitattributes
│  └─ <name>/<version>/...
├─ settings.json      ignored（UI 偏好，不进入回滚）
├─ cache/             ignored
├─ logs/              ignored
├─ tmp/               ignored
└─ .skillink.lock     ignored
```

`init` 会创建两个仓库：控制面仓库跟踪三个配置和 `locales/`；`skills/` 是独立仓库，跟踪 skill 内容。旧版本的 `history/` / `trash/` 如果存在只会被忽略，不再使用。

需要系统安装 `git` 并在 PATH 中可用；`init`、写命令自动提交和 `rollback` 都依赖它。GUI 启动时会检测 git，未检测到时在左下角语言切换上方显示提示：“未检测到 Git，控制面版本历史、自动提交与回退不可用。”

## Git 版本控制

- **自动提交**：成功且有数据变化的写命令会自动提交。`skill add` / `skill remove` / `gc --apply` 会先提交 skills 仓库，再提交控制面；`skill tag`、package、target、route、locale 只提交控制面。
- **不提交**：读命令、`apply`、`package check`、`gc` 默认 dry-run 都不产生提交；无变化的命令不会产生空提交。
- **提交身份**：固定使用 `Skillink <skillink@local>`，并通过 `--no-verify` 跳过用户 hooks。
- **提交信息**：`skillink(<scope>): <action> <summary>`，body 包含 `Command:` 和变更文件列表。例如：

  ```text
  skillink(skill): add pdf@1.0.0
  skillink(package): copy frontend@1.0.0 -> frontend@1.1.0
  skillink(route): add project-a frontend@1.1.0
  skillink(target): remove project-a
  skillink(gc): remove 3 unreferenced skill versions
  skillink(rollback): restore 3f2a1c9
  ```

- **工作区必须干净**：写命令开始前如果控制面有未提交改动，会报 `GIT_DIRTY`；错误会列出受影响的受管路径，并给出 `git -C <home> status` 提示。
- **只跟踪受管路径**：控制面只提交 `route.json`、`package.json`、`skill.json`、`locales/`、`.gitignore`、`.gitattributes`。用户在 home 中放置的其他未跟踪文件不会被提交，也不会阻塞写命令。
- **回退**：`rollback <revision>` 会删除当前所有 target 的受管投影，恢复旧 `route.json` / `package.json` / `skill.json`，从 skills git 恢复缺失内容，删除旧 catalog 不包含的受管 skill 版本，然后重新 `apply`，最后只产生一次 rollback 提交。`--no-apply` 只恢复配置，用于诊断。
- **受管范围**：删除只针对当前 route 解析出的 skill 名称；target 根目录中的 `.git`、普通文件和未知目录不会被删除。skills 库中只删除原 `skill.json` 记录、但旧 catalog 不再包含的版本；未知目录不处理。
- **已知限制**：skills git 不保证空目录、权限位或 CRLF 的字节级恢复；回退不处理未受管条目；损坏的 target package 图会使回退中止。

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

## CLI 命令参考

调用格式：

```text
skillink <command> [subcommand] [arguments] [options]
```

开发模式下可以用 `pnpm dev:cli -- <command>` 运行同一组命令；安装后的入口是 `skillink`。

约定：

- `<value>` 为必填参数，`[value]` 为可选参数，`...` 表示可以重复传入；
- 所有命令都支持 `--json`，用于输出机器可读 JSON；失败时向 stderr 输出结构化错误；
- 所有命令都支持 `-h` / `--help`，例如 `skillink skill add --help`；也可以用 `skillink help <command>`；
- 所有命令默认操作 `%USERPROFILE%\.agents\skillink`，可用环境变量 `SKILLINK_HOME` 覆盖；
- 退出码：`0` 成功；`1` 用法错误、运行失败，或 `status` / `doctor` 报告不健康；
- 写命令成功后会按需自动提交；读命令和 dry-run 不提交。

### 初始化、迁移与快照

```bash
# 初始化控制面：创建 route.json、package.json、skill.json、settings.json 和所需目录。
# 同时初始化控制面 git 与 skills 独立 git，并提交 baseline。
# 如果检测到 v1 的 skills.json，会自动执行全有或全无的 v1 -> v2 迁移。
skillink init [--json]

# 单独把 v1 skills.json 迁移为 v2 的 skill.json + package.json；没有 v1 数据时直接返回。
skillink migrate [--json]

# 只读快照：一次性输出 skills、packages、route、status、doctor、targetSkills。
# GUI 刷新数据时使用的就是一次 snapshot，不会修改任何文件。
skillink snapshot [--json]

# 查看 CLI 版本（短选项为 -V）。
skillink --app-version

# 查看运行时能力（当前主要报告 git 是否可用）。
skillink env [--json]

# 查看指定命令的内置帮助。
skillink help <command>
```

### Skill

```bash
# 导入本地 skill 文件夹，文件夹根目录必须包含 SKILL.md。
# 名称优先取 --name，其次解析目录名 <name>@<version>，最后退回目录名本身。
# 版本优先取 --version，其次解析目录名，最后自动生成 1.0.0+<hash>。
# 顶层 add 是 skill add 的别名。
skillink skill add <folder> [--name <name>] [--version <version>] [--json]
skillink add <folder> [--name <name>] [--version <version>] [--json]

# 递归扫描文件夹，找出所有包含 SKILL.md 的 skill 包；只报告候选项，不安装。
# 输出候选项名称、版本、路径，以及发现的目录链接。
skillink skill scan <folder> [--json]

# 列出 skill.json 中的所有 skill、版本、文件数和大小；ls 是别名。
skillink skill list [--json]
skillink skill ls [--json]

# 给精确版本打标签（例如 latest / stable）；标签可用于 route 的版本解析。
skillink skill tag <skill@version> <tag> [--json]

# 删除未被引用的 skill 版本，内容直接删除。
# 如果版本仍被标签或 route 解析出的 package 图引用，会报 VERSION_IN_USE。
skillink skill remove <skill@version> [--json]
```

### Package

```bash
# 创建 package 版本；至少要有一个 --skill 或 --package，否则报 PACKAGE_EMPTY。
# --skill / --package 都可以重复传入多个 name@version。
skillink package create <name@version> [--skill <skill@version>...] [--package <package@version>...] [--description <text>] [--json]

# 复制一个 package 版本，并在副本上覆盖/新增/删除直接依赖。
# --skill / --package 用于覆盖或新增依赖；--drop-skill / --drop-package 只写依赖名。
# 用于解决同一个 target 中同一 skill 的版本冲突；嵌套冲突时先复制嵌套 package。
skillink package copy <source@version> <target@version> [--skill <skill@version>...] [--package <package@version>...] [--drop-skill <name>...] [--drop-package <name>...] [--description <text>] [--json]

# 列出 package 组合、标签和每个版本包含的 skill/package 依赖；ls 是别名。
skillink package list [--json]
skillink package ls [--json]

# 给 package 精确版本打标签。
skillink package tag <package@version> <tag> [--json]

# 删除未被引用的 package 版本；被 route 或父 package 引用时会拒绝删除。
skillink package remove <package@version> [--json]

# 检查 package 中引用不存在 skill 的版本；对引用了这些 package 的 target，
# 通过 target 模块删除其目录中对应的受管 skill。
skillink package check [--json]
```

### Target

```bash
# 添加一个 target 目录，最终只会在其中生成 skill 文件夹/链接。
# id 省略时由 --label 或目录名生成；--mode 默认 link，可选 link 或 copy。
# copy 会生成真实目录副本，link 会生成目录链接。
skillink target add <path> [--id <id>] [--label <label>] [--mode <link|copy>] [--json]

# 列出所有 target 的 id、路径、投影模式和启用状态。
skillink target list [--json]

# 从 route.json 删除 target，并清理它在 target 目录中由 route 解析出的 skill 条目。
# target 目录本身不会被删除。
skillink target remove <id> [--json]

# 启用 target；之后需要执行 apply 才会恢复投影。
skillink target enable <id> [--json]

# 禁用 target，并删除它在 target 目录中由 route 解析出的 skill 条目。
skillink target disable <id> [--json]
```

### Route

```bash
# 给 target 分配一个 package。第二个参数可以是精确版本、semver 范围或标签；
# route.json 会锁定解析后的精确版本，并清理本次变更后不再需要的 target skill 条目。
skillink route add <target-id> <package@version-or-range-or-tag> [--json]

# 列出所有 target -> package 的分配关系及锁定版本。
skillink route list [--json]

# 启用 target 上的某个 package 分配。
skillink route enable <target-id> <package> [--json]

# 禁用 target 上的某个 package 分配，并删除因此不再需要的 skill。
skillink route disable <target-id> <package> [--json]

# 删除某个 package 分配并清理不再需要的 skill。
# --force 表示即使剩余 package 图无效也继续删除。
skillink route remove <target-id> <package> [--force] [--json]
```

### Apply、状态与健康检查

```bash
# 将 route.json 的期望状态投影到 target 目录。
# 先完成全量预检，再写文件系统；失败时会回滚本次创建的链接。
# --target 只处理一个 target；--dry-run 只输出计划，不改文件系统。
skillink apply [--target <id>] [--dry-run] [--json]

# 查看每个 target/package 的链接状态；不健康时退出码为 1。
# --target 只检查一个 target。
skillink status [--target <id>] [--json]

# 检查 skill 内容完整性、package 图、route 和 target；不健康时退出码为 1。
skillink doctor [--json]

# 列出控制面 git 提交（短哈希、时间、subject）。
skillink history [--json]

# 回退到指定提交：清理当前 target 投影、恢复配置、恢复缺失的 skill 内容并重新 apply。
# --no-apply 只恢复配置，不重建投影。
skillink rollback <revision> [--no-apply] [--json]
```

### 回收

```bash
# 清理没有被任何 route 引用、且未被标签保护的 skill 版本；默认只试运行，不删除。
# 默认只回收修改时间超过 7 天的版本，--max-age-days <n> 可调整这个天数；
# --apply 会直接删除候选版本，并自动提交控制面与 skills；
# --no-keep-tagged 允许回收带标签的版本（默认保留）。
skillink gc [--apply] [--max-age-days <n>] [--no-keep-tagged] [--json]
```

### Locale（语言包）

```bash
# 列出已安装语言包、当前语言、版本和翻译覆盖率。
skillink locale list [--json]

# 从本地 JSON 文件安装语言包；--use 安装后立即切换，--force 覆盖同名语言包。
skillink locale install <file> [--use] [--force] [--json]

# 切换到已安装的语言；选择会写入 settings.json。
skillink locale use <locale> [--json]

# 删除已安装语言包；删除当前语言时会回退到默认语言。
skillink locale remove <locale> [--json]
```

> 语言包的格式、key 规则、覆盖率与安全限制见 [docs/language-packs.md](./docs/language-packs.md)。

## GUI

```bash
pnpm dev:desktop
```

GUI 主进程通过 CLI adapter 在进程内执行 CLI 命令，Renderer 不接触 Core；刷新数据来自一次只读 `snapshot --json`。

GUI 页面：

- **Overview**：skills、packages、targets、links、doctor 概览；
- **Targets**：添加/删除 target、分配/删除 package、target/package enable/disable、显示 package 数与解析后的 skill 数、删除或禁用 target/package 时清理 route 解析出的 skill 目录/链接、apply 预览（dry-run）、apply 结果；
- **Skills**：选择一个目录批量扫描 `SKILL.md`，逐个确认安装；确认时检测目录链接，命中则提示链接路径并跳过该包；标签、删除、GC；
- **Packages**：创建/复制 package、查看组合、标签、删除；
- **Doctor**：健康问题与重新 apply；
- **Language**：安装、切换、删除语言包，显示当前语言和翻译覆盖率。

> 本阶段 GUI 不提供 History 页面；查看和回退历史请使用 CLI 的 `history` / `rollback`。

## 语言包

Skillink 的 GUI 文案、错误提示和 Doctor 诊断可以通过本地 JSON 语言包切换语言。仓库自带完整的简体中文语言包 `locales/zh-CN.json`：

```bash
skillink locale install ./locales/zh-CN.json --use
skillink locale list
skillink locale use en
skillink locale remove zh-CN
```

语言包格式、key 规则、覆盖率、回退和安全限制见 [docs/language-packs.md](./docs/language-packs.md)。CLI 的普通帮助和命令输出仍为英文。

Windows NSIS 安装包会在安装时把内置的 `zh-CN.json` 复制到 `%USERPROFILE%\.agents\skillink\locales\zh-cn.json`（已存在则不覆盖）。应用启动时如果发现该文件仍是内置语言包，且缺少新版本文案或内置包版本更新，会自动刷新它；自定义语言包不会被覆盖。应用仍按 `settings.json` / 系统语言规则决定是否启用；portable 包不执行安装步骤，不会自动复制首次安装的语言包。

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

开发模式下按 `F12` 或 `Ctrl+Shift+I`（macOS 为 `Cmd+Option+I`）打开/关闭 Electron DevTools，查看渲染进程的 HTML 结构与 Console。打包后的应用不注册该快捷键。

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

卸载时卸载向导会显示“Delete Skillink data and configuration”复选框，默认不勾选；勾选后删除 `%USERPROFILE%\.agents\skillink\`，包括 skills、三个数据配置、settings 和语言包。静默卸载可传 `--delete-app-data`（兼容 electron-builder）或 `--delete-skillink-data` 直接删除；覆盖安装/升级不会删除用户数据：

```powershell
& "<install-dir>\Uninstall Skillink.exe" /S --delete-app-data
```

如果通过 `SKILLINK_HOME` 自定义了控制面，卸载程序只处理默认目录，需要手动删除自定义目录。

GUI 和 CLI 共用同一个控制面：

```text
%USERPROFILE%\.agents\skillink\     # 或 SKILLINK_HOME
```

两者读取和写入完全相同的 `route.json`、`package.json`、`skill.json` 与 `skills/` 内容；UI 语言偏好保存在 `settings.json`，已安装语言包位于 `locales/`。

安装后如果当前终端找不到 `skillink`，重新打开一个终端，或直接运行：

```text
<install-dir>\resources\cli\skillink.cmd
```

## 目录

```text
apps/cli          CLI
apps/desktop      Electron GUI（Overview / Targets / Skills / Packages / Doctor / Language）
packages/core     领域逻辑、package 图、skill 库、route、apply、GC、git、回退、迁移、语言包存储
packages/shared   类型、zod schema、错误码、i18n 翻译器与英文目录
locales/          语言包示例（zh-CN）
docs/             计划与文档
```
