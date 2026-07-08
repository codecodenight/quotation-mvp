# V50 — DESIGN.md + 全站视觉统一（Linear 式克制）

> **补录说明**：由 Claude Fable 5 于 2026-07-07 执行完成。用户决策：紫色系保留但按 Linear 式克制收敛；全站一次迁移。

## 完成内容

### 1. 新建根目录 `DESIGN.md`
所有后续 UI 改动的强制规范：slate 中性色 + violet-600 主色（占屏 <10%）、4px 间距刻度、三档按钮、浅灰表头、Do/Don't（禁玻璃拟态/大面积渐变/emoji 图标/深色表头，渐变仅允许 chat 欢迎页 logo 一处）。

### 2. Token 值替换迁移（关键手法）
`tailwind.config.ts` 旧 token 直接重指新值，全站 80% 样式一次迁移：
`ink→#0f172a`、`paper→#fff`、`line→#e2e8f0`、`cream→#f1f5f9`、`leaf→#7c3aed`（deprecated alias）、新增 `primary` 系列。`globals.css` 移除米色网格纸背景 → slate-50 纯色。

### 3. 批量替换（sed）
- 深色表头 `bg-[#3F4A35] ... text-white` → `bg-cream ... text-slate-600`（8 处；**Excel 导出里的 #3F4A35 是品牌色，未动**）
- 深色按钮 `bg-ink` → `bg-primary hover:bg-primary-hover`（23 处）
- 米色底 `bg-[#ebe5d8]` → `bg-cream`（10 处）

### 4. Chat 收敛
渐变按钮/气泡/avatar/表头 → 纯色 primary；玻璃拟态 header → 纯白；背景渐变移除；装饰性 violet 边框/浅底 → 中性（focus/hover 交互态保留 violet）；欢迎页 logo 恢复渐变（全站唯一）；工具标签 emoji（🔍📊💰📋）→ lucide 图标（测试同步更新）。

### 5. Sidebar
米色 → 白底 + slate 文字 + hover 浅灰。

## 遗留（可由 Codex 按 DESIGN.md 跟进）
- 各 admin 页仍有 stone-* 文字色（可用但非 slate 系）、rounded-md 按钮（DESIGN 说 rounded-lg），属渐进迁移项
- `leaf` 类名在代码中仍大量存在（值已是 violet），可逐步改名 `primary`
