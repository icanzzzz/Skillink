# GUI 交互现代化设计

> 日期：2026-11-13
> 状态：待实现
> 关联：`docs/plan.md` 第 1、3、4 项

## 1. 意图

桌面端当前的操作路径与 CLI 同构：凡是引用已有实体的地方（包依赖、目标到包的路由、标签、目标 id）都要求用户凭记忆手写 `name@version`。这抹掉了 GUI 相对 CLI 的唯一优势——把可选项摆到眼前。

本设计把 renderer 的交互模型从「凭记忆输入」改为「从快照派生选择器 + 可见默认值」，并按职责重新切分 renderer 模块。CLI、core、IPC 契约不变。

## 2. 现状与证据

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| `apps/desktop/src/renderer/src/PackagesView.tsx:42-58` | `parseDependencies` 按行解析 `name@version`，解析失败的行 `continue` | 手滑一个字符，依赖静默消失，没有任何反馈 |
| `apps/desktop/src/renderer/src/PackagesView.tsx:176、185` | 技能与嵌套包各是一个 `textarea` | 组合一个包需要用户先知道库里有谁 |
| `apps/desktop/src/renderer/src/PackagesView.tsx:194` | 可用技能渲染成不可点击的 `<code>{skillVersions.join(', ')}</code>` | 数据就在手上，却不能操作，只能复制粘贴 |
| `apps/desktop/src/renderer/src/TargetsView.tsx:553-601` | 分配包是内联表单，包名 + 「版本或标签」两个空输入框，placeholder「必填」 | 用户必须记住包名与版本号 |
| `apps/desktop/src/renderer/src/SkillsView.tsx:92-93` | `SkillBatchItem.name` 初始为空，扫描到的名称只存进 `autoName` | 用户看不到自己将要安装成什么名字 |
| `apps/desktop/src/renderer/src/SkillsView.tsx:146` | 名称输入框 placeholder 是 `autoName` | 默认值藏在 placeholder 里，值本身不可见 |
| `apps/desktop/src/renderer/src/SkillsView.tsx:481-482` | 安装成功后把名称重新清空、写回 `autoName` | 后续同一文件夹的安装又回到不可见状态 |
| `apps/desktop/src/renderer/src/PackagesView.tsx:325`、`SkillsView.tsx` 版本行 | 每个版本都有一个空标签输入框 + 「标记」按钮 | 已有标签不可见，只能手打 |

规模：`PackagesView.tsx` 418 行 = 页面 + 对话框 + 解析器；`SkillsView.tsx` 735 行 = 页面 + 导入对话框 + 两张卡片；`TargetsView.tsx` 654 行 = 页面 + 添加目标 + 内联分配表单。

根因不在某个对话框，而是三条贯穿全局的缺失：

1. **没有选项派生层**：快照里已有全部技能、包、版本、标签，却没有任何代码把它变成可选项。
2. **默认值藏在 placeholder 里**：值不可见、不可确认，空提交是否正确取决于用户读没读 placeholder。
3. **校验与展示混在视图里**：没有纯函数草稿模型，规则只能散落在 JSX 里。

## 3. 目标

- 所有引用已有实体的字段改为选择器；只有「新建」语义才出现文本输入，且用显式模式区分。
- 能从快照或上下文推导的默认值直接写进值（扫描到的技能名、下一个补丁版本、派生 target id），并保持可编辑。
- 技能导入支持拖拽文件夹与系统文件夹选择器，路径文本输入降级为折叠的兜底入口。
- 标签从「空输入框」变为「已有标签一键指向当前版本 + 新建标签」。
- renderer 按领域分目录，新增 `ui/` 展示原语与根级 `library.ts` 派生层；三个视图文件回到「页面装配」职责。
- 不新增 IPC 通道，不改 CLI，不改 core。

## 4. 非目标

- 不改 CLI 命令面、参数与输出格式；不为 GUI 增加 CLI 子命令。
- 不改 `@skillink/core` 的校验规则与错误码；不复制其规则到 renderer。
- 不改 `apps/desktop/src/ipc-schemas.ts` 的任何请求 schema。
- 不做虚拟滚动或大列表性能优化。
- 不改主进程窗口、菜单、打包配置。
- 不做包依赖图可视化；分配弹窗只显示「直接包含 N 个技能」，不解析传递闭包。
- 不新增 npm 依赖。

## 5. 边界裁定

