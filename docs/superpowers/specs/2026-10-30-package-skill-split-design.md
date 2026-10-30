# Skillink Package/Skill 拆分设计

> 日期：2026-10-30  
> 状态：已确认（按用户 2026-10-30 决策重写）  
> 取代：v1.2 架构中的 `skills.json` 公用库模型

## 1. 意图

把原来的两层模型：

```text
target -> package@version（package 同时是内容和库条目）
```

改成三层模型：

```text
target -> package@version -> skill@version -> 实体内容
```

关键点：

- **Skill 是唯一安装单位，也是唯一实体**。一个文件夹只有在根目录存在 `SKILL.md` 时才能被导入为 skill。
- **Package 只是配置文件**。它没有自己的内容目录，不投影到 target，只负责把若干 skill 组合成一个可引用的依赖单元。
- **route.json 只依赖 package**。target 不直接声明 skill；它声明 package，package 再解析出 skill。
- **skill.json 不与路径耦合**。skill 的位置由 `skillink/skills/<skill>/<version>/` 约定推导，skill.json 不存 `source`。
- **纯文件夹包不再合法**。package 的每个版本必须至少组合一个 skill；没有 skill 的 package 版本拒绝写入。

## 2. 目标与非目标

### 2.1 目标

1. 用一个清晰的三层依赖链替代原来的 `skills.json` 单文件目录。
2. 导入 skill 时必须校验 `SKILL.md`，拒绝任意文件夹。
3. 保留 `apply` 的声明式收敛、link/copy、status、doctor、history、GC。
4. 保持可复现：route 锁定 package 版本；package 版本锁定精确 skill 版本。
5. 保留历史快照和回滚，但快照改为三个配置文件一起保存。
6. 让 package 可配置、可版本化，但不产生实体内容。
7. 为旧 `skills.json` 数据提供一次性迁移路径。

### 2.2 非目标

- 不做 skill 之间的依赖图；依赖关系只在 package 层表达。
- 不做 package 内容目录；package 不投影。
- 不执行 `SKILL.md` 中的提示词。
- 不为特定客户端做适配器。
- 不在 target 中生成配置文件。
- 不自动删除未托管内容。
- 不做在线 registry。

### 2.3 反目标

- 不允许“package 目录里有 SKILL.md 就算 package”的旧模型回流。
- 不允许 route 直接写 skill 版本；route 只能写 package 版本。
- 不允许 package 版本为空；空 package 不是合法依赖。
- 不允许 skill.json 存实现路径；路径只由库布局约定推导。

## 3. 方案比较

### 方案 A：package 仍作为实体目录投影到 target

- 内容：`packages/<package>/<version>/` 保存 package.json 和若干 skill 文件夹；target 得到 package 链接。
- 优点：package 边界直观，一个链接包含多个 skill。
- 缺点：与“真实体只有 skill”冲突；target 里多一层 package 目录；skill 无法直接共享；不符合用户“package 只是配置文件”的定义。
- 结论：不采用。

### 方案 B：package 为配置层，skill 为投影单位（采用）

- 内容：`package.json` 只描述 package 版本到 skill 版本的组合；target 直接得到 skill 链接/副本。
- 优点：skill 是唯一实体；route 只依赖 package；target 布局保持扁平的 skill 文件夹；package 可以随时重构组合。
- 缺点：同一个 target 中不同 package 引用同一 skill 的不同版本时会产生冲突，需要明确拒绝。
- 结论：采用。

### 方案 C：package 为配置层，但 target 按 package 分子目录投影

- 内容：target 下先建 package 目录，再在 package 目录里放 skill。
- 优点：同名 skill 不同版本可以共存。
- 缺点：target 结构变深，客户端发现 skill 的路径不再扁平；与“安装单位是 skill”不一致。
- 结论：不采用，作为未来可选的 `layout: nested` 扩展。

## 4. 最终模型

```text
route.json       target -> package@version
  └─ package.json   package@version -> skill@exact-version
       └─ skill.json    skill@version -> 完整性/元数据
            └─ skillink/skills/<skill>/<version>/SKILL.md
```

### 4.1 文件位置

