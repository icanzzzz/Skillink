# Skillink 项目架构（v2.0）

> 日期：2026-11-01
> 状态：v2.0 MVP + hardening + i18n + batch import + language pack refresh + installed skill version grouping + git-first control plane（2026-11-01）
> 文档基线：`013c5e2 feat(core): make route the sole source for target projection` + 2026-11-01 git 控制面、自动提交与回退修订
> 取代：v1.2 的 `skills.json` 公用库模型
> 路径约定：`<user>`、`<repo>` 为占位符；Windows 使用 `%USERPROFILE%`，Linux/macOS 使用 `~`。

---

## 1. 项目概述

Skillink 是一个纯本地、pnpm 风格的文件系统包管理器。v2 的核心变化是：

```text
target -> package -> skill -> 实体内容
```

- **Skill 是唯一安装单位，也是唯一实体**；
- **Package 只是配置文件**，负责组合 skill 和其他 package；
- **Target 最终只投影 skill**；
- **Route 只依赖 package**；
- **Skill 必须包含根级 `SKILL.md`**；
- **纯文件夹包不再合法**。

### 1.1 目标

1. 一份 skill 内容只存一次，多个 target 共享；
2. route 锁定 package 版本，package 锁定精确 skill/package 版本；
3. package 可以嵌套 package，形成可组合的依赖图；
4. 引用图必须无环，skill 版本在同一 target 中必须一致；
5. apply 可复现，支持离线使用；
6. 不覆盖、不删除未托管内容；
7. Windows 优先，无需管理员权限；
8. GUI 能清楚展示 skill、package、route、链接和健康状态；
9. 控制面与 skill 内容可审计、可回退：控制面使用 git，skills 使用独立 git，写命令自动提交。

### 1.2 非目标

- 不做在线 skill 市场；
- 不做 Agent 运行时，不执行 `SKILL.md` 中的提示词；
- 不为特定客户端做适配器；
- 不做 skill 之间的依赖图（依赖只在 package 层表达）；
- 不自动修改项目源码；
- MVP 不做远程同步和团队协作；
- MVP 来源仅本地文件夹，不支持 tar/Git/registry。

---

## 2. 术语

| 术语 | 定义 |
|---|---|
| Skill | 唯一实体。`skills/<name>/<version>/` 文件夹，根目录必须有 `SKILL.md` |
| Package | 配置文件中的组合单元。没有内容目录，不投影 |
| Package Version | package 的不可变配置快照，包含 `skills` 和/或 `packages` 依赖 |
| Target | 用户指定的目录，最终包含 skill 链接/副本 |
| Route | `route.json` 中 target -> package 的映射 |
| Projection | Target 下的 skill 链接或副本 |
| Apply | 把 route 的期望状态展开为 skill 并收敛到 Target |
| Drift | Target 实际状态与 route 不一致 |
| Managed | route 期望集合中的同名目标条目；不看条目由谁创建 |
| Unmanaged | route 期望集合外的目标条目，工具不自动删除 |
| Package Graph | package 版本之间的引用图，节点为 `name@version` |
| Transitive Integrity | 根 package 及其所有嵌套 package 版本的规范化哈希 |

---

## 3. 总体模型

### 3.1 依赖链

```text
route.json
  └─ target.packages[package] = { resolved: version }
       └─ package.json
            └─ packages[package].versions[version]
                 ├─ skills[skill] = exact-version
                 └─ packages[package] = exact-version
                      └─ skill.json
                           └─ skills[skill].versions[version]
                                └─ skills/<skill>/<version>/SKILL.md
```

### 3.2 为什么 package 不是实体

- target 的投影单位是 skill，不是 package；
- package 没有内容目录，也没有文件哈希；
- package 只决定“哪些 skill 以什么版本一起出现”；
- package 可以随时复制、重构组合，而不用复制内容；
- GC 只回收 skill 内容，package 配置不占内容空间。

### 3.3 三个数据配置与用户偏好

```text
%USERPROFILE%\.agents\skillink\          # 或 ~/.agents/skillink
├─ .git\            # 控制面 git
├─ .gitignore
├─ .gitattributes
├─ route.json       # target -> package
├─ package.json     # package -> skill/package 组合
├─ skill.json       # skill -> 版本、完整性、标签
├─ locales\         # 已安装语言包（纯 JSON 数据）
├─ skills\          # 唯一实体内容；独立 git 仓库，控制面 git 忽略
│  ├─ .git\
│  ├─ .gitattributes
│  └─ <name>\<version>\
├─ settings.json    # 用户偏好（UI 语言）；git 忽略
├─ cache\           # git 忽略
├─ logs\            # git 忽略
├─ tmp\             # git 忽略
└─ .skillink.lock   # 写命令跨进程锁；git 忽略
```

`skill.json` 取代 v1 的 `skills.json`。`route.json`、`package.json`、`skill.json` 和 `locales/` 是控制面 git 跟踪的数据；`settings.json`、`cache/`、`logs/`、`tmp/` 和锁文件被忽略；`skills/` 是独立仓库。旧版本的 `history/` / `trash/` 如果存在会被忽略，不再使用。

### 3.4 代码模块边界

```text
apps/
├─ cli/                      # CLI 入口、命令注册、人类/JSON 输出
│  └─ src/
│     ├─ run.ts              # program 构建、runtime、错误映射
│     ├─ cli-context.ts      # 输出与公共选项
│     ├─ command-runtime.ts  # paths / ensureHome / mutate / exitCode
│     ├─ mutation.ts         # 写命令加锁与自动提交
│     ├─ commit-message.ts   # CLI scope 与提交信息
│     ├─ bootstrap.ts        # init 编排
│     ├─ specs.ts            # name@version 参数解析
│     └─ commands/           # init/migrate/env/snapshot/locale/skill/package/target/route/lifecycle
├─ desktop/
│  ├─ src/main/              # Electron 主进程：窗口、IPC、CLI 适配、错误本地化、内置语言包同步
│  ├─ src/preload/           # contextBridge 白名单 API
│  └─ src/renderer/          # React 页面与 i18n Provider
packages/
├─ shared/                   # Zod schema、报告类型、错误、路径/语言/skill 目录名工具
└─ core/                     # 业务实现：配置存储、package 图、apply/status/doctor/gc、导入/扫描、git、回退、语言包存储
```

依赖方向：

```text
renderer -> preload -> main -> @skillink/cli -> @skillink/core -> @skillink/shared
CLI ------------------------> @skillink/core -> @skillink/shared
```

- `@skillink/core` 不依赖 Electron 或 React，可在 CLI、主进程和测试中直接调用；
- `@skillink/shared` 只放类型、schema 和纯函数，不读写文件系统；
- `@skillink/cli` 是唯一业务命令层；桌面端主进程通过 `main/cli-adapter.ts` 把 IPC 请求翻译成 CLI argv 并调用 `runCli`，不直接 import core；
- 语言包解析位于 `shared/src/i18n.ts`，语言包安装/选择位于 `core/src/language-store.ts`；Renderer 只消费 preload 返回的 `LanguageState`。

导入方向规则（由 `core/src/module-boundaries.test.ts` 强制）：

- `@skillink/shared` 不依赖 `@skillink/core` / `@skillink/cli` / `@skillink/desktop`；
- `@skillink/core` 不依赖 CLI、Electron 或 React；
- `apps/desktop/src/main` 与 `preload` 不依赖 `@skillink/core`；
- `renderer` 不依赖 Node 内置模块、Electron 或 `@skillink/core`；
- 每个 workspace 包必须在 `package.json` 中声明自己 import 的 `@skillink/*` 包。