| 职责 | 归属 | 依据 |
| --- | --- | --- |
| 域校验：semver 合法性、名称字符集、包自引用与循环、技能版本冲突、tag/range 解析 | `@skillink/core` | 已有唯一实现；renderer 只展示 core 返回的错误文本，绝不复刻规则 |
| 版本排序与「下一个补丁版本」建议 | `packages/shared/src/version-order.ts`（新增） | shared 已依赖 `semver`；core 与 renderer 必须共用同一套 semver 语义。放 renderer 就要给 desktop 新增 semver 依赖并复制一份解析逻辑 |
| 快照 → 可选项（技能/包、版本、标签、默认版本、版本选项标签） | `apps/desktop/src/renderer/src/library.ts`（新增） | 跨领域派生，packages 与 targets 都要用 |
| 草稿状态与「草稿 → IPC 请求」映射 | 各领域 `*-draft.ts`（纯函数） | 沿 `targetAssignment.ts` 既有先例：纯逻辑独立成文件并单独测试 |
| 展示原语（复选列表、版本下拉、标签编辑器） | `apps/desktop/src/renderer/src/ui/`（新增） | 不含业务知识，输入输出都是字符串 |
| 业务写入 | `App.tsx` 既有薄封装 → `DesktopApi` | 写入路径不新增，避免绕过 CLI |

新增依赖：无。preload 只新增一个非 IPC 通道的能力 `getPathForFile`（Electron `webUtils`，沙箱 preload 可用的官方模块）。

## 6. 交互设计

### 6.1 创建 / 复制包

`CreatePackageDialog`（`size="lg"`）自上而下四段：

1. **包身份**：分段单选「已有包 / 新建包」。
   - 已有包：`<select>` 列出全部包名（按名称排序），选中即把该包的描述、依赖、已有版本显示出来。
   - 新建包：名称文本输入。
   - 两种模式互斥，切换时保留当前依赖复选框状态。
2. **版本**：文本输入，打开时预填「建议的下一个补丁版本」；下方用 `.field-note` 列出该包已存在版本；若与已有版本重复，实时显示 `.field-error`「版本 {version} 已存在」并禁用提交（这只是本地查表，不替代 core 校验）。
3. **技能**：搜索框 + 复选列表（`ChoiceList`）。勾选后该行内展开版本 `<select>`（只列精确版本，不含标签）。列表项显示名称、描述、`N versions`。
4. **嵌套包**：同上，仅当包名已确定时禁用与自身同名的项，并标注「不能嵌套包自身」。
5. **底部**：左侧 `.selection-summary`，显示「已选 N 项」与「X 个技能 · Y 个包」；右侧取消 / 创建。

提交按钮禁用条件：名称为空、版本为空、版本重复、技能与嵌套包同时为空。

复制流程：点某个包版本的「复制」→ 打开同一对话框（已有包模式、依赖与描述预填、版本预填该包的建议下一个补丁版本），顶部一条 `.hint` 说明「已从 {spec} 复制，请选择新版本并调整依赖」。

### 6.2 分配包到目标

内联表单移除，改为 `AssignPackageDialog`，从目标卡片的「分配包」按钮打开：

1. **包**：`<select>` 列出全部包；已被该目标分配的包标注「已分配」并禁用。
2. **版本或标签**：`<select>`，选项分两类——标签（显示 `latest → 1.2.0`）在前，精确版本在后。默认选中最高精确版本。
3. **预览**：`.assign-preview` 显示「直接包含 {count} 个技能」（`Object.keys(version.skills).length`，不解析传递闭包，标签里写明「直接」）。
4. 确认后调用既有 `routeAdd`。

包库为空时，弹窗内显示 `.empty`「没有可分配的包，请先创建包。」并禁用确认。

### 6.3 标签

`TagEditor` 同时用于包版本行与技能版本行，替换原来的空输入框：

- 已有标签渲染为标签 chips。指向**其它**版本的标签是按钮，点击即把该标签指向当前版本（`package tag` / `skill tag` 的既有语义）。
- 指向**当前**版本的标签渲染为 `.tag.is-active`，附「当前」文字，不可点击。
- 末尾有「新建标签」按钮，点开展开输入框 + 确认；空名禁用确认。
- 标签名合法性、重名覆盖行为交给 core，renderer 不预判。

### 6.4 导入技能

`SkillImportDialog`：

1. 主体是一个 **拖放区**（`.drop-zone`）：「把文件夹拖到这里」+ 主按钮「选择文件夹」。点按钮走既有 `chooseFolder` IPC，选中即扫描（保持现有行为，不再需要单独点「扫描」）。
2. 路径文本输入降级为 `<details>` 折叠的「手动输入路径」，展开后保留「扫描文件夹」按钮。
3. 扫描结果卡片：
   - 名称**预填为值**（扫描到的名称），可编辑，不再是 placeholder。
   - 版本预填主版本（去 `+hash`）。
   - 若库中已存在同名同版本，卡片显示 `.field-note`「已安装同版本」，安装按钮仍可用（core 会返回 present 结果，保持幂等语义）。
   - 目录链接（directory link）状态与文案保持不变。