```text
%USERPROFILE%\.agents\skillink\          # 或 ~/.agents/skillink
├─ route.json
├─ package.json
├─ skill.json
├─ skills\
│  └─ <skill>\
│     └─ <version>\
│        └─ SKILL.md
├─ history\
│  └─ <timestamp>\
│     ├─ route.json
│     ├─ package.json
│     ├─ skill.json
│     └─ meta.json
├─ trash\
├─ cache\
├─ logs\
└─ tmp\
```

- `skill.json` 取代原 `skills.json`。
- `package.json`、`route.json`、`skill.json` 三者同级，都是全局配置，不是每个包目录里的文件。
- 旧 `skills.json` 在迁移后移入 `trash/<timestamp>/skills.json`。

### 4.2 route.json

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

- `targets[].packages` 是唯一的依赖声明；旧的 `skills` key 不再存在。
- `integrity` 是 package 版本配置的规范化哈希，不是内容哈希。它用于检测 `package.json` 被手工改动后 route 锁失效。
- route 不存 skill 版本、不存 source、不存内容 integrity。

### 4.3 package.json

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

约束：

- `packages` 的每个 package 必须有至少一个版本；空 `versions` 非法。
- `versions` 的每个版本必须有至少一个依赖；`packages` 和 `skills` 合计不能为空。
- `packages` 和 `skills` 的值都必须是精确版本，不允许 range；range/tag 只出现在 route 的 `requested`。
- 允许 package 引用 package，也允许 package 引用同名 package 的其他版本；只要引用图无环。
- 引用图必须是 DAG；任何 package 生命周期都做 DFS 环检测。
- package 版本一旦创建，工具不再修改它；要改组合必须用 `package copy` 生成新版本。
- package 版本不存路径、不存内容 integrity；内容完整性属于 skill。
- 包名和 skill 名各自独立命名空间，允许同名。

### 4.4 skill.json

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

约束：

- 不存 `source`；内容路径固定为 `skills/<name>/<version>/`。
- 不存 `kind`；所有条目都是 skill。
- 每个版本的内容目录必须存在，且根目录必须有 `SKILL.md`。
- `integrity` 是内容快照哈希，沿用现有 SHA-512 manifest 算法。
- `metadata` 可选，来自 `SKILL.md` frontmatter，仅用于展示。
- `tags` 可选，仅用于展示和 GC 保留；package 组合使用精确版本，不依赖标签。

### 4.5 解析规则

对于每个 target：

1. 遍历 `target.packages` 中 `enabled !== false` 的 package lock。
2. 在 `package.json` 中查找 package 和 `resolved` 版本。
3. 校验 package 版本的传递闭包哈希与 route lock 的 `integrity` 一致。
4. 从根 package 版本开始 DFS：
   - 先收集当前 package 版本直接引用的 skill；
   - 再递归收集 `packages` 中引用的其他 package 版本；
   - `visiting` 集合检测环，发现环立即抛 `PACKAGE_CYCLE`，错误信息包含完整路径；
   - `visited` 集合去重，同一 `name@version` 只遍历一次。
5. 在 `skill.json` 中查找每个 skill 版本；缺失则报错。
6. 如果同一 target 中同一个 skill 被解析成不同版本，报 `SKILL_VERSION_CONFLICT`，拒绝 apply。
7. 如果同一 skill 被多个 package 解析成同一版本，去重，只投影一次；`requiredBy` 记录所有来源。
8. 允许同一个 package 名字的多个版本同时出现在图中；只要没有环、没有 skill 版本冲突。

### 4.6 Target 投影

- target 只包含 skill 文件夹，不包含 package 文件夹。
- link 模式：`target/<skill>` -> `skillink/skills/<skill>/<version>`。
- copy 模式：把 skill 内容复制到 `target/<skill>`；v2.0 明确不实现，`target add --mode copy` 返回 `COPY_MODE_UNSUPPORTED`，迁移遗留 copy target 由 doctor 报 `UNSUPPORTED_MODE`，计划 v2.1 实现。
- `--prune` 只删除由 Skillink 管理的、且不再被解析出的 skill 链接/副本。
- 未托管同名内容永不覆盖。

## 5. 核心流程

### 5.1 导入 skill

```text
选择文件夹
  -> 根目录必须有 SKILL.md，否则 SKILL_MD_REQUIRED
  -> 扫描、哈希、复制到 skills/<name>/<version>/
  -> 原子更新 skill.json
```