关键模块：

| 模块 | 职责 |
|---|---|
| `shared/src/schemas.ts` | route/package/skill 三配置、settings 与语言包 schema |
| `shared/src/reports.ts` | CLI/GUI 共用的报告、快照和错误类型 |
| `shared/src/skill-directory.ts` | 解析 `<name>@<version>` 目录名 |
| `shared/src/spec.ts` | 共享 `name@version` 解析 |
| `core/src/config-store.ts` | 三份配置的唯一只读加载入口 |
| `core/src/initialize.ts` | home/目录/初始配置/settings 初始化 |
| `core/src/package-graph.ts` | package DFS、环检测、skill 冲突、传递闭包哈希 |
| `core/src/package-name.ts` | 大小写冲突检测与 package 名称校验 |
| `core/src/target-graph.ts` | target lock 校验与 package 图解析的唯一入口 |
| `core/src/target-entry.ts` | 同名目标条目的形态/内容比对，apply 与 status 共用 |
| `core/src/target-gc.ts` | target 移除/禁用、package 禁用、route 移除/覆盖时按 route 解析结果清理目标目录 skill 目录/链接 |
| `core/src/target-resolution.ts` | target skill 摘要 |
| `core/src/apply.ts` / `status.ts` / `gc.ts` | 核心生命周期 |
| `core/src/doctor/*` | 按配置、package 图、package 使用、skill 内容、链接拆分的 doctor 检查 |
| `core/src/settings-store.ts` | `settings.json` 读写 |
| `core/src/json-store.ts` / `fs-retry.ts` | 原子 JSON 存储与 Windows 文件重试 |
| `core/src/links.ts` / `path-policy.ts` | 链接原语与路径安全策略 |
| `core/src/skill-md.ts` / `skill-integrity.ts` | SKILL.md 解析与内容完整性 |
| `core/src/git.ts` | 控制面/skills 仓库初始化、status/add/commit/log/show/checkout |
| `core/src/git-lock.ts` | `<home>/.skillink.lock` 跨进程写锁、stale 清理、超时 |
| `core/src/git-commit.ts` | 通用 commit message 与仓库提交原语 |
| `core/src/rollback.ts` | 回退规划、target 清理、配置/skill 内容恢复、单次提交 |
| `core/src/import-skill.ts` / `skill-scan.ts` | 单包导入与批量扫描 |
| `apps/cli/src/mutation.ts` | CLI 写命令加锁与自动提交编排；`init` 使用 `bootstrap.ts`，`rollback` 由 core 自带锁 |
| `desktop/src/main/ipc.ts` | IPC 白名单、Zod 输入校验、sender 校验 |
| `desktop/src/main/bundled-language.ts` | 启动时刷新版本过旧或缺 key 的内置 `zh-CN` 语言包，保护自定义包 |
| `desktop/src/main/cli-commands.ts` | IPC 请求 -> CLI argv |
| `desktop/src/preload/index.ts` | `window.skillink` 白名单 API |

---

## 4. 配置规范

### 4.1 route.json

```json
{
  "schemaVersion": 2,
  "targets": [
    {
      "id": "project-a",
      "label": "Project A",
      "path": "C:/Projects/ProjectA/skills",
      "mode": "link",
      "enabled": true,
      "packages": {
        "frontend": {
          "requested": "^1.0.0",
          "resolved": "1.0.0",
          "integrity": "sha256-...",
          "enabled": true
        }
      }
    }
  ]
}
```

字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 固定为 2 |
| `targets[].id` | 是 | 稳定唯一 ID |
| `targets[].label` | 否 | GUI 显示名 |
| `targets[].path` | 是 | 用户填写的 target 目录 |
| `targets[].mode` | 是 | `link` 或 `copy`；v2.0 仅接受 `link`，copy 字段保留给 v2.1 |
| `targets[].enabled` | 否 | 默认 true；false 时 apply 跳过 |
| `targets[].packages` | 是 | package 名称 -> package lock |
| `packages[].requested` | 否 | package 版本范围、精确版本或 tag |
| `packages[].resolved` | 是 | 精确 package 版本 |
| `packages[].integrity` | 是 | package 传递闭包哈希，`sha256-...` |
| `packages[].enabled` | 否 | 默认 true；false 时该 package 不展开 |

约束：

- `targets[].id` 唯一；
- `targets[].path` 唯一且不能互相嵌套；
- route 中不出现 skill 版本、source、skill 内容 integrity；
- `integrity` 是 package 配置的传递闭包哈希，不是 skill 内容哈希；
- 写入采用临时文件 + rename；写命令成功后自动提交到控制面 git。

### 4.2 package.json

```json
{
  "schemaVersion": 2,
  "packages": {
    "frontend": {
      "description": "Frontend baseline",
      "tags": {
        "latest": "1.1.0"
      },
      "versions": {
        "1.0.0": {
          "packages": {
            "base": "2.0.0"
          },
          "skills": {
            "pdf": "1.2.0"
          }
        },
        "1.1.0": {
          "packages": {
            "base": "2.0.0"
          },
          "skills": {
            "pdf": "1.3.0",
            "review": "2.0.0"
          }
        }
      }
    },
    "base": {
      "versions": {
        "2.0.0": {
          "skills": {
            "review": "2.0.0"
          }
        }
      }
    }
  }
}
```

字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 固定为 2 |
| `packages` | 是 | package 名称 -> package 条目 |
| `packages[].description` | 否 | GUI 展示 |
| `packages[].tags` | 否 | tag -> 精确 package 版本 |
| `packages[].versions` | 是 | 至少一个版本 |
| `versions[].packages` | 否 | 嵌套 package -> 精确版本 |
| `versions[].skills` | 否 | skill -> 精确版本 |

约束：

- package 条目至少一个版本；
- 每个 package 版本至少一个依赖，`packages` + `skills` 不能同时为空；
- package/skill 依赖必须是精确版本，不能是 range；
- package 版本一旦创建，工具不再修改；修改组合用 `package copy`；
- 一个 package 版本可以引用同名 package 的其他版本；
- 包名和 skill 名各自独立命名空间，允许同名；
- 每个写操作都做图校验，失败不写文件。

### 4.3 skill.json

```json
{
  "schemaVersion": 2,
  "skills": {
    "pdf": {
      "description": "PDF tools",
      "tags": {
        "latest": "1.3.0"
      },
      "versions": {
        "1.2.0": {
          "integrity": "sha512-...",
          "fileCount": 42,
          "size": 184320,
          "built": false,
          "metadata": {
            "name": "pdf",
            "description": "PDF tools"
          }
        }
      }
    }
  }
}
```

字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 固定为 2 |
| `skills` | 是 | skill 名称 -> skill 条目 |
| `skills[].description` | 否 | GUI 展示 |
| `skills[].tags` | 否 | tag -> 精确 skill 版本；GC 保护 |
| `skills[].versions` | 是 | 精确版本 -> 版本信息 |
| `versions[].integrity` | 是 | 内容快照哈希，`sha512-...` |
| `versions[].fileCount` | 是 | 文件数量 |
| `versions[].size` | 是 | 总字节数 |
| `versions[].built` | 否 | 是否经过可选构建 |
| `versions[].metadata` | 否 | 展示元数据 |

约束：

