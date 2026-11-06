# 控制面切换设计

> 日期：2026-11-06
> 状态：待实现
> 关联：`docs/plan.md` 第一项

## 1. 意图

让用户维护多个控制面，并在 GUI 中切换。控制面清单独立于任何控制面保存，CLI 与 GUI 共用同一份清单和同一个“当前控制面”。切换后 GUI 重新加载全部控制信息。

本设计同时取消隐式默认控制面：不再自动使用 `~/.agents/skillink`。当前控制面只能来自用户添加并选择的清单项，或显式的 `SKILLINK_HOME` 覆盖。

## 2. 目标

- 清单文件放在操作系统惯例的配置目录，不放在控制面内部。
- 清单记录已知控制面列表和当前控制面。
- CLI 启动时读取清单，所有命令使用同一个解析后的控制面。
- GUI 侧栏点击控制面打开选择弹窗，显示全部控制面。
- 弹窗支持通过文件夹选择器添加控制面。
- 点击清单项切换控制面，成功后重载 snapshot、runtime status、语言状态和页面级报告。
- 保持模块边界：shared 不读文件系统，desktop 主进程不 import core，GUI 业务操作全部走 CLI。

## 3. 非目标

- 不提供删除、重命名、编辑控制面的 UI 或命令。
- 不迁移旧版 `~/.agents/skillink`；用户需要手动添加。
- 不自动初始化新添加的文件夹（`control-plane add` 只创建/登记目录）。
- 不支持按窗口维护不同控制面。
- 不改变 `SKILLINK_HOME` 的最高优先级。
- 不把控制面清单放进控制面 git。
- 不随切换自动安装语言包；目标控制面缺少语言包时沿用现有英文回退。
- 本功能不修改安装包脚本对旧默认路径的语言包复制；打包侧清理另行处理。

## 4. 约束

- `SKILLINK_HOME` 存在时仍覆盖清单中的当前控制面。
- 取消默认控制面后，没有当前控制面时，需要控制面的命令返回明确错误，而不是静默回退。
- 清单写入使用现有原子 JSON 写入能力。
- Windows 路径比较大小写不敏感；macOS/Linux 按原样比较。
- 控制面路径支持 `~`、`%USERPROFILE%`、`$HOME`/`${HOME}` 展开，并规范化为绝对路径。

## 5. 方案

考虑过三种边界划分：

1. **shared 同步读取清单**
   - 优点：`getSkillinkPaths()` 可直接拿到当前控制面。
   - 缺点：shared 引入 `node:fs`，renderer 也会进入文件系统模块；shared 的纯数据边界被破坏。
2. **shared 纯路径/schema，core 负责读写，CLI 负责解析，桌面端只走 CLI（采用）**
   - 优点：边界清晰；CLI 和 GUI 行为一致；renderer 只接触 schema 和类型。
   - 缺点：CLI 启动时增加一次异步读取。
3. **桌面端维护清单并传给 CLI**
   - 缺点：CLI 独立运行时不跟随当前控制面，不满足需求。

采用方案 2。

## 6. 文件位置与格式

清单文件名：`control-planes.json`。

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%\Skillink\control-planes.json`；`APPDATA` 缺失时回退到 `%USERPROFILE%\AppData\Roaming\Skillink\control-planes.json` |
| macOS | `~/Library/Application Support/Skillink/control-planes.json` |
| Linux | `$XDG_CONFIG_HOME/skillink/control-planes.json`；缺失时 `~/.config/skillink/control-planes.json` |

格式：

```json
{
  "schemaVersion": 1,
  "active": "C:\\Users\\me\\.agents\\skillink",
  "controlPlanes": [
    "C:\\Users\\me\\.agents\\skillink",
    "D:\\skillink\\work"
  ]
}
```

- `active` 可为 `null`。
- `controlPlanes` 只保存用户添加过的路径，不隐式包含默认路径。
- 清单文件不存在时视为 `{ schemaVersion: 1, active: null, controlPlanes: [] }`。
- 文件使用现有 `readJsonFile` / `writeJsonAtomic`，schema 校验失败时返回 `IO_ERROR`（包含文件路径）。

## 7. 当前控制面解析

CLI 每次启动时解析一次，并在整个命令生命周期内固定：

```text
CliContext.home（测试/程序化覆盖）
  > SKILLINK_HOME
  > 清单 active
  > 无当前控制面