- 默认名：文件夹名；默认版本：`0.0.0+<hash8>`。
- 同 name@version + 同 integrity：复用。
- 同 name@version + 不同 integrity：拒绝。
- 导入不自动创建 package，也不自动修改 route。

### 5.2 创建 package

```text
skillink package create <name>@<version> \
  --skill <skill>@<version>... \
  --package <package>@<version>...
  -> 校验 package 名/版本
  -> 校验每个 skill@version 存在于 skill.json 且内容存在
  -> 校验每个 package@version 存在
  -> DFS 校验引用图：无环、无 skill 版本冲突、无缺失引用
  -> 写入 package.json
```

- package 版本必须至少一个依赖；`packages` 与 `skills` 合计为空时拒绝。
- package 版本不可变；修改组合 = 用 `package copy` 创建新版本。
- package 可以打标签；route 的 `requested` 可以用标签或 semver range。
- 每次 create/copy/tag/remove 都做图校验，失败不写文件。

### 5.2.1 复制 package

```text
skillink package copy <source>@<version> <target>@<version> \
  [--skill <skill>@<version>]... \
  [--package <package>@<version>]... \
  [--drop-skill <skill>]... \
  [--drop-package <package>]... \
  [--description <text>]
```

- 复制源 package 版本的直接 `packages` / `skills` 组合，不深拷贝嵌套 package 定义。
- override/drop 后重新做 DFS 校验；有环、缺失引用、skill 冲突则拒绝。
- 目标 package 已存在同一版本时拒绝。
- 用途：两个 package 需要同一 skill 的不同版本时，复制其中一个并修改其 skill/package 依赖，使版本对齐，再把 route 指向复制版本。
- 复制不自动修改 route，不自动删除旧 package。

### 5.3 路由

```text
skillink route add <target> <package>@<range-or-tag>
  -> 解析 package 版本
  -> 计算 package 版本配置哈希
  -> 写入 target.packages[package] = { requested, resolved, integrity }
```

- route 不展开 skill。
- 删除 route entry 不影响 package.json / skill.json。
- 被 route 引用的 package 版本不能删除。

### 5.4 Apply

```text
读取并校验 route.json + package.json + skill.json
  -> 解析每个 target 的 package
  -> 展开为 skill 集合
  -> 检查同 target 内 skill 版本冲突
  -> 对比 target 实际链接
  -> 创建/替换/跳过/删除（--prune）
```

- 任一配置无效、交叉引用失败、skill 内容缺失、版本冲突：拒绝 apply。
- 失败时 route/package/skill 三文件保持不变。
- 操作以 skill 为单位报告。

### 5.5 Status

- 每个 target 的每个期望 skill 输出状态：`ok | missing | wrong-version | broken-link | conflict | unmanaged | extra | disabled`。
- package 解析失败时输出一条 package 级错误，附带 package 名和原因。
- `extra` 只报告受管但不在期望集合中的链接。

### 5.6 Doctor

检查：

- 三个文件的 schema、重复 target id/path、嵌套 target、大小写重复名称。
- package 版本非空；package 引用的 skill 版本存在于 skill.json。
- route 引用的 package 版本存在；package 配置哈希一致。
- skill 内容目录存在，且根目录有 `SKILL.md`；内容 integrity/fileCount/size 与 skill.json 一致。
- skill.json 与 `skills/` 目录一一对应；孤儿目录、缺失条目。
- 同一 target 的 package 展开后是否有 skill 版本冲突。
- 不支持的 target mode（copy）。
- 链接健康状态。
- 未被任何 route 引用的 package 版本（警告，不自动删除）。

### 5.7 GC

- 引用集合 = 所有 route target 中 package lock 的传递闭包；`enabled: false` 的 target 和 package lock 仍然算引用，因为它们是期望状态的一部分，只是暂时不投影。
- 另外保留 `skill.json` 中被 tag 指向的 skill 版本。
- 候选 = skill.json 中未被引用、未被 tag 保留、超过保留期的 skill 版本。
- 未被任何 route 引用的 package 版本不保护 skill；它们可能在 GC 后变成悬空配置，`doctor` 会报 `SKILL_NOT_FOUND`。
- 删除时先移入 `trash/`，再更新 skill.json；失败回滚内容。
- package 配置不参与 GC；未引用的 package 版本只在 doctor 中提示。