- 不存 `source`；路径固定为 `skills/<name>/<version>/`；
- 不存 `kind`；所有条目都是 skill；
- 每个版本的内容目录必须存在，根目录必须有 `SKILL.md`；
- `integrity` 与目录内容一致；`apply`、`doctor` 会重新计算并校验；
- `fileCount`、`size` 与目录内容一致；
- tags 必须指向已存在版本；
- 写入采用临时文件 + rename。

### 4.4 settings.json 与语言包

`settings.json` 只保存用户偏好：

```json
{
  "schemaVersion": 1,
  "locale": "zh-CN"
}
```

语言包是单个经过 Zod 校验的 JSON 文件，安装到 `locales/`，文件名统一为 `locale.toLowerCase()`。内置英文 `en` 不落盘，是唯一权威 key 集合和回退来源。语言包只能包含数据，不能执行代码；安装前校验文件大小、JSON、schema、locale、key 格式、key 数量和消息长度。

当前语言解析顺序：

1. `SKILLINK_LOCALE` 环境变量；
2. `settings.json` 的 `locale`；
3. 系统语言与已安装语言包的匹配结果；
4. `en`。

缺失、损坏或已删除的语言包不会阻止应用启动，解析时回退 `en`。删除当前语言包会把 `settings.json` 的 locale 重置为 `en`。

CLI 通过 `skillink locale list|install|use|remove` 管理语言包；GUI 主进程通过同一套 CLI 命令层执行，Renderer 只消费 preload API 返回的 `LanguageState`。

Windows NSIS 安装包会把内置 `zh-CN.json` 复制到 `locales/zh-cn.json`，目标已存在时不覆盖，以免覆盖用户自定义语言包。应用启动时 `main/bundled-language.ts` 会比较内置包和已安装包：

- `locale` / `name` / `nativeName` 必须一致，确认已安装文件仍代表内置包；
- 内置包版本更高，或内置包包含已安装包缺失的 key 时，通过 `locale install <bundled> --force` 原子刷新；
- 身份不一致的自定义语言包保持原样；
- 刷新失败只记录日志，不阻止应用启动。

因此新增或调整内置文案后，正式安装版升级不需要用户手动删除旧语言包；portable 包没有安装阶段，首次仍需手动安装语言包，但之后同样适用启动刷新。

---

## 5. Package 引用图

### 5.1 节点与边

- 节点：`<package-name>@<version>`；
- 边：`packages` 中的精确 package 版本；
- skill 依赖是节点的属性，不形成 package 节点。

### 5.2 DFS 解析

```text
resolve(node):
  id = name@version
  if id in visiting: throw PACKAGE_CYCLE(path + id)
  if id in visited: return
  visiting.add(id)
  entry = package.json.packages[name].versions[version]
  for each skill in entry.skills:
    skillEntry = skill.json.skills[skill].versions[version]
    if missing: throw VERSION_NOT_FOUND
    if skill already resolved with different version:
      throw SKILL_VERSION_CONFLICT
    if same version: dedupe, append requiredBy
  for each nested package in entry.packages:
    resolve(nested)
  visiting.delete(id)
  visited.add(id)
```

- `visiting` 是当前路径，用于环检测；
- `visited` 是全局已解析集合，用于去重；
- 多根 target 共享 `visited` 和 skill map；
- 同一 skill 同版本：去重，只投影一次；
- 同一 skill 不同版本：`SKILL_VERSION_CONFLICT`；
- 同名 package 不同版本允许同时存在，只要无环、无 skill 冲突。

### 5.3 生命周期强制校验

以下操作必须做图校验，失败不写文件：

| 操作 | 校验 |
|---|---|
| `package create` | 新版本传递闭包：缺失引用、环、skill 冲突 |
| `package copy` | 复制 + override/drop 后的传递闭包 |
| `package tag` | 目标版本传递闭包 |
| `package remove` | 不能被 route/其他 package 引用；剩余图仍可解析 |
| `package check` | 所有 package 版本 skill 引用存在；仅对受影响 target 清理投影，不改配置 |
| `route add` | 新 target 的全部 package 根：环、skill 冲突、缺失 skill |
| `route remove` | 剩余 target 仍可解析；`--force` 用于修复已损坏配置 |
| `apply` | 所有启用 target：package 完整性、skill 内容完整性、环、skill 冲突、内容存在；全部预检通过后才写文件系统 |
| `doctor` | 所有 package 版本、所有 target |

### 5.4 传递闭包哈希

`route.packages[].integrity` 计算方式：

1. 从根 package 版本 DFS 收集所有可达 package 节点；
2. 按 `name@version` 排序；
3. 对每个节点 `stableStringify({ name, version, entry })`；
4. 拼接后 SHA-256；
5. 前缀 `sha256-`。

任何嵌套 package 被手工修改都会让 route lock 失效，apply/doctor 报 `PACKAGE_INTEGRITY_MISMATCH`。

### 5.5 Package 复制

```bash
skillink package copy <source>@<version> <target>@<version> \
  [--skill <skill>@<version>]... \
  [--package <package>@<version>]... \
  [--drop-skill <name>]... \
  [--drop-package <name>]... \
  [--description <text>]
```

- 复制源版本直接 `packages` / `skills` 组合；
- 不深拷贝嵌套 package 定义；
- override/drop 后重新做 DFS 校验；
- 目标版本已存在 -> `PACKAGE_EXISTS`；
- 不复制 tag；
- 用途：解决同一 target 中同一 skill 不同版本的冲突。

---

## 6. 核心流程

### 6.1 导入 skill

```text
选择文件夹
  -> 单个导入：根目录必须有 SKILL.md，否则 SKILL_MD_REQUIRED
  -> 批量导入：递归查找包含 SKILL.md 的包目录，停止进入已命中的包
  -> 每个包独立确认，再扫描、哈希、复制到 skills/<name>/<version>/
  -> 原子更新 skill.json
```

规则：

- 批量扫描不跟随目录链接，但会记录包内目录链接的绝对路径；
- GUI 在点击确认时检测目录链接，命中则提示链接路径、取消该包安装，其他包不受影响；
- 默认名/版本：源目录名为 `<name>@<version>` 时解析并分别使用；显式 `--name` / `--version` 优先；
- 安装卡片把扫描名称保存为 `autoName`，名称输入框初始为空并只把扫描名称显示为 placeholder；用户留空确认时使用 `autoName`，手动输入时以输入值为准；
- 版本输入框只显示自动生成版本的 semver 主体 `1.0.0`，不向用户展示 `+<hash8>` 构建元数据；用户留空确认时由导入按当前内容生成完整版本；
- 目录名缺少名称时，GUI 要求用户手动填写；名称仍缺失时批量扫描回退 `SKILL.md` frontmatter 的 name；CLI 回退文件夹名；
- 版本缺失或不是合法 semver 时回退 `1.0.0+<hash8>`；
- 同 name@version + 同 integrity：复用；
- 同 name@version + 不同 integrity：拒绝；
- 导入扫描直接拒绝源目录中的符号链接和目录联接（junction），错误信息与 `details.path` 包含绝对路径；
- 保留空目录、隐藏文件、普通文件；
- 导入不自动创建 package，也不自动修改 route。

批量扫描接口：

```text
skillink skill scan <folder> --json
  -> { rootDir, packages: [{ sourceDir, name?, version?, description?, directoryLinks[] }] }
```

