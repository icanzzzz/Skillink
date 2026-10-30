# Skillink 项目架构（v2.0）

> 日期：2026-10-30  
> 状态：v2.0 MVP + hardening（2026-10-31）  
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
8. GUI 能清楚展示 skill、package、route、链接和健康状态。

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
| Managed | 由 Skillink 创建和管理的链接/副本 |
| Unmanaged | 非 Skillink 创建的内容，工具不自动删除 |
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

### 3.3 三个全局配置文件

```text
%USERPROFILE%\.agents\skillink\          # 或 ~/.agents/skillink
├─ route.json      # target -> package
├─ package.json    # package -> skill/package 组合
├─ skill.json      # skill -> 版本、完整性、标签
├─ skills\         # 唯一实体内容
├─ history\        # 三文件快照
├─ trash\          # 删除/GC 的内容
├─ cache\
├─ logs\
└─ tmp\
```

`skill.json` 取代 v1 的 `skills.json`。三个文件都是全局配置，不是每个包目录里的文件。

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
- 写入采用临时文件 + rename，并保留历史快照。

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
- `integrity` 与目录内容一致；`apply`、`doctor`、`history` 回滚会重新计算并校验；
- `fileCount`、`size` 与目录内容一致；
- tags 必须指向已存在版本；
- 写入采用临时文件 + rename。

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
| `route add` | 新 target 的全部 package 根：环、skill 冲突、缺失 skill |
| `route remove` | 剩余 target 仍可解析；`--force` 用于修复已损坏配置 |
| `apply` | 所有启用 target：package 完整性、skill 内容完整性、环、skill 冲突、内容存在；全部预检通过后才写文件系统 |
| `doctor` | 所有 package 版本、所有 target |
| `history rollback` | 恢复前三文件图必须可解析 |

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
  -> 根目录必须有 SKILL.md，否则 SKILL_MD_REQUIRED
  -> 扫描、哈希、复制到 skills/<name>/<version>/
  -> 原子更新 skill.json
```

规则：

- 默认名：文件夹名；默认版本：`0.0.0+<hash8>`；
- 同 name@version + 同 integrity：复用；
- 同 name@version + 不同 integrity：拒绝；
- 源目录中的符号链接 MVP 直接拒绝；
- 保留空目录、隐藏文件、普通文件；
- 导入不自动创建 package，也不自动修改 route。

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
  -> 对比 target 实际链接
  -> 创建/替换/跳过/删除（--prune）
```

- target 只创建 skill 链接/副本，不创建 package 目录；
- 每个 skill 源目录必须存在，且根目录有 `SKILL.md`；
- 每个 skill 内容的 `integrity/fileCount/size` 必须与 `skill.json` 一致；
- skill 名/版本必须是安全路径段，源/目标路径必须保持在库和 target 内；
- `--prune` 只删除受管且不再需要的 skill 链接；
- 未托管同名内容永不覆盖；
- 所有 target 先完成配置、package 图、skill 内容、路径和冲突预检，再创建目录/链接；
- 执行期间创建/替换/prune 的链接有进程内回滚；进程崩溃仍可能留下半完成状态；
- v2.0 仅支持 `mode: link`；`target add --mode copy` 直接返回 `COPY_MODE_UNSUPPORTED`，迁移遗留 copy target 由 doctor 报 `UNSUPPORTED_MODE`；
- 失败时三个配置文件保持不变。

### 6.5 Status

每个 target 的每个期望 skill 输出：

```text
ok | missing | wrong-version | broken-link | conflict | unmanaged | extra | disabled
```

- package 解析失败时输出 package 级错误；
- `extra` 只报告受管但不在期望集合中的链接；
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
- 删除时先移入 `trash/`，再更新 skill.json；失败回滚；
- package 配置不参与 GC。

### 6.8 删除口径

- `skill remove`：拒绝删除被 route 传递闭包引用或被 tag 保留的版本；仅被未引用 package 引用时允许，doctor 报悬空；
- `package remove`：拒绝删除被任一 route（含 disabled）或其他 package 版本引用的版本；
- `route remove`：默认校验剩余 target 仍可解析；`--force` 可删除损坏配置；
- `package tag` / `skill tag`：只允许指向已存在版本；
- 所有删除先进入 `trash/`。

### 6.9 History