4. 卡片上方 `.install-summary`：可安装数量 + 主按钮「全部安装」（串行确认，逐张卡片更新状态；已安装/已阻止的卡片跳过）。
5. 安装成功后不再清空名称。

拖放实现：`dataTransfer.files[0]` 经 `window.skillink.getPathForFile(file)` 转成绝对路径（Electron `webUtils`，必须经 preload 暴露），再走既有 `scanSkills` IPC。拖放只负责取路径，不新增业务通道。

### 6.5 添加目标

`AddTargetDialog`：选定路径后，若用户尚未手动编辑 target id，则把 `deriveTargetIdDefault({path,label})` 的结果**写入输入框的值**（可编辑）；用户一旦编辑过，就不再覆盖。label 保持「可选」placeholder。

## 7. 文件结构

```
apps/desktop/src/renderer/src/
├── library.ts                      快照 → 技能/包选项、版本选项、默认版本
├── library.test.ts
├── ui/
│   ├── ChoiceList.tsx              搜索 + 复选列表（含禁用原因）
│   ├── ChoiceList.test.tsx
│   ├── VersionSelect.tsx           版本/标签下拉（单一 label 字段）
│   ├── VersionSelect.test.tsx
│   ├── TagEditor.tsx               已有标签 chips + 新建
│   └── TagEditor.test.tsx
├── packages/
│   ├── PackagesView.tsx            页面装配 + 列表
│   ├── CreatePackageDialog.tsx
│   ├── PackageCard.tsx             单个包 + 版本标签页 + TagEditor
│   ├── package-draft.ts
│   ├── package-draft.test.ts
│   └── CreatePackageDialog.test.tsx
├── skills/
│   ├── SkillsView.tsx
│   ├── SkillImportDialog.tsx
│   ├── SkillBatchCard.tsx
│   ├── InstalledSkillCard.tsx
│   ├── skill-batch.ts
│   └── skill-batch.test.ts
└── targets/
    ├── TargetsView.tsx
    ├── AddTargetDialog.tsx
    ├── TargetCard.tsx
    ├── AssignPackageDialog.tsx
    ├── route-draft.ts
    └── route-draft.test.ts
```

删除：根目录 `PackagesView.tsx`、`SkillsView.tsx`、`TargetsView.tsx`、`targetAssignment.ts`、`targetAssignment.test.ts` 及其对应测试。

## 8. 文案

新增文案必须同时改 `packages/shared/src/i18n-en.ts` 与 `locales/zh-CN.json`；`packages/shared/src/i18n.test.ts` 要求每个英文键在中文包里存在。

新增键（英文 / 简体中文）：

| key | en | zh-CN |
| --- | --- | --- |
| `common.search` | Search | 搜索 |
| `packages.form.modeExisting` | Existing package | 已有包 |
| `packages.form.modeNew` | New package | 新建包 |
| `packages.form.nameSelect` | Package | 包名 |
| `packages.form.noExistingPackages` | No packages yet. Create one below. | 还没有包，可在下方新建。 |
| `packages.form.pickSkills` | Skills in this package | 包内技能 |
| `packages.form.pickPackages` | Nested packages | 嵌套包 |
| `packages.form.searchSkills` | Search skills | 搜索技能 |
| `packages.form.searchPackages` | Search packages | 搜索包 |
| `packages.form.noSkills` | No skills installed yet. | 还没有已安装的技能。 |
| `packages.form.noNestedPackages` | No other packages yet. | 还没有其他包。 |
| `packages.form.selectedCount` | {count} selected | 已选 {count} 项 |
| `packages.form.summaryCounts` | {skills} skills · {packages} packages | {skills} 个技能 · {packages} 个包 |
| `packages.form.versionTaken` | Version {version} already exists | 版本 {version} 已存在 |
| `packages.form.existingVersions` | Existing: {versions} | 已存在：{versions} |
| `packages.form.copyNotice` | Copied from {spec}. Pick a new version and adjust dependencies. | 已从 {spec} 复制，请选择新版本并调整依赖。 |
| `packages.form.selfReference` | Cannot nest the package itself | 不能嵌套包自身 |
| `packages.tag.label` | Tags | 标签 |
| `packages.tag.new` | New tag | 新建标签 |
| `packages.tag.name` | Tag name | 标签名 |
| `packages.tag.current` | current | 当前 |
| `targets.assign.eyebrow` | ASSIGN | 分配 |
| `targets.assign.heading` | Assign package | 分配包 |
| `targets.assign.empty` | No packages to assign. Create a package first. | 没有可分配的包，请先创建包。 |
| `targets.assign.alreadyAssigned` | already assigned | 已分配 |
| `targets.assign.directSkills` | {count} skills directly | 直接包含 {count} 个技能 |
| `skills.import.chooseFolder` | Choose folder | 选择文件夹 |
| `skills.import.dropHint` | Drop a folder here | 把文件夹拖到这里 |
| `skills.import.dropActive` | Release to scan | 松开以扫描 |
| `skills.import.manualPath` | Enter path manually | 手动输入路径 |
| `skills.import.installAll` | Install all | 全部安装 |
| `skills.batch.alreadyInstalled` | Already installed | 已安装同版本 |

