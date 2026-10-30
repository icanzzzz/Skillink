# Package 引用图与复制设计（补充）

> 日期：2026-10-30  
> 依赖：`2026-10-30-package-skill-split-design.md`  
> 本文件补充用户新增的 package 引用规则；合并时以本文件为准。

## 1. Package 可以引用 package 和 skill

`package.json` 的每个 package 版本由两类依赖组成：

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
            "pdf": "1.3.0"
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

- 每个 package 版本至少有一个依赖，`packages` 和 `skills` 合计不能为空。
- `packages` 的值是精确 package 版本，不是 range；range 只出现在 `route.json` 的 `requested`。
- `skills` 的值是精确 skill 版本。
- 同一个 package 版本的 `packages` / `skills` map 中，同一个名字只能出现一次（JSON map 天然保证）。
- 允许 package 引用同名 package 的其他版本，例如 `frontend@1.1.0` 可以引用 `frontend@1.0.0`；只要不形成环即可。
- 不允许 package 引用自身同一版本，直接形成自环。

## 2. 引用图解析

### 2.1 节点

- 节点 ID：`<package-name>@<version>`。
- 根节点：route 中 target 的每个 package lock 的 `resolved` 版本，或 package 生命周期中待验证的 package 版本。

### 2.2 DFS 规则

```text
resolve(node):
  id = name@version
  if id in visiting: throw PACKAGE_CYCLE(path + id)
  if id in visited: return
  visiting.add(id)
  entry = package.json.packages[name].versions[version]
  if missing: throw PACKAGE_NOT_FOUND / VERSION_NOT_FOUND
  for each skill in entry.skills:
    skillEntry = skill.json.skills[skillName].versions[skillVersion]
    if missing: throw VERSION_NOT_FOUND
    if skill already resolved with different version:
      throw SKILL_VERSION_CONFLICT
    if skill already resolved with same version:
      dedupe, append requiredBy
    else:
      add skill
  for each nested package in entry.packages:
    resolve(nested)
  visiting.delete(id)
  visited.add(id)
```

- `visiting` 是当前 DFS 路径，用于环检测。
- `visited` 是全局已解析集合，用于去重。
- 多个根节点共享 `visited` 和 skill map；同一个 package 版本被多个根引用时只遍历一次。
- 同一个 skill 被多个 package 以同一版本引用：去重，只投影一次。
- 同一个 skill 被任何路径解析成不同版本：`SKILL_VERSION_CONFLICT`，拒绝。
- 允许同一个 package 名字的多个版本同时出现在图中；只要没有环、没有 skill 版本冲突。

### 2.3 错误信息

`PACKAGE_CYCLE` 必须包含完整路径，例如：

```text
Package cycle detected: frontend@1.0.0 -> base@2.0.0 -> frontend@1.0.0
```

`SKILL_VERSION_CONFLICT` 必须包含 skill 名、冲突版本、引用来源，例如：

```text
Skill "pdf" is required at 1.2.0 by frontend@1.0.0 and at 1.3.0 by docs@1.0.0.
```

## 3. 生命周期强制校验

“每一个 package 生命周期”指所有会改变或依赖 package 图的操作。以下操作必须先解析/校验，再写文件：

| 操作 | 校验内容 |
|---|---|
| `package create` | 新 package 版本的传递闭包：缺失引用、环、skill 版本冲突 |
| `package copy` | 复制并应用 override 后的传递闭包：缺失引用、环、skill 版本冲突 |
| `package tag` | 目标 package 版本的传递闭包 |
| `package remove` | 不能被 route 或其他 package 引用；删除后剩余 package 图仍可解析 |
| `route add` | 新 target 的全部 package 根：环、skill 版本冲突 |
| `route remove` | 剩余 target 的 package 根仍可解析（可选，但建议） |
| `apply` | 所有启用 target 的 package 根：环、skill 版本冲突、缺失 skill |
| `doctor` | 所有 package 版本、所有 target |
| `history rollback` | 恢复前校验三个文件；恢复后图必须可解析 |

- 校验失败时，不写入任何文件。
- 手工编辑 `package.json` 绕过工具时，`apply`、`doctor`、`route add` 仍然会发现环和冲突。
- package 版本配置哈希必须是**传递闭包哈希**：根 package 及其所有嵌套 package 版本的规范化 JSON 一起参与 SHA-256。这样任何嵌套 package 被手工修改都会让 route lock 失效。

## 4. Package 复制

### 4.1 目的

当同一个 target 中两个 package 需要同一个 skill 的不同版本时，不自动覆盖、不自动降级，而是让用户复制其中一个 package，修改复制版本的 skill 依赖，使版本对齐，再把 route 指向复制版本。

### 4.2 命令

```bash
skillink package copy <source-package>@<version> <target-package>@<version> \
  [--skill <skill>@<version>]... \
  [--package <package>@<version>]... \
  [--drop-skill <skill>]... \
  [--drop-package <package>]... \
  [--description <text>]
```