```

- `CliContext.home` 保留为最高优先级的程序化覆盖；桌面端不使用它，桌面端仍完全依赖 CLI 解析。
- `SKILLINK_HOME` 仍由 shared 的路径展开工具处理。
- 没有当前控制面时，`CommandRuntime.paths()` 抛出 `CONTROL_PLANE_REQUIRED`，错误信息提示：
  - `skillink control-plane add <path>`
  - 或设置 `SKILLINK_HOME`
- `control-plane list/add/use`、`env` 等不依赖当前控制面的命令仍可运行。
- 移除 shared 的隐式默认：`getSkillinkPaths(home)` 的 `home` 改为必填；core 中可选 `home/paths` 的入口在没有 home 时抛出 `CONTROL_PLANE_REQUIRED`。
- 测试隔离：CLI 测试继续用 `CliContext.home` 覆盖常规命令；控制面清单测试通过 `APPDATA` / `XDG_CONFIG_HOME` 指向临时目录，不写真实用户配置。

## 8. CLI 命令

```text
skillink control-plane list [--json]
skillink control-plane add <path> [--json]
skillink control-plane use <path> [--json]
```

### list

返回：

```json
{
  "active": "D:\\skillink\\work",
  "activeSource": "registry",
  "controlPlanes": ["D:\\skillink\\work", "C:\\Users\\me\\.agents\\skillink"]
}
```

- `activeSource`：`env`、`registry` 或 `null`。
- `active` 是解析后的实际当前控制面；`SKILLINK_HOME` 存在时优先显示它。
- 清单为空且没有覆盖时返回 `{ active: null, activeSource: null, controlPlanes: [] }`。

### add

- 展开并规范化路径。
- 路径不存在时创建目录；路径存在但不是目录时抛 `CONTROL_PLANE_NOT_FOUND`。
- 允许任意普通绝对目录，包括文件系统根目录。
- 去重：Windows 使用小写路径比较，其他平台原样比较。
- 不清除已有 `active`。
- 如果当前没有 `active`，第一个添加的控制面自动成为当前控制面。
- 不初始化目录内容（不创建配置、不初始化 git）。
- 返回与 `list` 相同的结果。

### use

- 展开并规范化路径。
- 路径必须已在 `controlPlanes` 中；否则 `CONTROL_PLANE_NOT_FOUND`，提示先 `add`。
- 设置 `active` 并返回与 `list` 相同的结果。
- 不检查目录是否仍存在；切换时由 GUI 的 snapshot 调用暴露真实错误。
- `SKILLINK_HOME` 存在时命令仍写入 registry，但实际 `active` 仍显示 env 路径。

### init 与首次使用

- `init` 成功后把 `paths.home` 登记进清单；若清单没有 `active`，同时设为当前控制面。
- 首次使用流程：
  - 有现成控制面：`control-plane add <folder>` 后再选择/使用。
  - 新建控制面：`control-plane add <folder>` 会创建目录并设为当前，然后 `init` 初始化配置与 git。
  - 使用 `SKILLINK_HOME`：`init` 仍可工作，成功后登记该路径。
- GUI 空状态只提供“添加控制面”；添加已有控制面即可读取数据，空目录下的写命令会按现有逻辑自动创建配置。

## 9. 模块划分

```text
packages/shared/src/
├─ control-plane.ts          # schema、类型、清单路径、路径规范化、去重 key
└─ paths.ts                  # getSkillinkPaths(home) 必填；SKILLINK_HOME 展开
packages/core/src/
├─ control-plane-store.ts    # 读写清单、list/add/use、resolveControlPlaneHome
└─ index.ts                  # 导出控制面 API
apps/cli/src/
├─ run.ts                    # 启动时解析当前控制面，传给 runtime
├─ command-runtime.ts        # paths() 在无当前控制面时抛错
└─ commands/control-plane.ts # list/add/use 命令
apps/desktop/src/
├─ main/cli-commands.ts      # 构造 control-plane argv
├─ main/ipc.ts               # IPC 校验并调用 CLI
├─ main/index.ts             # 启动语言包同步时通过 CLI 获取 active
├─ preload/index.ts          # 暴露 API
├─ shared.ts                 # DesktopApi 类型
├─ ipc-schemas.ts            # add/use 请求 schema
└─ renderer/src/
   ├─ ControlPlaneDialog.tsx # 列表、添加、切换、错误
   ├─ App.tsx                # 入口、空状态、切换后重载
   └─ i18n.tsx               # 提供 refreshLanguage()