### 5.7.1 删除的“被引用”口径

- `skill remove`：拒绝删除被任一 route package 的传递闭包引用、或被 tag 保留的 skill 版本。仅被未引用 package 版本引用时允许删除，doctor 会把该 package 标为悬空。
- `package remove`：拒绝删除被任一 route（含 disabled）引用、或被其他 package 版本直接引用的 package 版本。
- `package tag`：只允许指向已存在的 package 版本，并重新做图校验。
- `skill tag`：只允许指向已存在的 skill 版本；tag 是 GC 保护标记。

### 5.8 History

- 每次修改配置前，把 `route.json`、`package.json`、`skill.json` 一起快照。
- 快照元数据增加 `format: 2`。
- 回滚时三文件成对恢复；skill 内容缺失时优先从 `trash/` 找，找不到则拒绝回滚。
- 写入顺序：`skill.json` -> `package.json` -> `route.json`，保证引用不会指向不存在的内容。
- 旧 `skills.json` 快照不会被新代码读取；迁移时保留在原历史目录，但列表只显示 `format: 2` 的快照。

### 5.9 迁移

`skillink migrate` 是**全有或全无**的迁移：

1. 检测旧 `skills.json` 和旧 route（schemaVersion 1）。
2. 预检所有旧条目，任一失败则整体中止，旧文件不变，并输出问题列表：
   - 旧 package 至少有一个版本；
   - 每个旧版本的内容目录存在；
   - 每个旧版本的内容根目录有 `SKILL.md`（不信任旧 `kind` 字段，直接检查文件系统）；
   - 每个旧 tag 指向已存在的版本；
   - 旧 route 引用的每个版本存在。
3. 旧 `skills.json.packages` 映射为 `skill.json.skills`，保留版本、integrity、fileCount、size、built、metadata。
4. 旧 package 的 `description` 和 `tags` **同时复制到 skill 条目和同名 package 条目**：
   - skill tags 用于 GC 保护；
   - package tags 用于保持旧 route 中 `requested: "latest"` 之类标签仍可解析；
   - description 两边都保留，便于 GUI 展示。
5. 为每个旧 package 生成同名 package，版本一一对应，每个 package 版本的 `skills` 为 `{ <name>: <version> }`。
6. 旧 route 的 `targets[].skills` 映射为 `targets[].packages`，`requested` 原样保留（包括 tag），并计算 package 传递闭包哈希。
7. 写入三个新文件；旧 `skills.json` 移入 `trash/<timestamp>/`。
8. 迁移失败时保持旧文件不变。

没有旧文件时，`init` 创建三个空文件。

旧 history 快照保持原样，不删除；新代码只读取带 `format: 2` 的快照。

## 6. CLI 与 GUI 影响

### 6.1 CLI

```text
skillink init
skillink migrate
skillink skill add <folder> [--name] [--version]
skillink skill list [--json]
skillink skill tag <skill@version> <tag>
skillink skill remove <skill@version>
skillink package create <name@version> --skill <skill@version>... [--description]
skillink package list [--json]
skillink package tag <package@version> <tag>
skillink package remove <package@version>
skillink target add <path> [--id] [--label]
skillink target list
skillink target remove <id>
skillink target enable|disable <id>
skillink route add <target-id> <package@range-or-tag>
skillink route remove <target-id> <package> [--force]
skillink route list
skillink route enable|disable <target-id> <package>
skillink apply [--target] [--dry-run] [--prune]
skillink status [--json] [--target]
skillink doctor [--json]
skillink gc [--apply] [--max-age-days]
skillink history [--json]
skillink rollback <snapshot-id> [--apply] [--json]
```

- 保留 `add` 作为 `skill add` 的别名，减少旧脚本断裂。
- `library` 命令组移除；由 `skill` 取代。
- `route add` 的第二参数语义从 skill 改为 package。

### 6.2 GUI

页面调整为：