- 每次修改配置前，把 `route.json`、`package.json`、`skill.json` 一起快照；
- 快照目录：`history/<timestamp>/{route.json,package.json,skill.json,meta.json}`；
- `meta.json` 包含 `format: 2`；
- 回滚前校验 package 图、route lock 和 skill 内容完整性；
- skill 内容目录必须存在且与快照 integrity 一致；缺失或不匹配时优先从 `trash/` 恢复有效副本，找不到则拒绝回滚；
- 写入顺序：`skill.json` -> `package.json` -> `route.json`；
- 普通写入失败会尝试恢复三文件；如果恢复写入本身失败，报 `IO_ERROR` 并列出 `restoreFailures`，此时可能需要人工修复；
- 进程崩溃/断电仍可能留下混合状态；
- 旧 v1 快照不列出、不可回滚。

### 6.10 迁移

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
6. 旧 `skills.json` 备份到 `trash/<timestamp>/skills.json`；
7. 写入三个新文件；失败时删除新文件并恢复旧 route；
8. 成功后移除旧 `skills.json`。

---

## 7. CLI 与 GUI

### 7.1 CLI

```text
skillink init
skillink migrate
skillink skill add|list|tag|remove
skillink package create|copy|list|tag|remove
skillink target add|list|remove|enable|disable
skillink route add|remove|list|enable|disable
skillink apply|status|doctor|gc|history|rollback
```

`add` 是 `skill add` 的顶层别名。`route remove` 支持 `--force`，用于移除会导致剩余图不可解析的 route entry。

**JSON 输出**

以下命令支持 `--json`：

```text
skill list
package list
target list
route list
apply
status
doctor
gc
history
rollback
```

