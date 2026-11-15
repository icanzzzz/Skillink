# GUI 交互现代化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 desktop renderer 从「凭记忆手写 `name@version`」改为「从快照派生选择器 + 可见默认值」，并按职责重切 renderer 模块。

**Architecture:** 新增三层——`packages/shared/src/version-order.ts`（semver 排序与建议版本，与 core 共用同一语义）、`apps/desktop/src/renderer/src/library.ts`（快照 → 可选项）、`apps/desktop/src/renderer/src/ui/`（无业务知识的展示原语）。三个视图各自拆进 `packages/`、`skills/`、`targets/` 目录，草稿状态与「草稿 → IPC 请求」映射抽成纯函数 `*-draft.ts`。CLI、core、IPC schema 均不改动。

**Tech Stack:** Electron 45 + React 19 + TypeScript（strict、noUncheckedIndexedAccess）、Zod、vitest（node 环境，`renderToStaticMarkup` 渲染断言，无 jsdom；pnpm workspace）。

**Spec:** `docs/superpowers/specs/2026-11-13-gui-interaction-redesign-design.md`

## Global Constraints

- 只允许修改任务 `Files` 清单里列出的文件；清单外文件只读。
- 不新增任何 npm 依赖（`semver` 不进 `apps/desktop`）。
- 不改 `apps/cli/**`、`packages/core/**`、`apps/desktop/src/ipc-schemas.ts`。
- renderer 文件不得 import `node:*`、`electron`、`@skillink/core`，不得相对引用 `apps/desktop/src/main` 或 `apps/desktop/src/preload`（`packages/core/src/module-boundaries.test.ts` 会检查）。
- renderer 内部相对 import 一律写 `.js` 后缀（如 `./Feedback.js`），与现有文件一致。
- 新增/删除文案必须同时改 `packages/shared/src/i18n-en.ts` 与 `locales/zh-CN.json`（`packages/shared/src/i18n.test.ts` 断言每个英文键在中文包里存在）。
- 文案不使用示例值占位，无默认值的字段 placeholder 用「必填 / 可选」。
- 测试只用 `vitest` + `react-dom/server` 的 `renderToStaticMarkup`，不引入 jsdom / testing-library / @testing-library/*。
- TypeScript 全仓单 tsconfig：`strict`、`noUncheckedIndexedAccess`，禁止 `as any`。
- 提交信息用 `feat(gui): ...` / `test(gui): ...` / `docs(gui): ...`，每次提交只含本任务文件。

## Review Focus

1. **空库**：控制面里一个包、一个技能都没有时，创建包弹窗与分配包弹窗必须显示引导文案且不崩（`packages` 为空对象、`skills` 为空对象）。
2. **版本重复**：创建包时输入一个已存在的 `name@version`，本地提示必须与 core 的拒绝一致——不能出现「界面允许提交但必失败」或「界面禁止提交但 core 允许」。
3. **标签指向区分**：标签编辑器里，指向其它版本的标签点击后必须发出 tag 请求；指向当前版本的标签必须是不可点的静态文本（`span`），不能是 `button`。
4. **拖放兜底**：拖入非文件夹、一次拖入多个文件、或 `getPathForFile` 取不到路径时，必须静默回退到折叠的路径输入，不能抛错或卡死。
5. **版本字符串**：技能版本带 build metadata（`1.2.0+abc`）时，建议版本必须剥离 metadata 得到 `1.2.1`；非 semver 版本不得让排序抛错。

---

### Task 1: 共享版本工具

**Files:**
- Create: `packages/shared/src/version-order.ts`
- Create: `packages/shared/src/version-order.test.ts`
- Modify: `packages/shared/src/index.ts`（追加一行 re-export）

**Interfaces:**
- Consumes: `semver`（`packages/shared/package.json` 已声明 `^7.8.5`）
- Produces:
  - `compareVersionDesc(left: string, right: string): number` — `Array.prototype.sort` 用降序比较器；两者都是合法 semver 时用 `semver.rcompare`，一方非法时合法者在前，都非法时按「降序字符串」比较。
  - `sortVersionsDesc(versions: readonly string[]): string[]` — 返回新数组，不改入参。
  - `highestVersion(versions: readonly string[]): string | null`
  - `suggestNextVersion(versions: readonly string[]): string` — 空数组或没有合法 semver 时返回 `'1.0.0'`；否则取最高版本，剥离 build metadata 后 `semver.inc(core, 'patch')`，`inc` 返回 null 时回退 `'1.0.0'`。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/version-order.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  compareVersionDesc,
  highestVersion,
  sortVersionsDesc,
  suggestNextVersion,
} from './version-order.js';

describe('version order', () => {
  it('sorts valid versions descending and pushes invalid ones last', () => {
    expect(
      sortVersionsDesc(['1.0.0', '1.10.0', '2.0.0-rc.1', '1.2.0', 'bogus']),
    ).toEqual(['2.0.0-rc.1', '1.10.0', '1.2.0', '1.0.0', 'bogus']);
  });

  it('does not mutate the input', () => {
    const input = ['1.0.0', '2.0.0'];
    sortVersionsDesc(input);
    expect(input).toEqual(['1.0.0', '2.0.0']);
  });

  it('returns null for an empty list', () => {
    expect(highestVersion([])).toBeNull();
    expect(highestVersion(['2.0.0', '1.0.0'])).toBe('2.0.0');
  });

  it('suggests the next patch of the highest version', () => {
    expect(suggestNextVersion([])).toBe('1.0.0');
    expect(suggestNextVersion(['1.0.0', '1.2.0'])).toBe('1.2.1');
    expect(suggestNextVersion(['not-a-version'])).toBe('1.0.0');
  });

  it('strips build metadata before bumping', () => {
    expect(suggestNextVersion(['1.2.0+abc'])).toBe('1.2.1');
  });

  it('compares descending', () => {
    expect(compareVersionDesc('2.0.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersionDesc('1.0.0', '2.0.0')).toBeGreaterThan(0);
    expect(compareVersionDesc('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersionDesc('1.0.0', 'bogus')).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/shared/src/version-order.test.ts`
Expected: FAIL — `Cannot find module './version-order.js'`

- [ ] **Step 3: 实现 `packages/shared/src/version-order.ts`**

按 `packages/shared/src/skill-directory.ts:1` 的既有 import 风格从 `semver` 做具名导入（`rcompare`、`valid`、`inc`、`parse`）。四个导出函数严格按 Interfaces 的语义实现；`sortVersionsDesc` 用 `[...versions].sort(compareVersionDesc)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/shared/src/version-order.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 从包入口导出**

在 `packages/shared/src/index.ts` 末尾按现有文件风格追加 `export * from './version-order.js';`（若该文件用显式具名导出，则改为四个具名导出）。

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src/version-order.ts packages/shared/src/version-order.test.ts packages/shared/src/index.ts
git commit -m "feat(gui): add shared version ordering helpers"
```

---

### Task 2: 渲染层选项派生

**Files:**
- Create: `apps/desktop/src/renderer/src/library.ts`
- Create: `apps/desktop/src/renderer/src/library.test.ts`

**Interfaces:**
- Consumes（Task 1）：`sortVersionsDesc`、`suggestNextVersion`（`@skillink/shared`）
- Consumes: `SkillFile`、`PackageFile`（`@skillink/shared`）
- Produces:
  - `interface VersionChoice { value: string; label: string; kind: 'version' | 'tag' }`
  - `interface LibraryOption { name: string; description?: string; tags: Record<string, string>; versions: string[]; latestVersion: string | null }`
  - `interface SkillOption extends LibraryOption {}`
  - `interface PackageOption extends LibraryOption { skillCount: Record<string, number> }`
  - `skillOptions(file: SkillFile): SkillOption[]` — 按 `name` 升序（`localeCompare`）。
  - `packageOptions(file: PackageFile): PackageOption[]` — 同上；`skillCount[version] = Object.keys(version.skills).length`。
  - `versionChoices(option: LibraryOption, includeTags: boolean): VersionChoice[]` — `includeTags` 为真时先把 `tags` 中「值确实存在于 `versions`」的项排在前，`value` 是标签名，`label` 形如 `latest → 1.2.0`；随后是全部精确版本，`label` 就是版本号。
  - `defaultRequested(option: LibraryOption): string` — 返回 `latestVersion ?? ''`（精确版本，不返回标签）。
  - `suggestVersionFor(file: PackageFile, name: string): string` — 该包已有版本交给 `suggestNextVersion`；包不存在时返回 `'1.0.0'`。
  - `latestVersion` 规则：若 `tags.latest` 指向一个真实存在的版本则用它，否则用最高版本，都没有则 `null`。

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/library.test.ts`，用内联的 `SkillFile` / `PackageFile` 字面量（参考 `packages/shared/src/schemas.ts` 的 `schemaVersion: 2` 结构）覆盖：

```ts
it('lists skill options sorted by name with descending versions', () => {
  // skills: { b: {versions: {'1.0.0': v, '1.10.0': v}}, a: {versions: {'2.0.0': v}} }
  // expect names ['a','b']; b.versions ['1.10.0','1.0.0']; a.latestVersion '2.0.0'
});

it('prefers the latest tag when it points at an existing version', () => {
  // tags: { latest: '1.0.0' }, versions {'1.0.0': v, '2.0.0': v} -> latestVersion '1.0.0'
});

it('ignores a latest tag pointing at a missing version', () => {
  // tags: { latest: '9.9.9' } -> latestVersion is the highest real version
});

it('builds version choices with tags first when enabled', () => {
  // versionChoices(option, true)[0] == { value: 'latest', label: 'latest → 1.0.0', kind: 'tag' }
  // versionChoices(option, false) contains no kind 'tag'
});

it('counts direct skills per package version', () => {
  // package version with skills { a: '1.0.0', b: '1.0.0' } -> skillCount['1.0.0'] === 2
});

it('suggests a next version per package', () => {
  // suggestVersionFor(file, 'frontend') === '1.2.1' for versions 1.0.0,1.2.0
  // suggestVersionFor(file, 'missing') === '1.0.0'
});
```

断言数值与数组内容，不写快照。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/library.test.ts`
Expected: FAIL — `Cannot find module './library.js'`

- [ ] **Step 3: 实现 `library.ts`**

只做派生，不做校验、不写文案（`label` 里的 `→` 是符号不是文案）。所有函数无副作用。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/library.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/library.ts apps/desktop/src/renderer/src/library.test.ts
git commit -m "feat(gui): derive pickable options from snapshot"
```

---

### Task 3: 展示原语

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/ChoiceList.tsx`
- Create: `apps/desktop/src/renderer/src/ui/ChoiceList.test.tsx`
- Create: `apps/desktop/src/renderer/src/ui/VersionSelect.tsx`
- Create: `apps/desktop/src/renderer/src/ui/VersionSelect.test.tsx`
- Create: `apps/desktop/src/renderer/src/ui/TagEditor.tsx`
- Create: `apps/desktop/src/renderer/src/ui/TagEditor.test.tsx`

**Interfaces:**
- Consumes（Task 2）：`VersionChoice`
- Consumes: `useI18n`（`../i18n.js`）、`renderWithMessages`（`../i18n.test-utils.js`）
- Produces:
  - `interface ChoiceItem { value: string; label: string; description?: string; meta?: string; disabled?: boolean; disabledReason?: string }`
  - `interface ChoiceListProps { legend: string; items: ChoiceItem[]; selected: readonly string[]; onToggle: (value: string) => void; searchPlaceholder: string; emptyMessage: string; searchable?: boolean }`
  - `ChoiceList(props): JSX.Element` — 渲染 `<div class="choice-list">`、`<input type="search">`（`aria-label` 取 `legend`）、`<ul class="choice-items">`，每项是 `<label class="choice-item"><input type="checkbox" checked={selected.includes(value)} disabled={item.disabled} onChange={() => onToggle(value)} />`，名称用 `<span class="choice-name">`，描述用 `<small>`，`meta` 用 `<code>`，禁用原因用 `<em>`；过滤条件 = 搜索词大小写不敏感地包含于 `label` 或 `description`；过滤后为空时渲染 `<p class="empty">{emptyMessage}</p>`。`searchable` 默认 `true`，为 `false` 时不渲染搜索框。
  - `interface VersionSelectProps { label: string; name: string; options: VersionChoice[]; value: string; onChange: (value: string) => void; disabled?: boolean }`
  - `VersionSelect(props)` — `<label class="field version-select"><span>{label}</span><select aria-label={\`${label}: ${name}\`} value={value} onChange={...}>`；若 `value` 不在 `options` 里，额外渲染一个同值 `<option>`，避免 React 受控告警。
  - `interface TagEditorProps { label: string; tags: Record<string, string>; currentVersion: string; busy?: boolean; onApplyTag: (tag: string) => void }`
  - `TagEditor(props)` — 用 `useI18n()` 取 `packages.tag.*` 文案；标签指向 `currentVersion` 时渲染 `<span class="tag is-active">`，否则渲染 `<button type="button" class="tag tag-button">`（点击调 `onApplyTag(tag)`）；末尾「新建标签」按钮展开输入（`aria-label` = `packages.tag.name`）+ 确认按钮，空名禁用确认，提交后收起并清空。

- [ ] **Step 1: 写失败测试（三个文件）**

`ChoiceList.test.tsx`：`renderWithMessages(<ChoiceList legend="Skills" items={[a,b]} selected={['a']} onToggle={() => {}} searchPlaceholder="Search" emptyMessage="None" />)`，断言输出含 `type="checkbox"`、`checked=""`（React 服务端对选中项输出 `checked=""`）、`data-disabled`/`disabled=""`（对禁用项）、`aria-label="Skills"`；空 `items` 时含 `None`。

`VersionSelect.test.tsx`：标签项输出 `latest → 1.0.0`，精确版本输出 `1.0.0`；`value` 不在 options 时输出该值作为 option。

`TagEditor.test.tsx`：`tags={{ latest: '1.0.0', stable: '2.0.0' }}`、`currentVersion="1.0.0"` 时，`latest` 输出为 `class="tag is-active"` 且**不含** `tag-button`；`stable` 输出含 `tag-button`；含「新建标签」文案。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/ui`
Expected: FAIL — 三个模块都不存在

- [ ] **Step 3: 实现三个组件**

不使用 `useState` 之外的副作用；不读 `window`；不 import 任何 `@skillink/core`。搜索框用 `value` + `onChange` 受控。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/ui`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/ui
git commit -m "feat(gui): add picker primitives"
```

---

### Task 4: 文案、样式与架构文档

**Files:**
- Modify: `packages/shared/src/i18n-en.ts`
- Modify: `locales/zh-CN.json`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: 无
- Produces: 设计文档第 8 节列出的全部新增 i18n 键（键名与中英文文案逐字照抄），以及第 9 节列出的 CSS 类名。

- [ ] **Step 1: 先只改英文目录**

把设计文档 §8 表格里的 31 个键按现有分组顺序写进 `packages/shared/src/i18n-en.ts`（`common.*` 插到 `common` 分组，`packages.*` 插到 packages 分组，依此类推）。本步不动 `locales/zh-CN.json`。

- [ ] **Step 2: 跑对齐测试确认失败**

Run: `pnpm exec vitest run packages/shared/src/i18n.test.ts`
Expected: FAIL — `ships a complete Simplified Chinese language pack` 的 `missing` 非空

- [ ] **Step 3: 补中文目录**

把同样 31 个键写进 `locales/zh-CN.json` 的 `messages`，文案取自设计文档 §8 的 zh-CN 列。保持 JSON 现有的键排序风格。

- [ ] **Step 4: 跑对齐测试确认通过**

Run: `pnpm exec vitest run packages/shared/src/i18n.test.ts`
Expected: PASS

- [ ] **Step 5: 补 CSS**

在 `apps/desktop/src/renderer/src/styles.css` 末尾按现有风格追加（复用已有 token，颜色沿用 `--accent` 与 `rgba(31, 111, 92, ...)`）：

- `.choice-list`、`.choice-items`、`.choice-item`、`.choice-item:hover`、`.choice-item.is-disabled`、`.choice-name`、`.choice-item small`、`.choice-item code`、`.choice-item em`
- `.version-select`
- `.tag-editor`、`.tag-add`
- `.segmented`、`.segmented button`、`.segmented button.is-active`
- `.selection-summary`
- `.drop-zone`、`.drop-zone.is-over`、`.drop-zone strong`、`.drop-zone small`
- `.field-note`、`.field-error`
- `.assign-preview`
- `.form-section`
- `.manual-path`、`.manual-path summary`
- `.install-summary`

只加类，不改动已有规则。

- [ ] **Step 6: 改架构文档**

按设计文档 §9 就地改写 `ARCHITECTURE.md` 的 GUI 约定段落，并更新 renderer 文件/模块清单（如存在）。保持文档语言（中文）与列表风格，不新增章节、不改其它章节。

- [ ] **Step 7: 提交**

```bash
git add packages/shared/src/i18n-en.ts locales/zh-CN.json apps/desktop/src/renderer/src/styles.css ARCHITECTURE.md
git commit -m "feat(gui): add picker copy, styles and architecture rules"
```

---

### Task 5: 包组合改造（`packages/`）

**Files:**
- Create: `apps/desktop/src/renderer/src/packages/package-draft.ts`
- Create: `apps/desktop/src/renderer/src/packages/package-draft.test.ts`
- Create: `apps/desktop/src/renderer/src/packages/CreatePackageDialog.tsx`
- Create: `apps/desktop/src/renderer/src/packages/CreatePackageDialog.test.tsx`
- Create: `apps/desktop/src/renderer/src/packages/PackageCard.tsx`
- Create: `apps/desktop/src/renderer/src/packages/PackagesView.tsx`
- Create: `apps/desktop/src/renderer/src/packages/PackagesView.test.tsx`

**Interfaces:**
- Consumes（Task 2）：`skillOptions`、`packageOptions`、`defaultRequested`、`suggestVersionFor`、`SkillOption`、`PackageOption`
- Consumes（Task 3）：`ChoiceList`、`VersionSelect`、`TagEditor`
- Consumes: `Modal`（`../Modal.js`）、`useI18n`（`../i18n.js`）、`useConfirm`/`useToast`（`../Feedback.js`）、`errorMessage`（`../format.js`）
- Produces:
  - `type PackageNameMode = 'existing' | 'new'`
  - `interface PackageDraft { nameMode: PackageNameMode; name: string; version: string; description: string; skills: Record<string, string>; packages: Record<string, string> }`
  - `interface PackageDraftIssue { code: 'name-missing' | 'version-missing' | 'version-taken' | 'no-dependencies' }`
  - `createPackageDraft(packages: PackageFile): PackageDraft` — `nameMode: 'new'`、空名、版本 `'1.0.0'`（`suggestVersionFor` 对空库的返回）、空依赖。
  - `copyPackageDraft(packages: PackageFile, name: string, version: string): PackageDraft` — 已有包模式，名称/版本取自参数（版本用于取依赖来源），输出 draft 的 `version` 换成 `suggestVersionFor(packages, name)`，`description`/`skills`/`packages` 照抄来源版本。
  - `setDraftNameMode`、`setDraftName`、`setDraftVersion`、`setDraftDescription`：`(draft, value) => PackageDraft`，不可变更新。
  - `toggleDraftSkill(draft, option: SkillOption): PackageDraft` — 已存在则删除；否则写入 `defaultRequested(option)`。
  - `setDraftSkillVersion(draft, name, version): PackageDraft`、`toggleDraftPackage(draft, option: PackageOption): PackageDraft`、`setDraftPackageVersion`。
  - `packageDraftIssues(draft, packages: PackageFile): PackageDraftIssue[]` — 名称空 → `name-missing`；版本空 → `version-missing`；`packages.packages[draft.name]?.versions[draft.version]` 存在 → `version-taken`；技能与嵌套包都空 → `no-dependencies`。
  - `toCreatePackageInput(draft): CreatePackageFormInput | null` — 有 issue 时 `null`；否则 `{ name: trim(), version: trim(), description: trim() || undefined, skills, packages }`。
  - `interface CreatePackageDialogProps { open: boolean; busy?: boolean; packages: PackageFile; skills: SkillFile; preset?: { name: string; version: string } | null; onClose: () => void; onCreatePackage?: (input: CreatePackageFormInput) => Promise<boolean | void> | boolean | void }`
  - `interface PackageCardProps { name: string; entry: PackageEntry; skills: SkillFile; packages: PackageFile; busy?: boolean; onTag?: (input: PackageTagFormInput) => void; onCopy: (input: PackageVersionInput) => void; onRemove?: (input: PackageVersionInput) => void }`
  - `PackagesView` — props 与现在完全一致：`{ packages: PackageFile; skills: SkillFile; busy?: boolean; onCreatePackage?: ...; onTag?: ...; onRemove?: ... }`，`export` 名不变。

- [ ] **Step 1: 写 `package-draft.test.ts`（失败测试）**

覆盖：新建 draft 默认值；`copyPackageDraft` 版本被换成下一个补丁版本且依赖照抄；`toggleDraftSkill` 勾选写入默认精确版本、再次调用删除；`setDraftSkillVersion` 改版本；`packageDraftIssues` 四个分支各自命中；`toCreatePackageInput` 在有空名/空依赖时返回 `null`，`description` 空白时字段为 `undefined`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/packages/package-draft.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 `package-draft.ts`**

纯函数，不 import React、不 import `Modal`、不调用 `t`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/packages/package-draft.test.ts`
Expected: PASS

- [ ] **Step 5: 写 `CreatePackageDialog.test.tsx`（失败测试）**

`renderWithMessages(<CreatePackageDialog open packages={...} skills={...} onClose={() => {}} />)`，断言：

- 输出**不含** `<textarea`（设计文档 §2 的静默丢行必须消失）；
- 含 `type="checkbox"`（技能/包选择）；
- 含 `Existing package` 与 `New package` 两个分段按钮；
- 版本输入框的 `value` 是建议版本（`value="1.0.0"`）；
- 空库（`packages: {schemaVersion: 2, packages: {}}`）时含 `No skills installed yet.` 或 `No packages yet`，且不抛错。

- [ ] **Step 6: 实现 `CreatePackageDialog.tsx` 与 `PackageCard.tsx` 与 `PackagesView.tsx`**

严格照设计文档 §6.1：`Modal`（`size="lg"`）、分段模式、`<select>` 已有包、版本输入 + `.field-note` 已存在版本 + `.field-error` 重复提示、两个 `ChoiceList` + 行内 `VersionSelect`、`.selection-summary`、提交禁用条件、复制提示条。`PackageCard` 用现有 `.package-card` / `.version-tabs` / `.version-block` / `.version-detail` 结构与 `TagEditor` 替换空标签输入框。

- [ ] **Step 7: 跑组件测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/packages`
Expected: PASS

- [ ] **Step 8: 写 `PackagesView.test.tsx`**

移植现有根目录 `PackagesView.test.tsx` 的断言（空态文案、`Create package` 按钮、版本标签页），并补一条：关闭态渲染不含 `modal-backdrop`。

- [ ] **Step 9: 跑整个 packages 目录**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/packages`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add apps/desktop/src/renderer/src/packages
git commit -m "feat(gui): replace package textareas with pickers"
```

---

### Task 6: 技能导入改造（`skills/`）

**Files:**
- Create: `apps/desktop/src/renderer/src/skills/skill-batch.ts`
- Create: `apps/desktop/src/renderer/src/skills/skill-batch.test.ts`
- Create: `apps/desktop/src/renderer/src/skills/SkillBatchCard.tsx`
- Create: `apps/desktop/src/renderer/src/skills/InstalledSkillCard.tsx`
- Create: `apps/desktop/src/renderer/src/skills/SkillImportDialog.tsx`
- Create: `apps/desktop/src/renderer/src/skills/SkillImportDialog.test.tsx`
- Create: `apps/desktop/src/renderer/src/skills/SkillsView.tsx`
- Create: `apps/desktop/src/renderer/src/skills/SkillsView.test.tsx`
- Modify: `apps/desktop/src/shared.ts`（`DesktopApi` 增加 `getPathForFile`）
- Modify: `apps/desktop/src/preload/index.ts`（暴露 `getPathForFile`）

**Interfaces:**
- Consumes（Task 3）：`TagEditor`
- Consumes（Task 4）：`skills.import.*`、`skills.batch.alreadyInstalled` 文案
- Consumes: `SkillPackageScanReport`、`ImportSkillResult`、`SkillFile`（`@skillink/shared`）
- Produces:
  - `apps/desktop/src/shared.ts`：`interface DesktopApi` 增加 `getPathForFile(file: File): string;`
  - `apps/desktop/src/preload/index.ts`：`import { contextBridge, ipcRenderer, webUtils } from 'electron'`，api 对象增加 `getPathForFile: (file: File) => webUtils.getPathForFile(file),`
  - `type SkillBatchStatus = 'pending' | 'installing' | 'installed' | 'blocked' | 'error'`
  - `interface SkillBatchItem { sourceDir: string; name: string; version: string; defaultVersion: string; directoryLinks: string[]; status: SkillBatchStatus; error?: string; result?: ImportSkillResult }`
  - `toSkillBatchItem(candidate: SkillPackageCandidate): SkillBatchItem` — `name` **直接等于**扫描到的名称（不再为空），`version` 为剥离 `+hash` 的主版本，`defaultVersion` 同值。
  - `resolveSkillBatchName(item: SkillBatchItem): string` — `item.name.trim() || item.defaultVersion` 的既有语义改为 `item.name.trim()`（名称永远有值）。
  - `resetBatchName(item: SkillBatchItem): SkillBatchItem` — 安装成功后保留名称与版本，状态置 `installed`。
  - `isAlreadyInstalled(skills: SkillFile, name: string, version: string): boolean`
  - `interface SkillsViewProps` — 与现在**完全一致**，额外增加可选 `onResolveDroppedPath?: (file: File) => string;`

- [ ] **Step 1: 写 `skill-batch.test.ts`（失败测试）**

覆盖：`toSkillBatchItem` 名称预填为扫描名（非空）、版本剥离 `+abc`、`defaultVersion` 一致；`resetBatchName` 保留名称；`isAlreadyInstalled` 命中/未命中。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/skills/skill-batch.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 `skill-batch.ts`**

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/skills/skill-batch.test.ts`
Expected: PASS

- [ ] **Step 5: 改 preload 与 `shared.ts`**

先改 `apps/desktop/src/shared.ts` 的 `DesktopApi`，再在 `apps/desktop/src/preload/index.ts` 加实现。若测试里有构造完整 `DesktopApi` 的桩对象导致类型报错，补上该方法。

- [ ] **Step 6: 写 `SkillImportDialog.test.tsx`（失败测试）**

断言 `renderWithMessages(<SkillImportDialog open onClose={() => {}} />)`：

- 含 `Drop a folder here` 与 `Choose folder`；
- 路径输入处于折叠的 `<details class="manual-path">` 内（断言输出含 `<details` 且 `Choose folder` 在 `details` 之前）；
- 传入 `onResolveDroppedPath` 时不崩。

- [ ] **Step 7: 实现 `SkillImportDialog.tsx`、`SkillBatchCard.tsx`、`InstalledSkillCard.tsx`、`SkillsView.tsx`**

照设计文档 §6.4：拖放区（`onDragOver` 阻止默认 + `is-over` 态、`onDrop` 取 `dataTransfer.files[0]`，`onResolveDroppedPath(file)` 得到路径后调 `onScanSkills`；取不到路径则静默回退，不报错）、折叠手动路径、名称预填值、已安装提示、「全部安装」串行执行、安装成功后不清空名称。`InstalledSkillCard` 用 `TagEditor` 替换空标签输入。

- [ ] **Step 8: 跑组件测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/skills`
Expected: PASS

- [ ] **Step 9: 写 `SkillsView.test.tsx`**

断言空态文案、`Import skills` 按钮、GC 面板存在；关闭态不渲染 `modal-backdrop`。

- [ ] **Step 10: 跑整个 skills 目录**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/skills`
Expected: PASS

- [ ] **Step 11: 提交**

```bash
git add apps/desktop/src/renderer/src/skills apps/desktop/src/shared.ts apps/desktop/src/preload/index.ts
git commit -m "feat(gui): drag-and-drop skill import with visible names"
```

---

### Task 7: 目标分配改造（`targets/`）

**Files:**
- Create: `apps/desktop/src/renderer/src/targets/route-draft.ts`
- Create: `apps/desktop/src/renderer/src/targets/route-draft.test.ts`
- Create: `apps/desktop/src/renderer/src/targets/AddTargetDialog.tsx`
- Create: `apps/desktop/src/renderer/src/targets/TargetCard.tsx`
- Create: `apps/desktop/src/renderer/src/targets/AssignPackageDialog.tsx`
- Create: `apps/desktop/src/renderer/src/targets/AssignPackageDialog.test.tsx`
- Create: `apps/desktop/src/renderer/src/targets/TargetsView.tsx`
- Create: `apps/desktop/src/renderer/src/targets/TargetsView.test.tsx`

**Interfaces:**
- Consumes（Task 2）：`packageOptions`、`versionChoices`、`defaultRequested`、`PackageOption`
- Consumes（Task 3）：`VersionSelect`
- Consumes: `AddTargetRequest`、`RouteAddRequest`、`RouteRemoveRequest`、`RouteEnableRequest`、`TargetEnableRequest`、`TargetModeRequest`、`TargetRemoveRequest`（`../../ipc-schemas.js`）
- Consumes: `TargetRoute`、`PackageFile`、`StatusEntry`、`TargetSkillSummary`、`ApplyReport`（`@skillink/shared`）
- Produces:
  - `interface RouteDraft { targetId: string | null; name: string; requested: string }`
  - `EMPTY_ROUTE_DRAFT: RouteDraft`
  - `createRouteDraft(targetId: string, options: PackageOption[], assigned: readonly string[]): RouteDraft` — 选第一个未分配的包，`requested` 取 `defaultRequested`；全部已分配时返回 `{ targetId, name: '', requested: '' }`。
  - `selectRoutePackage(draft: RouteDraft, option: PackageOption): RouteDraft` — 同时把 `requested` 重置为该包默认版本。
  - `setRouteRequested(draft: RouteDraft, requested: string): RouteDraft`
  - `routeDraftIssue(draft: RouteDraft, assigned: readonly string[]): 'package-missing' | 'requested-missing' | 'already-assigned' | null`
  - `toRouteAddInput(draft: RouteDraft): RouteAddRequest | null`
  - 类型别名（保持与现有 `TargetsView` 相同的结构，使 `App.tsx` 调用点无需改动）：
    `export type RouteAddFormInput = RouteAddRequest;`
    `export type RouteRemoveFormInput = RouteRemoveRequest;`
    `export type RouteEnableFormInput = RouteEnableRequest;`
    `export type TargetEnableFormInput = TargetEnableRequest;`
    `export type TargetModeFormInput = TargetModeRequest;`
    `export type TargetRemoveFormInput = TargetRemoveRequest;`
  - `interface AssignPackageDialogProps { open: boolean; busy?: boolean; target: TargetRoute | null; packages: PackageFile; onClose: () => void; onAssign?: (input: RouteAddFormInput) => Promise<boolean | void> | boolean | void }`
  - `TargetsView` — props 与现有 `TargetsViewProps` **逐字段一致**（`targets`、`statusEntries?`、`targetSkills?`、`applyReport?`、`busy?`、`onBrowse?`、`onAddTarget?`、`onRemoveTarget?`、`onTargetEnable?`、`onTargetMode?`、`onRouteAdd?`、`onRemoveRoute?`、`onRouteEnable?`、`onApply?`、`onPreview?`），`export` 名不变。

- [ ] **Step 1: 写 `route-draft.test.ts`（失败测试）**

覆盖：`createRouteDraft` 跳过已分配的包；全部已分配时 `name` 为空；`selectRoutePackage` 重置 `requested`；`routeDraftIssue` 三个分支；`toRouteAddInput` 在无包时 `null`、否则 trim；`EMPTY_ROUTE_DRAFT` 不可变（修改返回值不影响常量）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/targets/route-draft.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 `route-draft.ts`**

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/targets/route-draft.test.ts`
Expected: PASS

- [ ] **Step 5: 写 `AssignPackageDialog.test.tsx`（失败测试）**

断言：空包库时含 `No packages to assign. Create a package first.` 且确认按钮 `disabled`；已分配的包出现 `already assigned`；有包时输出含 `directSkills` 渲染的 `skills directly`；输出不含 `<datalist`、不含自由文本包名输入。

- [ ] **Step 6: 实现三个组件与 `TargetsView.tsx`**

照设计文档 §6.2、§6.5：目标卡片「分配包」打开 `AssignPackageDialog`（包 `<select>` + `VersionSelect` + `.assign-preview`）；移除内联 `target-package-form`；`AddTargetDialog` 在路径变化且 id 未被编辑时把派生 id 写入 `value`。保留现有 `.target-card*` 结构与全部确认弹窗（`useConfirm`）。

- [ ] **Step 7: 跑组件测试确认通过**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/targets`
Expected: PASS

- [ ] **Step 8: 写 `TargetsView.test.tsx`**

断言空态、`Add target` 按钮、目标行渲染路径与模式；关闭态不渲染 `modal-backdrop`。

- [ ] **Step 9: 跑整个 targets 目录**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/targets`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add apps/desktop/src/renderer/src/targets
git commit -m "feat(gui): assign packages through a picker dialog"
```

---

### Task 8: 收口与全量验证

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `packages/shared/src/i18n-en.ts`（删 3 个死键）
- Modify: `locales/zh-CN.json`（删 3 个死键）
- Delete: `apps/desktop/src/renderer/src/PackagesView.tsx`、`PackagesView.test.tsx`
- Delete: `apps/desktop/src/renderer/src/SkillsView.tsx`、`SkillsView.test.tsx`
- Delete: `apps/desktop/src/renderer/src/TargetsView.tsx`、`TargetsView.test.tsx`
- Delete: `apps/desktop/src/renderer/src/targetAssignment.ts`、`targetAssignment.test.ts`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 可运行的 renderer

- [ ] **Step 1: 切换 `App.tsx` 引用**

把三个 import 改为 `./packages/PackagesView.js`、`./skills/SkillsView.js`、`./targets/TargetsView.js`；给 `SkillsView` 传 `onResolveDroppedPath={(file) => client?.getPathForFile(file) ?? ''}`（`client` 沿用 `App.tsx:123` 的既有变量与可选链），其它视图 props 不变。

- [ ] **Step 2: 删除旧文件**

删除上面 `Delete` 列出的 8 个文件。删除前用 `grep -rn "targetAssignment" apps/desktop/src` 确认没有其它引用；若有，改到 `./targets/route-draft.js`。

- [ ] **Step 3: 删死键**

从 `packages/shared/src/i18n-en.ts` 与 `locales/zh-CN.json` 删除 `packages.form.skills`、`packages.form.packages`、`packages.availableSkills`。

- [ ] **Step 4: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误。若报未使用导入/类型不匹配，只在 `Files` 清单内的文件里修。

- [ ] **Step 5: 全量测试**

Run: `pnpm test`
Expected: 全部通过，包含 `packages/core/src/module-boundaries.test.ts` 与 `packages/shared/src/i18n.test.ts`。

- [ ] **Step 6: 人工核对三条不可回退的约束**

```
rg -n "<textarea" apps/desktop/src/renderer/src/packages apps/desktop/src/renderer/src/skills apps/desktop/src/renderer/src/targets
rg -n "parseDependencies" apps/desktop/src
rg -n "availableSkills" apps/desktop/src packages/shared/src locales
```

三条都必须零命中。

- [ ] **Step 7: 提交**

```bash
git add -A apps/desktop/src/renderer/src packages/shared/src/i18n-en.ts locales/zh-CN.json
git commit -m "refactor(gui): wire picker views and drop legacy forms"
```