- `rootDir` 是展开并解析后的扫描根目录；
- `packages` 按目录遍历顺序返回；递归命中 `SKILL.md` 后不再进入该包；
- `directoryLinks` 只记录包内目录符号链接/junction 的绝对路径，不跟随、不读取链接目标；
- 名称优先取源目录名中的 `<name>`，缺失时回退 `SKILL.md` frontmatter 的 `name`；版本优先取 `<name>@<version>` 中的 version；
- CLI 输出人类可读列表；桌面端通过 `skillink:scan-skills` IPC 获取同一份 JSON 报告。

批量安装的模块链路：

```text
SkillsView
  -> window.skillink.scanSkills({ sourceDir })
  -> preload: ipcRenderer.invoke('skillink:scan-skills', input)
  -> main/ipc.ts: ScanSkillsRequestSchema.parse
  -> main/cli-commands.ts: ['skill', 'scan', <sourceDir>, '--json']
  -> @skillink/cli/run -> core/skill-scan.ts
  -> shared/skill-directory.ts + core/skill-md.ts
```

- 扫描阶段只读，不创建目录、不写配置；
- 每个候选包在 GUI 中独立展示；确认后逐个调用 `skill add`，某个包失败或取消不会回滚其他包；
- 包内目录链接在扫描报告中返回；GUI 在确认导入该包时拦截并展示绝对路径，不进入 `skill add`；
- 批量扫描限制递归深度（`DEFAULT_IMPORT_LIMITS.maxDepth`），不跟随目录链接；实际导入仍执行文件数、字节数、深度和符号链接检查。

### 6.2 创建 package

```bash
skillink package create <name>@<version> \
  --skill <skill>@<version>... \
  --package <package>@<version>...
```

- 校验 package 名/版本；
- 校验每个 skill/package 依赖存在；
- 校验每个 skill 版本的内容目录存在且根目录有 `SKILL.md`；
- DFS 校验环、缺失引用、skill 冲突；
- 失败时不写 `package.json`；
- 写入 `package.json`；
- package 版本不可变。

### 6.3 路由

```bash
skillink route add <target-id> <package@range-or-tag>
```

- 解析 package 版本（exact、semver range、tag）；
- 计算根 package 传递闭包哈希；
- 把候选 target 的所有 package 根展开，校验环和 skill 冲突；
- 写入 `route.json`；失败时 route 不变。

### 6.4 Apply

```text
读取并校验 route.json + package.json + skill.json
  -> 验证每个 package lock 的传递闭包哈希
  -> 展开所有启用 package 为 skill 集合
  -> 检查同一 target 内 skill 版本冲突
  -> 对期望集合中的同名条目比对形态和内容
  -> 创建/替换/跳过
```

- target 只创建 skill 链接/副本，不创建 package 目录；
- 每个 skill 源目录必须存在，且根目录有 `SKILL.md`；
- 每个 skill 内容的 `integrity/fileCount/size` 必须与 `skill.json` 一致；
- skill 名/版本必须是安全路径段，源/目标路径必须保持在库和 target 内；
- route 是受管的唯一准则：期望集合中的同名条目无论由谁创建，都按 Skillink 的投影处理；
- 同名条目形态与 `target.mode` 不同时直接删除，按 route 记录的模式重建；形态相同（链接）时再与 skill 库比对 `integrity/fileCount/size`，不同则删除重建；
- 只处理同名且在期望集合中的条目；集合外条目不动；
- 替换真实目录或文件使用 `rm -rf` 直接删除，失败时不恢复被替换内容；
- 所有 target 先完成配置、package 图、skill 内容、路径和条目预检，再创建目录/链接；
- 执行期间创建/替换的链接有进程内回滚；被删除的真实目录/文件不在回滚范围内；进程崩溃仍可能留下半完成状态；
- v2.0 仅支持 `mode: link`；`target add --mode copy` 直接返回 `COPY_MODE_UNSUPPORTED`，迁移遗留 copy target 由 doctor 报 `UNSUPPORTED_MODE`；
- 失败时三个配置文件保持不变。

### 6.5 Status

每个 target 的每个期望 skill 输出：

```text
ok | missing | wrong-mode | wrong-version | broken-link | conflict | disabled
```

- package 解析失败时输出 package 级错误；
- 只报告期望集合中的同名条目；集合外条目忽略；
- 形态与 `target.mode` 不同输出 `wrong-mode`；
- 形态相同但内容哈希不同输出 `wrong-version`；
- 不再用“链接是否指向库内”区分 managed；
- disabled target 输出 `<target>` disabled，不参与链接健康判断；
- `healthy` 要求所有条目为 `ok` 或 `disabled`。

### 6.6 Doctor

检查：

- 三个文件 schema；
- target id 唯一、path 安全且不重复/不嵌套；
- package 版本非空；
- package 引用的 skill/package 存在；
- package 图无环、无 skill 冲突；
- route 引用的 package 版本存在；
- route lock 的传递闭包哈希一致；
- skill 内容目录存在，根目录有 `SKILL.md`；
- skill 内容 `integrity/fileCount/size` 与 `skill.json` 一致（`SKILL_INTEGRITY_MISMATCH`）；
- skill.json 与 `skills/` 目录一一对应；
- 孤儿目录、缺失条目；删除后留下的空 skill 父目录不报 orphan；
- 同一 target 内 skill 版本冲突；
- 链接健康状态；
- 未被 route 引用的 package 版本（`UNUSED_PACKAGE_VERSION`）；嵌套 package 通过传递闭包算作已引用；
- 不支持的 target mode（`UNSUPPORTED_MODE`）；
- package/skill/target 名称大小写冲突（`INVALID_CONFIG`）。

`doctor` 不自动删除任何内容。

### 6.7 GC

- 引用集合 = 所有 route target（含 `enabled: false`）的 package 传递闭包 + skill tags；
- 未被 route 引用的 package 版本不保护 skill；
- GC 后这些 package 可能悬空，doctor 报 `SKILL_NOT_FOUND`；
- 候选 = 未被引用、未被 tag 保留、超过保留期的 skill 版本；
- 删除时先直接删除内容，再更新 skill.json；内容删除失败时 catalog 不变，更新失败时 catalog 仍引用已删除内容，由 `package check` 清理受影响 target 投影；
- package 配置不参与 GC；
- `target remove` 的清理是独立的投影 GC：先解析 target 的全部 package lock（含 `enabled: false` 和 disabled target）得到 skill 名称集合，再删除目标目录顶层同名链接/junction 和真实目录；
- `target disable` 使用与 `target remove` 相同的全部 lock 集合清理整个 target 投影；
- `package disable` 清理“被禁用 package 的传递闭包 − 剩余启用 package 的传递闭包”；target 已 disabled 时跳过，lock 仍在 route 中，后续 `target remove` 仍可清理；
- `route remove` 清理“被移除 package 的传递闭包 − 剩余启用 package 的传递闭包”；即使 target 或 lock 已 disabled，也按被移除 lock 解析并清理，因为该 lock 即将从 route 消失；
- `route add` 覆盖同一 package 版本时，按旧/新活跃 skill 集合的差集清理；即使 target 已 disabled，也按旧 lock 解析并清理，因为旧 lock 已消失；
- 解析失败时跳过投影 GC，配置写入继续进行（`target remove` 保持解析失败即中止）；
- 普通文件和其他类型不处理；不在解析结果中的 extra 条目保留；
- 目标目录本身和 `skills/` 内容不删除；
- 该步骤成功后才写 `route.json`；失败时不写 route，已删除的目标目录条目不恢复。

