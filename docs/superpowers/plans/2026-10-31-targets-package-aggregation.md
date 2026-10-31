# 目标页聚合包分配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“目标目录”和“包分配”合并成一个目标模块，包直接显示在所属目标行下，并通过目标行内的分配表单添加。

**Architecture:** 只改桌面渲染层。`TargetsView` 保留现有目标和包相关的 props/回调，在组件内部新增 `assigningTargetId` 状态控制行内分配表单；包子项复用 `onRouteEnable` / `onRemoveRoute`。`route.json`、核心逻辑、IPC 和 CLI 均不变。

**Tech Stack:** React 19、TypeScript、Vitest、react-dom/server 静态渲染测试、Electron renderer CSS。

**Spec:** `docs/superpowers/specs/2026-10-31-targets-package-aggregation-design.md`

## Global Constraints

- 不修改 `route.json` 数据结构、核心解析/应用逻辑、IPC、CLI 和总览页。
- `TargetsView` 的公开 props 和回调签名保持不变。
- 包名和版本继续手填（组件拿不到包清单）。
- 所有新增英文文案必须同步提供简体中文翻译（`packages/shared/src/i18n.test.ts` 校验完整覆盖）。
- 不引入新依赖；沿用现有 div-table 视觉语言和 1020px 响应式断点。
- 每次修改 `locales/zh-CN.json` 时把 `version` 从 `1.0.3` 提升到 `1.0.4`。

## Review Focus

- 没有任何包的目标：必须显示“尚未分配包。”，同时仍能打开分配表单。由 Task 1 的 `packages: {}` 目标测试覆盖。
- 多个目标：每个目标各自有一个“分配包”入口，不能残留全局目标下拉。由 Task 1 的双目标计数测试和 `No targets` 否定断言覆盖。
- 被禁用的包：必须显示“启用路由”和“移除路由”，不能从列表中消失。由 Task 1 的 disabled lock 测试覆盖。
- 空目标列表：空状态、“添加目标”表单和禁用的 copy 模式选项必须保留。由现有空状态测试覆盖。
- 删除旧文案键后仍有引用：`MessageKey` 类型检查和 i18n 完整覆盖测试必须通过。由 Task 2 的 typecheck 与 i18n 测试覆盖。

---

### Task 1: 把包分配并入目标行

**Files:**
- Modify: `apps/desktop/src/renderer/src/TargetsView.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `apps/desktop/src/renderer/src/TargetsView.test.tsx`
- Modify: `packages/shared/src/i18n-en.ts`
- Modify: `locales/zh-CN.json`

**Interfaces:**
- Consumes: `TargetsViewProps`（不变），其中 `targets: TargetRoute[]`、`onRouteAdd?: (input: RouteAddFormInput) => void`、`onRouteEnable?: (input: RouteEnableFormInput) => void`、`onRemoveRoute?: (input: RouteRemoveFormInput) => void`；`RouteAddFormInput` 为 `{ targetId: string; name: string; requested: string }`；`TargetRoute.packages` 为 `Record<string, PackageLock>`，`PackageLock.enabled` 可为 `undefined`（视为启用）。
- Produces: 继续导出 `TargetsView` 和现有 `TargetsViewProps`；不新增公开 API。组件内部新增 `assigningTargetId: string | null`。

- [ ] **Step 1: 写失败测试**

在 `apps/desktop/src/renderer/src/TargetsView.test.tsx` 的 `target` fixture 后加入第二个目标 fixture：

```tsx
const secondTarget: TargetRoute = {
  id: 'project-b',
  label: 'Project B',
  path: 'C:/Projects/ProjectB/skills',
  mode: 'link',
  enabled: true,
  packages: {},
};
```

在 `describe('TargetsView', ...)` 中加入：

```tsx
it('renders packages inside their target and one assign action per target', () => {
  const html = renderToStaticMarkup(
    <TargetsView targets={[target, secondTarget]} />,
  );

  expect(html).toContain('frontend');
  expect(html).toContain('No packages assigned yet.');
  expect(html.match(/Assign package/g)).toHaveLength(2);
  expect(html).not.toContain('Package assignments');
  expect(html).not.toContain('No targets');
});