- Overview：skills、packages、targets、links、doctor 概览。
- Targets：target 列表；分配/删除 package（不是 skill）；target/route enable/disable；显示 package 数和解析出的 skill 数；apply 预览/prune；删除 target。
- Skills：导入 skill（必须 `SKILL.md`）、版本、标签、删除、GC。
- Packages：创建 package 版本（选择若干 skill@version）、列表、标签、删除。
- History：三文件快照与回滚。
- Doctor：健康检查。

IPC 增加：

- `importSkill`
- `createPackage`
- `removePackage`
- `packageTag`
- 现有 `libraryTag`/`libraryRemove` 重命名为 `skillTag`/`skillRemove`
- `routeAdd` 的 `name` 语义改为 package 名

## 7. 关键边界与错误

| 场景 | 行为 |
|---|---|
| 导入文件夹没有根级 `SKILL.md` | 拒绝，`SKILL_MD_REQUIRED` |
| package 版本没有任何依赖 | 拒绝，`PACKAGE_EMPTY` |
| package 引用不存在的 package 版本 | 拒绝，`PACKAGE_NOT_FOUND` / `VERSION_NOT_FOUND` |
| package 引用不存在的 skill 版本 | 拒绝，`VERSION_NOT_FOUND` |
| package 引用图有环 | 拒绝，`PACKAGE_CYCLE`，错误含完整路径 |
| route 引用不存在的 package 版本 | 拒绝，`PACKAGE_NOT_FOUND` / `VERSION_NOT_FOUND` |
| package.json 被手工改动导致传递闭包哈希不符 | apply 拒绝，doctor 报 `PACKAGE_INTEGRITY_MISMATCH` |
| 同一 target 中两个 package 需要同一 skill 的不同版本 | 拒绝，`SKILL_VERSION_CONFLICT` |
| 同一 target 中两个 package 需要同一 skill 的同一版本 | 去重，投影一次 |
| 删除仍被 route 引用的 package 版本 | 拒绝，`VERSION_IN_USE` |
| 删除仍被其他 package 引用的 package 版本 | 拒绝，`PACKAGE_IN_USE` |
| 删除仍被 route 传递闭包引用或被 tag 保留的 skill 版本 | 拒绝，`VERSION_IN_USE` |
| 仅被未引用 package 引用的 skill 版本 | 允许删除；doctor 将被悬空的 package 报 `SKILL_NOT_FOUND` |
| 旧 `skills.json` 存在但未迁移 | `init`/`doctor` 提示运行 `skillink migrate` |
| 迁移遇到没有 `SKILL.md` 的旧条目 | 整体中止，列出问题，旧文件不变 |
| 旧 history 快照 | 列表忽略；不参与回滚 |

## 8. 工作拆分

这是一个项目级重写，按以下顺序实施：

1. 共享 schema 与路径：`RouteFile` v2、`PackageFile`、`SkillFile`、`PackageLock`。
2. 引用图：`package-graph.ts`，DFS 环检测、skill 去重/冲突、传递闭包哈希。
3. 核心存储：`package-store.ts`、`skill-store.ts`（取代 `library.ts`）、route 读写。
4. 导入：`SKILL.md` 强制校验。
5. Apply / Status / Doctor / GC / History 重写。
6. Package copy 与迁移命令。
7. CLI 重写。
8. 桌面端 IPC + 页面重写。
9. 文档重写。
10. 全量测试与类型检查。

## 9. 留给实现者的决定

- 包名/版本校验直接复用现有 `package-name.ts`；skill 名也使用同一规则。
- package 传递闭包哈希：对根 package 可达的所有 `name@version` 节点按顺序 `stableStringify({ name, version, entry })`，SHA-256，前缀 `sha256-`。
- `skill.json` 的 `description` 优先取 frontmatter description；没有则留空。
- GUI 的 package 创建/复制表单采用“每行一个 `skill@version` / `package@version`”的文本框，保持 MVP 简单；后续再换成选择器。
- copy 模式 v2.0 不实现：`target add --mode copy` 返回 `COPY_MODE_UNSUPPORTED`；迁移遗留 copy target 由 doctor 报 `UNSUPPORTED_MODE`；v2.1 再复用链接模块的 copy 兜底。
- 旧 v1 历史快照原样保留，不删除；新代码只读取带 `format: 2` 的快照。
- 迁移采用全有或全无；不提供跳过非法条目的选项，避免产生半合法 v2 状态。