### 6.8 删除口径

- `skill remove`：拒绝删除被 route 传递闭包引用或被 tag 保留的版本；仅被未引用 package 引用时允许，doctor 报悬空；
- `package remove`：拒绝删除被任一 route（含 disabled）或其他 package 版本引用的版本；
- `route remove`：默认校验剩余 target 仍可解析；`--force` 可删除损坏配置；成功后清理不再需要的 target 投影；
- `package tag` / `skill tag`：只允许指向已存在版本；
- `target remove`：解析 target 的全部 package lock（含 disabled）得到 skill 名称集合，删除目标目录中同名链接/真实目录（普通文件和其他类型跳过），成功后删除 route target；GC 失败或 route 写入失败时 route 不变并立即报错；目标目录本身和 skill 库内容保留；
- `target disable` / `package disable`：更新 enabled 前先清理不再需要的 target 投影，失败时不写 route；
- `skill` 内容先直接删除，再更新 skill.json；target 投影的链接/目录也直接删除；
- `package check`：扫描 package 版本中 catalog 或内容缺失的 skill 引用，找到 route 中引用这些 package 的目标，调用 `target-gc` 删除对应受管 skill 投影；只清理 target 目录，不修改 package/route 配置。

### 6.9 迁移

`skillink migrate` 是全有或全无：

1. 检测旧 `skills.json` 和旧 route（schemaVersion 1）；
2. 预检：
   - 旧 package 至少一个版本；
   - 每个版本内容目录存在；
   - 根目录有 `SKILL.md`（不信任旧 `kind`）；
   - tag 指向存在版本；
   - route 引用存在；
3. 旧 package -> 新 skill + 同名 package；
4. 旧 description/tags 同时复制到 skill 和 package；
5. 旧 route `requested` 原样保留，`resolved` 取旧 lock；
6. 写入三个新文件；失败时删除新文件并恢复旧 route；
7. 成功后直接删除旧 `skills.json`。

### 6.10 Git 控制面与自动提交

`init` 在 `git --version` 可用后：

1. 创建目录与三个配置；
2. 初始化控制面 `.git`（不存在时），补全 `.gitignore` / `.gitattributes`，不覆盖已有内容；
3. 初始化 `skills/.git`，写入 `skills/.gitattributes`；
4. 提交 baseline：控制面 `skillink(init): initialize control plane`，skills `skillink(skills): initialize skills`。

控制面 `.gitignore` 至少包含 `/skills/`、`/trash/`、`/history/`、`/cache/`、`/logs/`、`/tmp/`、`/settings.json`、`.skillink.lock`。两个仓库都写 `* -text`，避免 Windows `core.autocrlf` 改写内容。

写命令的提交规则：

| 命令 | 控制面 | skills |
|---|---|---|
| `init` / `migrate` | 是 | 是（如有内容变化） |
| `skill add` / `skill remove` | 是 | 是 |
| `skill tag` | 是 | 否 |
| `package create/copy/tag/remove` | 是 | 否 |
| `target add/remove/enable/disable` | 是 | 否 |
| `route add/remove/enable/disable` | 是 | 否 |
| `gc --apply` | 是 | 是 |
| `locale install/remove` | 是（locales） | 否 |
| `locale use` | 否（settings 被忽略） | 否 |
| `apply` / `package check` | 否 | 否 |
| `rollback` | 是（一次） | 是（如有内容恢复） |
| 只读命令 / dry-run | 否 | 否 |

- 命令成功后才提交；`git status --porcelain` 无变化时跳过，不创建空提交；
- 控制面只 stage 受管路径（三个配置、`locales/`、`.gitignore`、`.gitattributes`）；home 中其他未跟踪文件不提交，也不参与干净检查；
- 内容变更时先提交 skills，再提交控制面；skills 提交失败则不提交控制面；
- 写命令开始前要求控制面受管路径干净，否则返回 `GIT_DIRTY`，错误包含 home、路径和 `git -C` 提示；
- 所有写命令在 home 级锁 `<home>/.skillink.lock` 内执行，锁覆盖命令与提交；
- 提交使用 `git -c user.name=Skillink -c user.email=skillink@local commit --no-verify`，不依赖用户全局身份，不触发 hooks。

commit message：

```text
skillink(<scope>): <action> <summary>

Command: skillink <argv...>
Changed:
- route.json
- package.json
```

scope 优先取命令路径（`skill`、`package`、`target`、`route`、`gc`、`locale`、`rollback`、`init`、`migrate`）；无法判断时按变更文件推导，多个配置合并为 `config`。subject 限制在 72 字符左右，body 最多列出 20 个变更路径，超出写 `... and N more`。skills 仓库始终使用 `skills` scope。

### 6.11 History 与 Rollback

`history` 只读控制面 `git log`，映射为 `{ id, createdAt, reason }`；`--json` 输出数组。

`rollback <revision>` 是单个 git batch：

1. 解析 revision，校验该提交包含 `route.json` / `package.json` / `skill.json`，读取目标提交的 `skill.json`；
2. 规划缺失的 skill 内容；缺失项需能在 skills git 中找到历史版本，否则报 `SKILL_CONTENT_NOT_IN_GIT`；
3. 读取当前 route，对每个 target 调用 core 的 `removeTarget`，由 `target-gc` 删除受管投影；
4. `git checkout <revision> -- route.json package.json skill.json`；
5. 从 skills git 恢复缺失内容；
6. 删除当前 `skill.json` 记录、但目标 catalog 不再包含的受管 skill 版本，避免回退后 `doctor` 报 `ORPHAN_CONTENT`；
7. 重新 `apply`（`--no-apply` 时跳过）；
8. 先提交 skills（如有恢复或删除），再提交控制面，只产生一次 rollback 提交。

失败时控制面三个配置恢复到 rollback 开始前的 HEAD；已经删除的 target 投影可由下一次 `apply` 重建；错误保留原始错误码。回退不处理未受管条目，也不保证空目录、权限位和 CRLF 的字节级恢复。

---

## 7. CLI 与 GUI

### 7.1 CLI

```text
skillink init
skillink migrate
skillink skill add|scan|list|tag|remove
skillink package create|copy|list|tag|remove|check
skillink target add|list|remove|enable|disable
skillink route add|remove|list|enable|disable
skillink snapshot
skillink apply|status|doctor|gc
skillink history
skillink rollback
skillink env
skillink locale list|install|use|remove
```

`add` 是 `skill add` 的顶层别名。`route remove` 支持 `--force`，用于移除会导致剩余图不可解析的 route entry。

`target remove` 会先按 target 的 package 解析结果清理目标目录中的 skill 目录/链接，再删除 route 条目；普通文件、目标目录本身和 `skills/` 库内容保留。

**JSON 输出**

以下命令支持 `--json`：

```text
init
migrate
skill list|add|scan|tag|remove
package list|create|copy|tag|remove|check
target list|add|remove|enable|disable
route list|add|remove|enable|disable
snapshot
apply
status
doctor
gc
history
rollback
env
```

默认仍是人类可读文本。成功时 stdout 输出该命令的结果对象；失败时如果带 `--json`，stderr 输出单个结构化错误：

```json
{"ok":false,"error":{"code":"SKILL_MD_REQUIRED","message":"...","details":{}}}
```

退出码：`status` / `doctor` 在 unhealthy 时返回 1，所有 `SkillinkError` 也返回 1，调用方应先尝试解析 stdout 的 JSON 结果。

