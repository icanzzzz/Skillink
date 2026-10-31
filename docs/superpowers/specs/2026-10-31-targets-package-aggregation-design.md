# 目标页聚合设计

## 意图

目标目录本身就是包的分配单位。当前“目标”页把“目标目录”和“包分配”拆成两个面板、两个表单，用户要在两处来回切换，也容易把两者理解成独立概念。本次把包分配并入目标目录：一个目标就是一行，它分配的包直接作为该目标的子项展示和操作。

## 目标

- “目标”页只保留一个“目标目录”面板，不再有独立的“包分配”面板。
- 每个目标行下直接列出它已分配的包：包名、已解析版本、启用状态，以及启用/禁用、移除操作。
- 每个目标行提供“分配包”入口，点击后在该目标下展开内联表单（包名 + 版本或标签），提交仍调用现有 `onRouteAdd`。
- 没有包的目标在行内显示“尚未分配包。”。
- 保留“添加目标”表单、清理/预览应用/应用按钮，以及应用报告。
- 删除独立的全局“分配包”表单（包括目标下拉和“没有目标”选项）。
- 同步更新英文、简体中文文案与 `TargetsView` 测试。

## 非目标

- 不修改 `route.json` 数据结构：包仍然嵌套在 `targets[].packages`。
- 不修改核心解析、应用、IPC、CLI 行为。
- 不修改总览页（Overview）的目标/包展示。
- 不实现 `copy` 模式。
- 不把包名/版本改成下拉选择；`TargetsView` 目前拿不到包清单，继续手填。

## 约束

- 保持现有 div-table 视觉语言和响应式断点，不引入新依赖。
- 新增英文文案必须同步提供简体中文翻译（`i18n.test.ts` 会检查完整覆盖）。
- 包分配仍复用现有 `onRouteAdd`、`onRouteEnable`、`onRemoveRoute` 回调，不改 `App.tsx` 的 IPC 调用。

## 方案

**选中：目标行内聚合。** 保留六列表格，目标行下缩进显示包子项；“分配包”按钮放在目标行操作区，点击后在当前目标下展开内联表单。改动集中在一个组件和样式，和技能、包页的表格语言一致。

**未选：每个目标一张卡片。** 包作为卡片内列表，视觉上更强调归属，但需要重写整页样式，且与现有列表页不一致，收益不足。

## 界面结构

```text
目标目录                                      [清理] [预览应用] [应用路由]
目标        路径        模式   包/技能   状态   操作
Project A   C:/...      link   2 包·5 技能  健康  [分配包] [禁用目标] [移除目标]
  └ frontend @1.0.0        已启用   [禁用包] [移除包]
  └ base @2.0.0            已禁用   [启用包] [移除包]
  （点击“分配包”后展开）
  [包名] [版本或标签]                    [分配] [取消]
```

没有包时，目标行下显示“尚未分配包。”。未添加目标时仍显示现有空状态，并在下方保留“添加目标”表单。

## 状态与交互

- 新增组件本地状态 `assigningTargetId`，同一时间最多展开一个目标的分配表单；再次点击“分配包”或点“取消”收起。
- 提交分配后清空输入并收起表单，由父级刷新 snapshot；错误仍走现有页面错误横幅。
- 包操作沿用 `onRouteEnable`、`onRemoveRoute`，目标操作沿用 `onTargetEnable`、`onRemoveTarget`，确认文案不变。
- 包按 `target.packages` 的插入顺序展示。

## 文案调整

- 保留并复用：`targets.form.assignPackage`（行内按钮/表单标题）、`targets.form.package`、`targets.form.versionOrTag`、`targets.form.assign`、`targets.packages.empty`。
- `targets.packages.empty` 文案改为“尚未分配包。” / “No packages assigned yet.”。
- 新增 `common.cancel`：“取消” / “Cancel”。
- 删除不再使用的键：`targets.packages.eyebrow`、`targets.packages.title`、`targets.form.routeEyebrow`、`targets.form.target`、`targets.form.noTargets`、`targets.table.package`、`targets.table.version`。
- 旧语言包里多出的键会被忽略，不影响加载。

## 验证

- 更新 `apps/desktop/src/renderer/src/TargetsView.test.tsx`：
  - 目标行内渲染包名、版本、启用状态和包操作。
  - 每个目标渲染“分配包”入口。
  - 不再出现“Package assignments”面板标题，也不再渲染目标下拉。
  - 空状态、计数、应用报告、翻译标题用例继续通过。
- 运行目标页测试、共享包 i18n 测试和桌面端类型检查/构建。
