# DESIGN.md — 报价系统视觉规范

> 所有 UI 改动（不管由谁执行：Claude / Codex / 人工）都必须遵守本文档。
> 改动完成后自查：间距是否在刻度上、颜色是否在 token 内、主色占比是否克制、按钮是否三档之一。

## Brand Tone

内部数据工具，不是营销站。风格对标 **Linear / Retool**：安静、信息密度优先、主色克制。
数据（价格、型号、数字）是主角，UI 退到背景。

## Color Tokens

**中性色（slate 系，占 90%+ 屏幕面积）：**

| Token | 值 | 用途 |
| --- | --- | --- |
| `bg-app` | `#f8fafc` (slate-50) | 页面背景（body） |
| `bg-surface` | `#ffffff` | 卡片、面板、表格 |
| `bg-subtle` | `#f1f5f9` (slate-100) | 表头、次级底、hover 底 |
| `border` | `#e2e8f0` (slate-200) | 所有边框、分隔线 |
| `text-primary` | `#0f172a` (slate-900) | 标题、正文强调 |
| `text-secondary` | `#475569` (slate-600) | 正文 |
| `text-muted` | `#94a3b8` (slate-400) | 辅助说明、占位符 |

**主色（violet，占屏 <10%）：**

| Token | 值 | 用途 |
| --- | --- | --- |
| `primary` | `#7c3aed` (violet-600) | 主 CTA 按钮、活跃导航、焦点环、关键链接 |
| `primary-hover` | `#6d28d9` (violet-700) | 主按钮 hover |
| `primary-subtle` | `#f5f3ff` (violet-50) | 活跃项底色、选中态 |
| `primary-border` | `#ddd6fe` (violet-200) | 焦点边框、选中边框 |

**语义色（只用于状态，不做装饰）：**
success `#059669` (emerald-600) / warning `#d97706` (amber-600) / danger `#dc2626` (red-600)，各配 50 号浅底。

**Tailwind 遗留 token 映射**（tailwind.config.ts 中旧名已重新指向新值，旧类名可继续工作但新代码用语义写法）：
`ink→#0f172a`、`paper→#ffffff`、`line→#e2e8f0`、`cream→#f1f5f9`、`leaf→#7c3aed`（deprecated，新代码写 `primary`）。

## Typography

| 层级 | 规格 | 用途 |
| --- | --- | --- |
| H1 | 24px / semibold | 页面标题 |
| H2 | 18px / semibold | 区块标题 |
| Body | 14px / normal / lh 1.5 | 默认正文 |
| Data | 13px | 表格单元格 |
| Caption | 12px / text-muted | 辅助说明、表头文字 |

数字列一律 `tabular-nums`。

## Spacing

4px 基准：**4 / 8 / 12 / 16 / 24 / 32 / 48**。页面内容区 padding 24px，卡片内 padding 16px，表格单元格 12px 8px。禁止刻度外的随机值。

## Radius & Shadow

- 徽章/标签 `rounded-md` (6px)、按钮/输入框 `rounded-lg` (8px)、卡片/面板 `rounded-xl` (12px)
- 阴影只有一档：`shadow-panel`（很轻）。hover 时可升到 `shadow-md`。禁止叠加大阴影

## 组件规则

**按钮（只有三档）：**
1. Primary：`bg-primary text-white hover:bg-primary-hover rounded-lg`，纯色**无渐变**。每屏至多 1-2 个
2. Secondary：`bg-white border border-line text-secondary hover:border-primary-border rounded-lg`
3. Ghost/危险：无底色文字按钮；危险操作 hover 变 danger 色

**表格：**
- 表头：`bg-subtle text-secondary text-xs font-semibold`（**禁止深色块表头**——墨绿 `#3F4A35` 和渐变紫表头均已废弃）
- 行分隔 `border-line`，hover 行 `bg-subtle/60`
- 数字右对齐 + tabular-nums

**表单：** 输入框 `border-line rounded-lg`，focus `border-primary-border ring-2 ring-primary-subtle`。

**状态：** 每个列表/面板必须有 empty state（居中灰字 + 引导动作）、loading（spinner + 文字）、error（danger 浅底条）。

## Do / Don't

- ✅ 渐变**只允许一处**：chat 欢迎页 logo（品牌记忆点）
- ❌ 玻璃拟态（backdrop-blur）、大面积渐变背景
- ❌ emoji 当图标——一律 lucide（16px，`text-muted` 或语义色）
- ❌ 深色块表头、深色大按钮（`bg-ink` 按钮全部改 primary 或 secondary）
- ❌ 主色用于装饰性元素（边框光晕、大底色块）
- ❌ 刻度外的间距、token 外的颜色（包括写死的 hex）

## 页面结构

- Admin 页：H1 + 一句描述 + 右上主操作按钮 → 筛选区（卡片）→ 数据区（卡片/表格）
- 内容区最大宽度：表格页 `max-w-7xl`，表单/详情页 `max-w-6xl`，chat 对话流 `max-w-3xl`