**AI 调用闭环**

```text
init / migrate
  -> skill list --json / package list --json
  -> skill add
  -> package create / package copy
  -> target list --json（需要时 target add）
  -> route add
  -> apply --dry-run --json
  -> apply
  -> status --json / doctor --json
```

失败分支：

```text
SKILL_VERSION_CONFLICT -> package copy -> route add -> apply
drift / missing       -> apply
清理                   -> package remove / skill remove / gc --json -> gc --apply
```

隔离环境使用 `SKILLINK_HOME` 指定控制面。

退出码：

- `0` 成功；
- `1` 一般错误 / unhealthy / 参数解析错误；
- `route add` 的 `SKILL_VERSION_CONFLICT` 当前返回 `1`，stderr 包含 `error [SKILL_VERSION_CONFLICT]`。

### 7.2 GUI

- **Overview**：skills、packages、targets、links、doctor；
- **Targets**：target 列表、package 数、解析后的 skill 数、分配 package、target/package enable/disable（禁用时清理不再需要的投影）、删除 target/route（按 route 清理目标目录条目）、apply 预览（dry-run）、apply 结果；
- **Skills**：选择目录批量扫描 `SKILL.md`，逐个确认安装；扫描名称只作为名称输入框 placeholder，留空确认时作为默认名称；版本输入框显示自动生成版本的 semver 主体 `1.0.0`，不显示 `+<hash8>` 构建元数据；确认时检测包内目录链接，命中则提示绝对路径并取消该包安装；已安装技能按技能名聚合为一张卡片，通过版本切换标签选择版本，再对当前版本执行标记/移除，标签可直接切换到对应版本；GC；
- **Packages**：创建/复制 package、组合列表、标签、删除；
- **Doctor**：健康检查；
- **Language**：安装/切换/删除语言包，显示 nativeName、版本和翻译覆盖率；切换后立即刷新界面，删除当前语言回到英文。

GUI 的刷新通过一次只读 `skillink snapshot --json` 获取 skills、packages、route、status、doctor 和 target 解析结果。Renderer 只调用 preload API；Electron 主进程负责 IPC 校验、argv 映射和串行队列，不直接调用 Core。语言包操作同样走 `locale ... --json` 命令层。

本阶段 GUI 不提供 History 页面；`history` / `rollback` 只在 CLI 提供，GUI 后续可按需接入 `history --json`。

GUI 启动时通过 `skillink env --json` 检测 git；不可用时在侧栏语言切换上方显示提示，说明控制面版本历史、自动提交与回退不可用。

### 7.3 双入口与安装包

GUI 和 CLI 是两个入口，但 **CLI 是唯一业务入口**：

```text
Renderer -> preload -> main/ipc.ts -> main/cli-adapter.ts
  -> @skillink/cli/run -> @skillink/core
```

桌面端主进程不 import `@skillink/core`；它把每个 IPC 请求翻译成 CLI argv，并在同一进程内调用 `runCli`。这样没有子进程启动成本，同时避免 GUI 和 CLI 各自维护一套 Core 调用。所有命令通过一个 Promise 队列串行执行，避免写操作和 `snapshot` 交叉。CLI/Core 代码会打入桌面端主进程，因此这不是物理进程隔离；如果以后需要隔离，只需替换 `cli-adapter`。

CLI 和 GUI 仍共享同一个控制面：

```text
%USERPROFILE%\.agents\skillink\     # 默认
$env:SKILLINK_HOME                  # 覆盖
```

两者读取/写入完全相同的 `route.json`、`package.json`、`skill.json` 和 `skills/`。在 GUI 里做的修改，CLI 下一条命令即可看到；反之亦然。

Windows 安装包由 `pnpm package:win` 生成：

```text
apps/desktop/release/
├─ Skillink Setup 0.0.0.exe     # NSIS 安装包
├─ Skillink 0.0.0.exe           # portable
└─ win-unpacked/
   ├─ Skillink.exe              # GUI 入口
   └─ resources/cli/
      ├─ skillink.cmd           # CLI 启动器
      ├─ skillink.mjs           # CLI bundle
      └─ skillink-path.ps1      # PATH 安装/卸载辅助
```

- 安装包携带 CLI，不要求用户另装 Node.js；
- `skillink.cmd` 使用 `ELECTRON_RUN_AS_NODE=1` 调用安装包自带的 Electron 运行 CLI；
- NSIS 安装时把 `resources\cli` 加入当前用户 PATH，卸载时移除；
- portable 版以 GUI 为主，CLI 文件在解包资源中但不会修改 PATH；
- `pnpm package:win` 会先构建 CLI，再构建桌面端；
- `pnpm package:desktop` 只生成 `win-unpacked`，不生成安装包。

#### 7.3.1 NSIS 安装包与 portable 的区别