it('keeps disabled packages manageable from the target row', () => {
  const disabledTarget: TargetRoute = {
    ...target,
    packages: {
      frontend: {
        requested: '1.0.0',
        resolved: '1.0.0',
        integrity: 'sha256-abc',
        enabled: false,
      },
    },
  };
  const html = renderToStaticMarkup(
    <TargetsView
      targets={[disabledTarget]}
      onRouteEnable={() => {}}
      onRemoveRoute={() => {}}
    />,
  );

  expect(html).toContain('Enable route');
  expect(html).toContain('Remove route');
});
```

在现有 `renders lifecycle controls and apply reports` 用例中补充：

```tsx
expect(html).toContain('Assign package');
expect(html).not.toContain('Package assignments');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/TargetsView.test.tsx`

Expected: FAIL。`No packages assigned yet.` 不存在，`Assign package` 出现次数不是 2，且页面仍包含 `Package assignments`。

- [ ] **Step 3: 更新中英文文案**

`packages/shared/src/i18n-en.ts`：

- `targets.packages.empty` 改为 `'No packages assigned yet.'`
- 在 `common.browse` 后加入 `'common.cancel': 'Cancel',`
- 暂不删除旧键，等 Task 2 清理。

`locales/zh-CN.json`：

- `version` 改为 `"1.0.4"`
- `targets.packages.empty` 改为 `"尚未分配包。"`
- 在 `common.browse` 后加入 `"common.cancel": "取消",`

- [ ] **Step 4: 实现聚合界面**

`apps/desktop/src/renderer/src/TargetsView.tsx`：

- 删除 `routeTarget` 状态和顶部 `const assignments = targets.flatMap(...)`。
- 新增状态：

```tsx
const [assigningTargetId, setAssigningTargetId] = useState<string | null>(null);
const [routeName, setRouteName] = useState('');
const [routeVersion, setRouteVersion] = useState('');
```

- 新增两个本地函数：`beginAssignment(targetId)` 切换 `assigningTargetId` 并清空输入；`submitRoute(event, targetId)` 校验包名和版本后调用 `onRouteAdd({ targetId, name: routeName.trim(), requested: routeVersion.trim() })`，然后清空输入并收起表单。
- 目标列表改为每个目标一个 `.target-block`，内部依次是：
  - 原有六列 `.table-row`；操作区最前面加“分配包”按钮（`t('targets.form.assignPackage')`），点击调用 `beginAssignment(target.id)`。
  - `.target-packages` 子列表：遍历 `Object.entries(target.packages)`，每行显示 `<code>{name}</code>`、`@{lock.resolved}`、启用/禁用状态，以及沿用现有回调的启用/禁用和移除按钮。空列表渲染 `t('targets.packages.empty')`。
  - 当 `assigningTargetId === target.id` 时渲染 `.target-package-form.form-grid`：包名输入、版本/标签输入、`t('targets.form.assign')` 提交按钮、`t('common.cancel')` 取消按钮；表单提交调用 `submitRoute(event, target.id)`。
- 删除整个独立的“包分配” `<section className="panel">`（标题 `targets.packages.title` 那张表）。
- 删除 `.split` 包装和全局“分配包”表单，只保留“添加目标”面板；添加目标表单字段和行为不变。
- 保留清理/预览/应用按钮和 `applyReport` 面板。

包行 JSX 结构：

```tsx
<div className="target-packages">
  {packageEntries.length === 0 ? (
    <p className="target-package-empty">{t('targets.packages.empty')}</p>
  ) : (
    packageEntries.map(([name, lock]) => (
      <div className="target-package-row" key={name}>
        <span>
          <code>{name}</code> <small>@{lock.resolved}</small>
        </span>
        <span>
          {lock.enabled === false
            ? t('status.disabled')
            : t('status.enabled')}
        </span>
        <span className="row-actions">{/* 沿用现有启用/移除按钮 */}</span>
      </div>
    ))
  )}
</div>
```

- [ ] **Step 5: 添加样式**

在 `apps/desktop/src/renderer/src/styles.css` 的 `.targets-table .table-row` 附近加入：

```css
.target-block {
  display: flex;
  flex-direction: column;
}

.target-packages {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 10px 14px;
  padding: 4px 0 4px 14px;
  border-left: 2px solid var(--line-soft);
}

.target-package-row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 0.5fr auto;
  gap: 12px;
  align-items: center;
  padding: 6px 0;
  color: var(--ink-soft);
  font-size: 11.5px;
}

.target-package-row small {
  color: var(--ink-faint);
  font-family: var(--font-mono);
  font-size: 9.5px;
}

.target-package-empty {
  margin: 0;
  padding: 6px 0;
  color: var(--ink-faint);
  font-size: 11.5px;
}

.target-package-form {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  margin: 0 0 12px 28px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-muted);
}
```

在 `@media (max-width: 1020px)` 中加入：

```css
.target-package-form {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 6: 运行聚焦测试**

Run: `pnpm vitest run apps/desktop/src/renderer/src/TargetsView.test.tsx packages/shared/src/i18n.test.ts`

Expected: PASS，包括目标页全部用例和简体中文语言包完整性用例。

- [ ] **Step 7: 类型检查**

Run: `pnpm typecheck`

Expected: PASS，无 `MessageKey` 或 JSX 类型错误。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/renderer/src/TargetsView.tsx apps/desktop/src/renderer/src/TargetsView.test.tsx apps/desktop/src/renderer/src/styles.css packages/shared/src/i18n-en.ts locales/zh-CN.json
git commit -m "feat(desktop): aggregate package assignments into target rows"
```

### Task 2: 清理不再使用的目标页文案键

**Files:**
- Modify: `packages/shared/src/i18n-en.ts`
- Modify: `locales/zh-CN.json`

**Interfaces:**
- Consumes: Task 1 完成后的组件，不再引用下列键。
- Produces: 最终中英文文案表；`MessageKey` 不再包含已删除键。

- [ ] **Step 1: 删除旧键**

从 `packages/shared/src/i18n-en.ts` 和 `locales/zh-CN.json` 同时删除：

- `targets.table.package`
- `targets.table.version`
- `targets.packages.eyebrow`
- `targets.packages.title`
- `targets.form.routeEyebrow`
- `targets.form.target`
- `targets.form.noTargets`

保留 `targets.packages.empty`、`targets.form.assignPackage`、`targets.form.package`、`targets.form.versionOrTag` 和 `targets.form.assign`。

- [ ] **Step 2: 验证文案完整性**

Run: `pnpm vitest run packages/shared/src/i18n.test.ts`

Expected: PASS；简体中文仍覆盖所有英文键。

- [ ] **Step 3: 验证没有残留引用**

Run: `pnpm typecheck`

Expected: PASS。

Run: `rg "targets\.(table\.(package|version)|packages\.(eyebrow|title)|form\.(routeEyebrow|target|noTargets))" apps packages locales`

Expected: 无匹配。

- [ ] **Step 4: 运行完整测试**

Run: `pnpm test`

Expected: PASS，所有测试通过。

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/i18n-en.ts locales/zh-CN.json
git commit -m "chore(i18n): remove obsolete target assignment copy"
```