删除键（新界面不再使用）：`packages.form.skills`、`packages.form.packages`、`packages.availableSkills`。

既有键 `packages.form.name`、`packages.form.version`、`packages.form.description`、`targets.form.package`、`targets.form.versionOrTag`、`skills.form.name`、`skills.form.scan`、`skills.tagAriaLabel`、`packages.tagAriaLabel` 保留复用。

## 9. 文档修订

`ARCHITECTURE.md` 的 GUI 约定一节（§7.2）需就地改写，保持文档语言与列表风格：

- 用「默认值可见」替换原「placeholder 约定」：能从快照或上下文推导的默认值必须写入表单值并保持可编辑，不得让 placeholder 承担默认值职责；确实没有默认值的字段 placeholder 用「必填 / 可选」，不使用示例值。
- 新增「选择优先」：引用已有实体（技能、包、版本、标签、目标）的字段一律从快照派生选择器，不得要求用户手写 `name@version`；只有「新建」语义才出现文本输入，并用显式模式切换。
- 新增「拖拽与选择器」：文件夹类输入支持拖拽与系统选择器，文本路径是折叠的兜底入口。
- 新增「renderer 目录」：按领域分组（`packages/`、`skills/`、`targets/`），跨领域展示原语放 `ui/`，跨领域派生逻辑放根目录 `library.ts`。
- 原文中「安装卡片把扫描名称保存为 autoName，名称输入框留空」的表述改为「扫描名称直接预填到名称输入框（可编辑），安装使用可见值」。
- 若存在 renderer 文件清单/模块表，补上新增文件与删除文件。

## 10. 测试策略

- 纯函数模块：`library`、`package-draft`、`route-draft`、`skill-batch`、`version-order` 全部单元测试，覆盖默认值、排序、禁用、草稿 → 请求映射。
- 组件：沿用 `renderToStaticMarkup` + `i18n.test-utils.tsx`，不做 DOM 交互模拟。断言渲染结构的形状：选择器存在、依赖区无 `textarea`、已选项带 `checked`、禁用态带 `disabled`。
- 不引入 jsdom / testing-library。
- `packages/core/src/module-boundaries.test.ts` 必须继续通过：新增 renderer 文件不得 import `node:*`、`electron`、`@skillink/core`，也不得相对引用 `apps/desktop/src/main`、`apps/desktop/src/preload`。
- 收口：`pnpm typecheck`、`pnpm test` 全绿。

## 11. 风险

| 风险 | 处理 |
| --- | --- |
| 文件移动导致 `App.tsx` 与旧测试引用断裂 | 新文件先落到子目录且不改 `App.tsx`，由收口任务统一切换并删除旧文件 |
| 三个领域任务并行改同一个共享文件 | `styles.css`、`i18n-en.ts`、`zh-CN.json`、`ARCHITECTURE.md`、`App.tsx`、`shared.ts`、`preload/index.ts` 各只由一个任务拥有 |
| 低思考代理顺手扩大改动 | 每个任务列出「允许修改的文件」清单，其余文件只读 |
| i18n 两份目录不同步 | 同一任务内同时改两份，并由 `i18n.test.ts` 兜底 |
| 拖放在 preload 沙箱下不可用 | 使用官方 `webUtils.getPathForFile`；若取不到路径则退回折叠的路径输入，不阻塞安装 |

## 12. 交付顺序

1. 共享版本工具 + `library.ts`（纯逻辑，无 UI 依赖）
2. `ui/` 三个原语（并行）
3. i18n 文案 + CSS + `ARCHITECTURE.md`（并行）
4. `packages/`、`skills/`、`targets/` 三个领域改造（并行）
5. 收口：切换 `App.tsx` 引用、删除旧文件、删三处死键、`pnpm typecheck` + `pnpm test`
