# 语言包

Skillink 的 GUI 界面、错误提示和 Doctor 诊断支持通过本地 JSON 语言包切换语言。语言包是纯数据，不执行代码，也不改变任何 skill / package / route 业务语义。

## 存储位置

```text
<当前控制面>\                          # 例如 %USERPROFILE%\.agents\skillink 或 ~/.agents/skillink
├─ settings.json                       # { "schemaVersion": 1, "locale": "zh-CN" }
├─ locales\
│  ├─ zh-cn.json
│  └─ ja.json
├─ route.json
├─ package.json
├─ skill.json
└─ skills\
```

- 语言包安装到控制面的 `locales/`，文件名统一为 `locale.toLowerCase()`；例如 `zh-CN` 写入 `locales/zh-cn.json`。控制面由控制面清单的当前项或 `SKILLINK_HOME` 决定，没有隐式默认路径。
- 内置英文 `en` 不落盘，始终可用，不能删除或覆盖。
- `settings.json` 只保存用户偏好，不进入控制面 git 版本控制；`locales/` 受控制面 git 跟踪。
- Windows NSIS 安装包会在安装阶段把仓库自带 `zh-CN.json` 复制到旧默认目录 `%USERPROFILE%\.agents\skillink\locales\zh-cn.json`；如果目标已存在则保留用户版本。该步骤不读取控制面清单，使用其他控制面时需要手动安装语言包。portable 包不执行安装步骤，不会自动复制首次安装的语言包。应用启动时，如果当前控制面的 `zh-CN` 语言包与内置包的 `locale` / `name` / `nativeName` 一致，且内置包版本更新或缺少新版本文案，会自动刷新内置包；自定义语言包不会被覆盖。

## 语言包格式

```json
{
  "schemaVersion": 1,
  "locale": "zh-CN",
  "name": "Chinese (Simplified)",
  "nativeName": "简体中文",
  "version": "1.0.0",
  "direction": "ltr",
  "messages": {
    "app.nav.overview": "概览",
    "overview.stats.skills": {
      "one": "{count} 个技能",
      "other": "{count} 个技能"
    },
    "errors.LANGUAGE_PACK_INVALID": "语言包格式无效。",
    "doctorIssues.MISSING_CONTENT": "技能内容缺失：{name}@{version}"
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 固定为 `1` |
| `locale` | 是 | BCP 47 风格标签，例如 `zh-CN`、`ja`、`pt-BR` |
| `name` | 是 | 英文名称，显示在语言管理弹窗中 |
| `nativeName` | 是 | 该语言自己的名称，例如 `简体中文` |
| `version` | 是 | 语言包版本，例如 `1.0.0` |
| `direction` | 否 | `ltr` 或 `rtl`，默认 `ltr` |
| `messages` | 是 | 扁平点号 key 到文案的映射 |

限制：

- 最多 2000 个 key；
- 单个 key 最长 120 字符；
- 单条消息最长 5000 字符；
- 单个文件最大 512 KB；
- key 只能包含字母、数字、下划线和点号，且至少包含一个点，例如 `targets.routes.title`；
- 值可以是字符串，也可以是复数对象；复数对象必须包含 `other`，可选 `zero` / `one` / `two` / `few` / `many`；
- 占位符使用 `{name}`、`{count}` 形式。

## key 命名规则

- 以页面或领域开头：`app.*`、`overview.*`、`targets.*`、`skills.*`、`packages.*`、`doctor.*`、`language.*`；
- 已知错误码使用 `errors.<CODE>`，例如 `errors.PACKAGE_NOT_FOUND`；
- Doctor 问题使用 `doctorIssues.<CODE>`，例如 `doctorIssues.MISSING_CONTENT`；
- 复数使用对象形式，运行时通过 `Intl.PluralRules` 选择分类，缺少分类时回退 `other`；
- 路径、版本、skill / package 名称、target id 等数据值不翻译。

英文目录 `packages/shared/src/i18n-en.ts` 是唯一权威 key 集合和回退来源。语言包可以缺 key，也可以包含额外 key，但安装报告会列出缺失和额外 key。额外 key 不会报错。

## 安装与切换

```bash
# 列出内置英文和已安装语言包
skillink locale list [--json]

# 安装本地语言包；同名默认拒绝，--force 允许覆盖
skillink locale install <file> [--use] [--force] [--json]

# 选择已安装语言；en 始终可用
skillink locale use <locale> [--json]

# 删除语言包；删除当前语言会切回 en
skillink locale remove <locale> [--json]
```

`install --use` 安装后立即写入 `settings.json`。`list --json` 返回 `LanguageState`：`current`、`direction`、`packs` 和当前语言包自己的 `messages`；英文回退由 GUI 翻译器叠加，不会写进 `messages`。

更新语言包：

```bash
skillink locale install ./zh-CN.json --force --use
```

## GUI

侧边栏底部有“语言 / Language”入口，显示当前语言的 `nativeName`。点击后可：

- 查看内置英文和全部已安装语言包；
- 查看当前语言、版本和翻译覆盖率；
- 使用语言、删除语言包；
- 通过文件选择器安装 `.json` 语言包；
- 删除当前语言后自动回到英文；
- 操作错误显示在弹窗内。

切换语言会立即刷新导航、页面、弹窗和错误提示，不需要重启。GUI 通过主进程 IPC 调用同一套 CLI `locale` 命令层，Renderer 不直接访问文件系统。

## 解析优先级与回退

当前语言按以下顺序解析：

1. `SKILLINK_LOCALE` 环境变量；
2. `settings.json` 中的 `locale`；
3. 系统语言与已安装语言包的匹配结果；
4. `en`。

- 如果环境变量或设置指向不存在、已删除或损坏的语言包，回退 `en`，不会自动改选系统语言；
- 缺失的 key 使用英文文案；
- 英文也没有的 key 返回 key 本身；
- 语言包 JSON 损坏不会阻止应用启动。

## 错误与 Doctor

- 当前语言为英文时保留 CLI/Core 原始错误消息，避免丢失细节；
- 非英语语言优先显示 `errors.<CODE>` 翻译，并附带错误码，例如 `语言包格式无效。 (LANGUAGE_PACK_INVALID)`；
- 当前语言包没有该错误的翻译时，回退原始英文消息；
- Doctor 问题通过 `doctorIssues.<CODE>` 翻译，并使用 `name`、`version`、`path`、`targetId`、`packageName` 等字段插值；
- `INVALID_CONFIG` 的原始消息包含具体上下文，始终保留原文。

## 安全边界

- 语言包只能是 UTF-8 JSON 数据，不能执行脚本；
- 只允许安装本地文件，不读取 URL；
- 安装前校验文件大小、JSON 结构、`schemaVersion`、locale、key 格式、key 数量和消息长度；
- 所有写文件使用原子写入（临时文件 + rename）；
- `en` 不能安装、覆盖或删除。

## 当前限制

- CLI 的普通帮助和命令输出仍为英文；本期只新增 `locale` 管理命令；
- `direction: rtl` 会写入 `document.documentElement.dir`，但 Arabic / Hebrew 的逐页视觉验收留到后续阶段；
- 不提供在线下载、版本仓库、自动更新或签名校验；
- 语言包额外 key 会保留，但不会影响业务逻辑；
- 翻译覆盖率按当前语言包覆盖的英文 key 数量计算。

## 示例语言包

仓库内 `locales/zh-CN.json` 是完整的简体中文语言包，覆盖全部英文 key，可作为编写新语言包的模板：

```bash
skillink locale install ./locales/zh-CN.json --use
```