```

边界规则：

- `shared/control-plane.ts` 只依赖 `node:path`、zod 和 shared 内的路径展开工具，不依赖 `node:fs`。
- `core/control-plane-store.ts` 是唯一直接读写清单的模块。
- desktop 主进程只通过 CLI 适配器调用 `control-plane ... --json`；不 import `@skillink/core`。
- renderer 不接触 Node、Electron、core；只使用 preload API、shared 类型和消息键。

## 10. GUI 行为

### 侧栏入口

- 当前静态 `.sidebar-foot` 改为按钮。
- 显示“控制面”标签，以及当前路径或“未选择”。
- 点击打开选择弹窗。

### 选择弹窗

- 标题：“控制面”；说明文字提示选择或添加控制面。
- 列表显示所有 `controlPlanes`，每项显示路径；当前项显示当前徽标。
- 点击非当前项立即调用 `control-plane use <path>`。
- 底部“添加控制面”调用现有文件夹选择器，然后调用 `control-plane add <path>`；成功后刷新列表。
- 添加不强制切换；若之前没有当前控制面，CLI 会自动激活第一个添加项。
- 错误显示在弹窗内，不清空已有列表。
- 关闭按钮 + Escape + 点击遮罩关闭，复用现有 `Modal`。
- `activeSource === 'env'` 时显示 `controlPlane.envOverride` 提示，并禁用添加和切换按钮，避免命令成功但界面不变化。

### 无当前控制面

- 应用启动先调用 `control-plane list`。
- `active` 为空时不调用 `snapshot`，显示空状态面板：说明尚未选择控制面，并提供“添加控制面”按钮。
- 语言状态加载失败保持英文回退，不阻塞控制面添加。

### 切换后重载

切换成功（或添加导致 active 变化）后依次：

1. `control-plane list` 获取最新清单和 active。
2. `snapshot` 重新加载 skills、packages、route、status、doctor、targetSkills。
3. `env` 重新检测 git。
4. 重新读取语言状态，使新控制面的 `settings.json` 和 `locales/` 立即生效。
5. 清空 `gcReport`、`applyReport` 和页面加载错误。

## 11. 错误与国际化

新增错误码：

- `CONTROL_PLANE_REQUIRED`：没有当前控制面，且命令需要它。
- `CONTROL_PLANE_NOT_FOUND`：添加的目录不存在，或切换的路径不在清单中。

新增消息键（英文权威、中文语言包同步）：

- `controlPlane.title`
- `controlPlane.eyebrow`
- `controlPlane.hint`
- `controlPlane.add`
- `controlPlane.addHint`
- `controlPlane.empty`
- `controlPlane.current`
- `controlPlane.switch`
- `controlPlane.notSelected`
- `controlPlane.envOverride`
- `controlPlane.error`
- `controlPlane.noActive.title`
- `controlPlane.noActive.body`
- `toast.controlPlane.added`
- `toast.controlPlane.switched`
- `errors.CONTROL_PLANE_REQUIRED`
- `errors.CONTROL_PLANE_NOT_FOUND`

## 12. 测试

### shared

- 三种平台的清单路径。
- `APPDATA` / `XDG_CONFIG_HOME` 缺失时的回退。
- schema 接受空 active 和空列表。
- 路径展开、绝对化和 Windows 去重 key。

### core

- 清单不存在时 list 返回空、active 为 null。
- add 首个控制面自动激活；后续 add 不改变 active。
- add 去重（Windows 大小写）。
- add 会创建不存在的目录；路径是文件时抛 `CONTROL_PLANE_NOT_FOUND`。
- use 已知路径设置 active；未知路径报错。
- `CliContext.home` 与 `SKILLINK_HOME` 均覆盖清单 active，且前者优先。
- `resolveControlPlaneHome` 无覆盖且清单空时返回 null。
- `init` 成功后登记并激活控制面。
- 原子写后可重新读取。

### CLI

- `control-plane list/add/use --json` 输出。
- add 首个后，下一次 `snapshot --json` 使用该控制面。
- use 切换后，下一次命令使用新的 home。
- 无当前控制面时 `snapshot` 返回 `CONTROL_PLANE_REQUIRED`。
- `SKILLINK_HOME` 优先于清单。
- 测试通过临时配置目录隔离，不写真实用户配置。

### desktop/GUI

- IPC builder 生成正确的 argv。
- 弹窗加载列表、添加、切换、错误展示。
- 无当前控制面时显示空状态而不是错误横幅。
- 切换后触发 snapshot 和语言刷新。
- App 测试使用注入的 `DesktopApi`，不依赖真实 Electron。

## 13. 文档

- 更新 `README.md`：控制面不再有默认路径；新增清单文件和 `control-plane` 命令；说明 `SKILLINK_HOME` 仍优先。
- 更新 `ARCHITECTURE.md`：数据位置、CLI 解析顺序、GUI 只走 CLI、模块边界。
- 更新 `docs/plan.md`：完成后移除控制面切换条目。

## 14. 未决项（由实现者决定）

- 清单项是否需要展示友好名称：本版直接展示路径。
- 是否需要删除控制面：本版不提供。
- 是否需要为损坏清单提供自动备份：本版依赖原子写和明确错误。