- `<source-package>@<version>` 必须存在。
- `<target-package>@<version>` 必须不存在；目标 package 可以和源同名（新版本）或不同名（fork）。
- 复制内容：源 package 版本的直接 `packages` / `skills` map；不深拷贝嵌套 package 的定义。
- `--skill`：新增或替换复制版本中的直接 skill 依赖。
- `--package`：新增或替换复制版本中的直接 package 依赖。
- `--drop-skill` / `--drop-package`：从复制版本中删除直接依赖。
- `--description`：目标 package 的展示描述；缺省继承源 package 的 description。
- 不复制 tags。
- 复制后执行传递闭包校验；有环或 skill 冲突则拒绝。
- 写入 package.json，并记录历史快照。

### 4.3 解决冲突的流程

直接冲突：

```text
frontend@1.0.0 -> pdf@1.2.0
docs@1.0.0     -> pdf@1.3.0
target 同时依赖 frontend@1.0.0 和 docs@1.0.0
=> SKILL_VERSION_CONFLICT

skillink package copy frontend@1.0.0 frontend@1.1.0 --skill pdf@1.3.0
skillink route add project-a frontend@1.1.0
skillink route add project-a docs@1.0.0
skillink apply
```

嵌套冲突：

```text
frontend@1.0.0 -> base@2.0.0 -> pdf@1.2.0
docs@1.0.0     -> pdf@1.3.0

skillink package copy base@2.0.0 base@2.1.0 --skill pdf@1.3.0
skillink package copy frontend@1.0.0 frontend@1.1.0 --package base@2.1.0
skillink route add project-a frontend@1.1.0
```

- 复制不会自动修改 route；用户必须显式把 route 指向新版本。
- 复制不会自动删除旧 package；旧版本可能仍被其他 target 使用。
- 如果复制后仍有冲突，错误信息继续列出冲突来源，用户可继续复制/调整。

## 5. Route 与解析的变化

- `route.json` 仍然只存 package lock，不展开 skill。
- `route add` 在写入前解析候选 target 的完整 package 图：
  - 新 package 引入环 -> 拒绝。
  - 新 package 与已有 package 产生 skill 版本冲突 -> 拒绝。
  - 同一 skill 同版本 -> 允许，apply 时去重。
- `route add` 计算根 package 的传递闭包哈希，写入 `integrity`。
- `apply` 重新计算传递闭包哈希并与 route lock 比较；不一致 -> `PACKAGE_INTEGRITY_MISMATCH`。

## 6. 错误码补充

| 错误码 | 场景 |
|---|---|
| `PACKAGE_CYCLE` | package 引用图存在环 |
| `SKILL_VERSION_CONFLICT` | 同一 skill 被解析成不同版本 |
| `PACKAGE_IN_USE` | 删除仍被 route 或其他 package 引用的 package 版本 |
| `PACKAGE_EMPTY` | package 版本没有任何 package/skill 依赖 |
| `PACKAGE_INTEGRITY_MISMATCH` | route 锁定的 package 传递闭包哈希与当前 package.json 不一致 |

现有 `PACKAGE_NOT_FOUND`、`VERSION_NOT_FOUND`、`VERSION_IN_USE` 继续使用。

## 7. 对实现任务的影响

新增/调整的实现单元：

1. `packages/core/src/package-graph.ts`
   - `resolvePackageGraph(packages, skills, roots)`
   - `computePackageIntegrity(packages, roots)`
   - `validateAllPackages(packages, skills)`
2. `packages/core/src/package-store.ts`
   - `readPackageFile` / `writePackageFile`
   - `createPackageVersion` / `tagPackageVersion` / `removePackageVersion`
   - `copyPackageVersion`
   - `resolvePackageVersion`（route 的 range/tag 解析）
3. `packages/core/src/route.ts`
   - `addRouteEntry` 改为 package 语义，并校验 target 图。
4. `packages/core/src/apply.ts` / `status.ts` / `doctor.ts` / `gc.ts`
   - 使用 `resolvePackageGraph` 展开 skill。
5. `packages/core/src/history.ts`
   - 三文件快照；恢复前校验 package 图。
6. CLI / GUI
   - 新增 `package copy`；package 创建/复制表单；route 分配 package。
7. 测试
   - 自环、两节点环、三节点环、同名不同版本、跨根冲突、重复 skill 去重、复制解决冲突、生命周期校验、传递闭包哈希。

## 8. GC 与删除的引用口径

- GC 保护集合 = 任一 route target（含 `enabled: false`）下所有 package lock 的传递闭包 + `skill.json` 中被 tag 指向的版本。
- 未被 route 引用的 package 版本不保护 skill；GC 后它们可能悬空，doctor 报 `PACKAGE_SKILL_MISSING`。
- `skill remove` 只拒绝“被 route 传递闭包引用”或“被 tag 保留”的版本；仅被未引用 package 引用时允许删除。
- `package remove` 拒绝被任一 route（含 disabled）或其他 package 版本引用的版本。
- 这样避免“只要 package.json 里还有任何旧配置，GC 就永远无法回收内容”的死锁，同时保证当前期望状态和 tag 永远可用。