| 维度 | NSIS 安装包 | portable |
|---|---|---|
| 文件 | `Skillink Setup <version>.exe` | `Skillink <version>.exe` |
| 形式 | 安装向导，可选择安装目录 | 单文件自解压，运行即用 |
| 系统写入 | 开始菜单、卸载项、Add/Remove Programs、用户 PATH | 基本不写；删除 exe 即可 |
| CLI 入口 | `resources\cli` 加入 HKCU PATH，`skillink` 可直接调用 | 不修改 PATH；CLI 文件在包内，但 GUI 优先 |
| 卸载 | 控制面板/开始菜单卸载，自动移除 PATH 条目；可选删除 `%USERPROFILE%\.agents\skillink\` 用户数据 | 删除 exe |
| 管理员权限 | 默认 `perMachine: false`，按当前用户安装，一般不需要管理员 | 不需要 |
| 升级 | 运行新安装包覆盖 | 替换 exe |
| 适用场景 | 日常使用，需要 GUI + CLI 双入口 | 试用、便携、不想安装 |

NSIS 安装细节：

- `oneClick: false`，允许用户选择安装目录；
- 安装时执行 `skillink-path.ps1 add`，把 `$INSTDIR\resources\cli` 放到当前用户 PATH 前面；
- 安装时把 `resources\locales\zh-CN.json` 复制到 `%USERPROFILE%\.agents\skillink\locales\zh-cn.json`，目标已存在则不覆盖；应用启动时若内置 `zh-CN` 包版本更新或缺少新版本文案，且已安装文件仍匹配内置包身份，会自动刷新；应用仍按 `settings.json` / 系统语言决定是否启用；
- 卸载时执行 `skillink-path.ps1 remove`，只移除该条目；
- 卸载向导提供“Delete Skillink data and configuration”复选框，默认不勾选；勾选后删除 `%USERPROFILE%\.agents\skillink\`（包括 `skills/`、三个数据配置、`settings.json` 和语言包）；
- 静默卸载可传 `--delete-app-data`（兼容 electron-builder）或 `--delete-skillink-data`，效果等同勾选；覆盖安装/升级时即使带参数也不会删除用户数据；
- 卸载程序只处理默认路径；使用 `SKILLINK_HOME` 自定义控制面时，需要手动删除自定义目录；
- 安装/卸载后广播 `WM_WININICHANGE`，新终端可直接识别 `skillink`。

portable 细节：

- electron-builder 生成单文件自解压 exe，运行时会解压到临时目录；
- 不会创建开始菜单、卸载项或 PATH 条目；
- 没有卸载向导；删除 exe 后如需清理数据，手动删除 `%USERPROFILE%\.agents\skillink\`；
- CLI bundle 仍在包内，但不像 NSIS 安装包那样暴露为稳定的 `skillink` 命令；
- 需要 GUI + CLI 双入口时，应使用 NSIS 安装包。

两种包的数据位置：

- 默认都使用 `%USERPROFILE%\.agents\skillink\`，因此 portable 和 NSIS 默认共享同一控制面；
- portable 不会自动把数据放在 exe 旁边；
- GUI 和 CLI 必须指向同一个 `SKILLINK_HOME`，才会管理同一空间。

需要真正便携时，在启动前设置：

```powershell
$env:SKILLINK_HOME = "$PSScriptRoot\skillink-data"
.\Skillink <version>.exe
```

当前两种包都未配置代码签名和自动更新；Windows 可能对未签名安装包显示 SmartScreen 提示。

---

## 8. 安全与跨平台

### 8.1 安全

| 威胁 | 对策 |
|---|---|
| 导入路径异常 | 规范化/展开路径；拒绝系统目录、根目录和符号链接源；限制文件数（10000）、大小（512 MiB）和深度（64） |
| 配置中的恶意 name/version | `SafeNameSchema` / `SafeVersionSchema`；`getSkillDir` 断言安全路径段；apply/GC 做库/target 包含检查 |
| target 路径不安全/重复/嵌套 | `assertSafeTargetPath`；doctor 检查重复、重叠；`addTarget` 拒绝嵌套 |
| 源目录符号链接 | MVP 直接拒绝 |
| 恶意 package 图 | DFS 环检测、生命周期校验 |
| route 手工篡改 | 严格 schema、传递闭包哈希、apply/doctor 校验 |
| package/skill 内容缺失 | `assertSkillContent`：目录存在且根目录有 `SKILL.md` |
| 删除目标内容 | route 期望集合中的同名条目视为受管；形态或内容不同时删除重建；集合外条目不动 |
| 版本库被篡改 | `apply`/`doctor` 重新计算 skill manifest；检测 `SKILL_INTEGRITY_MISMATCH` |
| 配置损坏 | schema 校验、原子写、交叉校验 |
| Renderer XSS | contextIsolation、sandbox、nodeIntegration false、CSP |
| IPC 滥用 | 白名单 API、zod、sender/主窗口/顶层 frame 校验（`IPC_FORBIDDEN`） |
| Windows 文件占用 | 临时文件 + rename；`EBUSY`/`EPERM`/`EACCES`/`ENOTEMPTY` 指数退避重试 |

### 8.2 跨平台

- Windows 默认 junction，无需管理员权限；
- Linux/macOS 默认 symlink；
- 控制面、target、导入源路径支持 `~`、`%USERPROFILE%`、`$HOME`/`${HOME}`；`SKILLINK_HOME` 覆盖控制面；
- Windows 大小写不敏感：package/skill/target 名称做显式大小写冲突检测，路径比较做归一化；
- 中文路径、空格由 Node 文件系统 API 处理；长路径/OneDrive 仍需平台验证；
- 文件被占用时指数退避重试并明确提示。

---

## 9. 数据与运行时

MVP 不依赖数据库；所有状态从三个数据配置、`skills/` 内容和 target 扫描得出。

- 控制面 `.git`：跟踪 `route.json`、`package.json`、`skill.json`、`locales/` 和 ignore/attribute 文件；
- `skills/.git`：跟踪 skill 内容，控制面 git 通过 `/skills/` 忽略；
- `.skillink.lock`：写命令跨进程锁，内容为 `{ pid, startedAt }`；
- `settings.json`、`locales/`：UI 语言偏好与语言包；`locales/` 受版本控制，`settings.json` 不受控制；
- `cache/`、`logs/`、`tmp/`：运行时辅助目录；
- 所有配置写入使用临时文件 + rename。

---

## 10. 测试策略

当前验证（2026-11-01）：56 个测试文件、507 个测试通过；`pnpm typecheck`、`pnpm build` 通过。

| 层级 | 内容 |
|---|---|
| 单元测试 | schema、package 图、环检测、skill 冲突、路径策略、链接计划、git、锁、回退、GC、迁移 |
| 集成测试 | 临时目录、真实 junction/symlink、冲突、崩溃恢复 |
| CLI 测试 | 完整 skill -> package -> route -> apply 闭环、迁移、回滚、批量扫描 |
| Git 测试 | 控制面/skills 初始化、ignore/attributes、自动提交顺序、无空提交、锁、history、rollback 内容恢复与失败恢复 |
| GUI 测试 | IPC schema、页面渲染、空状态、组合展示、target/route 生命周期、apply 预览、批量安装、已安装技能版本聚合与目录链接警告 |
| 桌面/i18n 测试 | 语言包 schema/覆盖率、内置包启动刷新、安装卡片 placeholder 与默认名称、已安装技能版本切换 |
| 安全测试 | 恶意源文件夹、路径穿越、断链、只读文件、同名冲突、内容篡改、非受信 IPC |
| 兼容测试 | Windows 11 本地主验收；Windows/Ubuntu/macOS CI 矩阵 |

重点用例：

1. 没有 `SKILL.md` 的文件夹导入失败；
2. package 版本为空失败；
3. 自环、两节点环、三节点环、同名跨版本环被捕获；
4. 同一 skill 同版本去重；
5. 同一 skill 不同版本在 route add 和 apply 都失败；
6. package copy 通过 override 解决冲突，且引入环/冲突时 `package.json` 不变；
7. target 只出现 skill 目录；
8. 删除未托管内容被拒绝；
9. 三文件历史回滚；
10. v1 迁移遇到无 `SKILL.md` 条目整体失败，旧文件不变；
11. 配置中的 `../` name/version 被拒绝，apply/GC 不写到 target/库之外；
12. 嵌套 package 不被 doctor 误报 unused；
13. 删除最后一个 skill 版本和 GC 后不留下空 orphan 目录；
14. 重复/不安全/嵌套 target 被 doctor/addTarget 拒绝；
15. CLI 重复 `--skill`/`--package` 和 drop 选项可用；
16. 迁移和 skill 删除在写入失败时回滚内容/旧文件；
17. 批量扫描只把包含根 `SKILL.md` 的目录识别为包，嵌套 `SKILL.md` 归入包内容；
18. 批量扫描不跟随目录链接，返回包内链接的绝对路径；GUI 确认该包时取消安装并保留其他包。

### 10.1 已知限制

- `mode: copy` 投影尚未实现；v2.0 在 `target add` 时返回 `COPY_MODE_UNSUPPORTED`，迁移遗留 copy target 由 doctor 报 `UNSUPPORTED_MODE`，计划 v2.1 实现；
- apply 的预检和回滚覆盖普通失败与进程内异常，但不能防止进程崩溃/断电留下半完成 target；
- Windows 长路径、OneDrive 同步冲突尚未做专项自动化验证；
- Linux/macOS 已加入 CI 矩阵，但尚未在真实设备上手工验证；
- apply 回滚只清理本次创建的 target 目录本身，不追踪 `mkdir({ recursive: true })` 创建的父目录；
- 导入限制覆盖文件数、字节数和深度，但不限制空目录数量；
- 批量扫描只限制递归深度，不统计文件数和字节数；完整限制在确认导入时执行，超大目录的扫描阶段仍可能较慢；
- skill manifest 与 package hash 使用 `localeCompare` 排序；保留该行为以兼容已有库，跨 locale 的极端差异可能影响哈希可复现性；
- 当前安装包未配置代码签名和自动更新；
- doctor/apply 会重新哈希 skill 内容，超大版本库首次检查可能较慢；
- CLI 的普通帮助和命令输出仍为英文；`locale` 管理命令本身也输出英文；
- `direction: rtl` 会应用到 `document.documentElement.dir`，但 Arabic/Hebrew 的逐页视觉验收尚未完成；
- `apply` 替换真实目录/文件时直接 `rm -rf`，进程内回滚只恢复链接，不恢复被删除的真实内容；
- `target remove` / `target disable` / `package disable` / `route remove` / `route add` 覆盖版本时直接删除 route 解析出的目标目录条目；GC 中途失败或 route 写入失败时，已经删除的目标目录条目不会恢复，`route.json` 保持不变；
- 控制面 git 依赖系统 `git`；桌面端不内置 git。缺少 git 时 `init`、写命令自动提交和 `rollback` 返回 `GIT_UNAVAILABLE`；
- skills git 作为粗粒度内容历史，不保存空目录，权限位只部分保存；恢复后可能触发 integrity 检查失败；
- rollback 只处理当前 route 中存在的 target；旧 route 中存在但当前 route 中不存在的 target 不会被清理；
- rollback 只删除原 `skill.json` 记录、但目标 catalog 不再包含的 skill 版本；`skills/` 中从未被 catalog 记录的未知目录不处理；
- 损坏的 target package 图会使 rollback 中止（P4，后续可加 `--force` 或 fallback scan）；
- GUI 本阶段没有 History 页面。

---

## 11. 验收标准

1. `skillink init` 创建 `route.json`、`package.json`、`skill.json`；
2. `skillink skill add` 拒绝没有 `SKILL.md` 的文件夹；
3. `package create` 支持 `--skill` 和 `--package`，空依赖失败；
4. `package copy` 支持依赖 override/drop；
5. `route add` 只写 package lock，并拒绝环/skill 冲突；
6. `apply` 只投影 skill，不投影 package；
7. `status` 能报告链接状态和 package 解析错误；
8. `doctor` 能报告缺失内容、孤儿目录、缺 `SKILL.md`、悬空 package、链接问题；
9. `gc` 只回收未被 route/tag 引用的 skill 版本；
10. `migrate` 能从 v1 迁移，失败时旧文件不变；
11. `pnpm test`、`pnpm typecheck`、`pnpm build` 通过；
12. 配置中的不安全 name/version 被拒绝，apply/GC 不越出库或 target；
13. doctor 能报告不安全/重复/嵌套 target，嵌套 package 不被误报 unused；
14. 删除最后一个 skill 版本和 GC 后不留下空 orphan 目录；
15. package create/copy、apply、import 复用都要求 `SKILL.md`；
16. CLI 能完成 init -> skill add -> package create -> target add -> route add -> apply -> status/doctor -> package copy/gc 的调用闭环；
17. 篡改 `skills/<name>/<version>/` 内容后，`apply` 拒绝、`doctor` 报 `SKILL_INTEGRITY_MISMATCH`；
18. target/import 路径支持 `~`、`%USERPROFILE%`、`$HOME`；导入拒绝系统目录和超限目录；
19. `target add --mode copy` 返回 `COPY_MODE_UNSUPPORTED`，doctor 能诊断遗留 copy target；
20. `route remove` 默认校验剩余图，`--force` 可修复；target/package enable/disable 可用；
21. GUI 能删除 target/route、切换 enable（禁用时清理投影）、预览/执行 apply，并显示解析后的 skill 数；
22. `locale` 命令能安装、切换、列出、删除语言包；缺失/损坏语言包回退英文；`zh-CN` 覆盖全部英文 key；
23. `skill scan` 能批量发现技能包；每个包独立确认安装；包含目录链接的包提示绝对路径并取消该包安装，其余包不受影响；
24. 内置 `zh-CN` 包版本更新或缺 key 时，应用启动后自动刷新已安装副本；身份不同的自定义语言包不被覆盖；
25. 安装卡片中的扫描名称只显示为输入框 placeholder，留空确认时使用扫描名称；版本输入框显示自动生成版本的 semver 主体 `1.0.0`，不显示 `+<hash8>` 构建元数据；
26. 已安装技能按技能名聚合为一张卡片，版本切换控件选择版本后，标记/移除操作只作用于当前版本；
27. `target remove` 解析 target 的全部 package lock（含 disabled）得到 skill 集合，删除目标目录中同名链接/真实目录，普通文件和其他类型保留；GC 失败或 route 写入失败时 route 不变并报错；目标目录和 `skills/` 内容保留；
28. apply 对 route 期望集合中的同名条目按形态和内容接管：真实目录/文件直接删除并重建链接，链接内容不同则重建，集合外条目不动；`--prune` 不存在；
29. `target disable`、`package disable`、`route remove`、`route add` 版本覆盖都会清理不再需要的 target 投影；解析失败时跳过清理并允许配置修复；
30. `init` 创建控制面 git 与 skills git，生成 `.gitignore` / `.gitattributes`，并产生 baseline commit；
31. 所有成功且有数据变化的写命令自动提交；无变化、只读、dry-run 不提交，不产生空提交；
32. `history --json` 输出 commit 列表；`rollback <revision>` 清理当前 target、恢复配置和缺失内容、删除旧 catalog 不包含的受管 skill 版本、重新 apply，并只产生一次 rollback 提交；
33. rollback 后 target 中不存在旧 route 的受管投影，`skills/.git` 不被 doctor 报为 orphan；
34. README / ARCHITECTURE 不再包含旧 history/trash 快照语义。

---

### 11.1 当前实现验证

- `pnpm test`：56 个测试文件、507 个测试通过（2026-11-01）；
- `pnpm typecheck`：通过；
- `pnpm build`：CLI 与 Electron 桌面端构建成功；
- 真实 CLI E2E：skill 安装、package 创建/复制、target/route、apply、status/doctor、冲突修复、gc dry-run 均跑通；
- 桌面冒烟：旧版 `zh-CN` 语言包在启动后自动刷新到内置版本，版本输入框显示 `1.0.0`，不显示 hash；
- hardening 验证：内容完整性篡改、apply 预检/回滚、导入限制、路径展开、文件锁重试、IPC sender、大小写冲突、frontmatter、GUI 生命周期均有测试覆盖。

---

## 12. 与 v1.2 的主要差异

| v1.2 | v2.0 |
|---|---|
| `skills.json` 同时管理 package 和内容 | `skill.json` 管 skill，`package.json` 管组合 |
| package 是任意文件夹，`SKILL.md` 可选 | skill 必须有 `SKILL.md`，纯文件夹包非法 |
| route 直接锁 skill | route 锁 package，package 展开 skill |
| package 没有嵌套 | package 可以嵌套 package |
| 无环检测 | 每个 package 生命周期和 apply/route 都做 DFS 环检测 |
| 无传递闭包哈希 | route lock 使用 package 传递闭包哈希 |
| 无 package copy | `package copy` 解决 skill 版本冲突 |
| 旧 `skills.json` | `skillink migrate` 全有或全无迁移 |
| 配置 name/version 未做路径校验 | `SafeNameSchema`/`SafeVersionSchema` + apply/GC 包含检查 |
| package/skill 内容存在性校验较弱 | `assertSkillContent` 强制目录 + `SKILL.md` |