写命令（`skill add`、`package create`、`package copy`、`target add`、`route add`、`skill/package tag/remove` 等）默认输出人类可读文本；AI 通过退出码判断成功，再用对应的 `list` / `status` / `doctor --json` 查询状态。

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
需要回退               -> history --json -> rollback <id> --apply
清理                   -> package remove / skill remove / gc --json -> gc --apply
```

隔离环境使用 `SKILLINK_HOME` 指定控制面。

退出码：

- `0` 成功；
- `1` 一般错误 / unhealthy / 参数解析错误；
- `3` apply 冲突；
- `route add` 的 `SKILL_VERSION_CONFLICT` 当前返回 `1`，stderr 包含 `error [SKILL_VERSION_CONFLICT]`。

### 7.2 GUI

- **Overview**：skills、packages、targets、links、doctor；
- **Targets**：target 列表、package 数、解析后的 skill 数、分配 package、target/package enable/disable、删除 target/route、apply 预览（dry-run）、prune、apply 结果；
- **Skills**：导入 skill、标签、删除、GC；
- **Packages**：创建/复制 package、组合列表、标签、删除；
- **History**：三文件快照与回滚；
- **Doctor**：健康检查。

### 7.3 双入口与安装包

GUI 和 CLI 是两个入口，但共用同一套 Core 和同一个控制面：

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
| 卸载 | 控制面板/开始菜单卸载，自动移除 PATH 条目 | 删除 exe |
| 管理员权限 | 默认 `perMachine: false`，按当前用户安装，一般不需要管理员 | 不需要 |
| 升级 | 运行新安装包覆盖 | 替换 exe |
| 适用场景 | 日常使用，需要 GUI + CLI 双入口 | 试用、便携、不想安装 |

NSIS 安装细节：

- `oneClick: false`，允许用户选择安装目录；
- 安装时执行 `skillink-path.ps1 add`，把 `$INSTDIR\resources\cli` 放到当前用户 PATH 前面；
- 卸载时执行 `skillink-path.ps1 remove`，只移除该条目；
- 安装/卸载后广播 `WM_WININICHANGE`，新终端可直接识别 `skillink`。

portable 细节：

- electron-builder 生成单文件自解压 exe，运行时会解压到临时目录；
- 不会创建开始菜单、卸载项或 PATH 条目；
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
| 删除未托管内容 | 只删除受管链接/副本；默认不 prune |
| 版本库被篡改 | `apply`/`doctor`/history 重新计算 skill manifest；检测 `SKILL_INTEGRITY_MISMATCH` |
| 配置损坏 | schema 校验、原子写、历史快照、交叉校验 |
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

MVP 不依赖数据库；所有状态从三个配置文件、`skills/` 内容和 target 扫描得出。

- `history/`：配置快照；
- `trash/`：删除/GC 的内容；
- `cache/`、`logs/`、`tmp/`：运行时辅助目录；
- 所有配置写入使用临时文件 + rename；
- 历史快照用于回滚和审计。

---

## 10. 测试策略

当前验证：35 个测试文件、291 个测试通过；`pnpm typecheck`、`pnpm build` 通过。

| 层级 | 内容 |
|---|---|
| 单元测试 | schema、package 图、环检测、skill 冲突、路径策略、链接计划、历史、GC、迁移 |
| 集成测试 | 临时目录、真实 junction/symlink、冲突、崩溃恢复 |
| CLI 测试 | 完整 skill -> package -> route -> apply 闭环、迁移、回滚 |
| GUI 测试 | IPC schema、页面渲染、空状态、组合展示、target/route 生命周期、apply 预览 |
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
16. 迁移和 skill 删除在写入失败时回滚内容/旧文件。

### 10.1 已知限制

- `mode: copy` 投影尚未实现；v2.0 在 `target add` 时返回 `COPY_MODE_UNSUPPORTED`，迁移遗留 copy target 由 doctor 报 `UNSUPPORTED_MODE`，计划 v2.1 实现；
- apply 的预检和回滚覆盖普通失败与进程内异常，但不能防止进程崩溃/断电留下半完成 target；
- history restore 在普通写入失败时会尝试回滚三文件；若恢复写入本身失败，会报 `IO_ERROR` 并列出 `restoreFailures`，此时可能需要人工修复；进程崩溃窗口仍存在；
- 当前配置已经损坏到无法通过 schema 时，`rollback` 不能作为修复入口（创建回滚前快照会先失败）；需要手工修复或直接从 `history/<id>/` 复制文件；
- Windows 长路径、OneDrive 同步冲突尚未做专项自动化验证；
- Linux/macOS 已加入 CI 矩阵，但尚未在真实设备上手工验证；
- 当前安装包未配置代码签名和自动更新；
- doctor/apply 会重新哈希 skill 内容，超大版本库首次检查可能较慢。

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
10. `history` 快照包含三个文件，回滚同时恢复；
11. `migrate` 能从 v1 迁移，失败时旧文件不变；
12. `pnpm test`、`pnpm typecheck`、`pnpm build` 通过；
13. 配置中的不安全 name/version 被拒绝，apply/GC 不越出库或 target；
14. doctor 能报告不安全/重复/嵌套 target，嵌套 package 不被误报 unused；
15. 删除最后一个 skill 版本和 GC 后不留下空 orphan 目录；
16. package create/copy、apply、import 复用、history restore 都要求 `SKILL.md`；
17. CLI 能完成 init -> skill add -> package create -> target add -> route add -> apply -> status/doctor -> package copy/rollback/gc 的调用闭环；
18. 篡改 `skills/<name>/<version>/` 内容后，`apply` 拒绝、`doctor` 报 `SKILL_INTEGRITY_MISMATCH`；
19. target/import 路径支持 `~`、`%USERPROFILE%`、`$HOME`；导入拒绝系统目录和超限目录；
20. `target add --mode copy` 返回 `COPY_MODE_UNSUPPORTED`，doctor 能诊断遗留 copy target；
21. `route remove` 默认校验剩余图，`--force` 可修复；target/package enable/disable 可用；
22. GUI 能删除 target/route、切换 enable、预览/执行 apply/prune，并显示解析后的 skill 数。

---

### 11.1 当前实现验证

- `pnpm test`：35 个测试文件、291 个测试通过；
- `pnpm typecheck`：通过；
- `pnpm build`：CLI 与 Electron 桌面端构建成功；
- 真实 CLI E2E：skill 安装、package 创建/复制、target/route、apply、status/doctor、冲突修复、history/rollback、gc dry-run 均跑通；
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
| 历史快照两文件 | 历史快照三文件 |
| 旧 `skills.json` | `skillink migrate` 全有或全无迁移 |
| 配置 name/version 未做路径校验 | `SafeNameSchema`/`SafeVersionSchema` + apply/GC 包含检查 |
| package/skill 内容存在性校验较弱 | `assertSkillContent` 强制目录 + `SKILL.md` |
