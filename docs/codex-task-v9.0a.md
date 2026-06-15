# V9.0A — 对话界面 UI 修复

## 背景

V9.0 功能已跑通（DeepSeek tool_use + 产品查询 + 卡片渲染），但有 3 个 UI 问题需要修复。

## 问题清单

### 1. Markdown 文字未渲染（最高优先级）

LLM 返回的文字包含 Markdown 格式（`### 标题`、`**粗体**`、`| 表格 |`），但前端用 `whitespace-pre-wrap` 原样显示了，没有转成 HTML。

**修复**：

安装 `react-markdown`：
```bash
npm install react-markdown
```

在 `chat-client.tsx` 中，把 assistant 消息的文字渲染从：
```tsx
<div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
```

改为：
```tsx
import ReactMarkdown from "react-markdown";

// assistant 消息用 ReactMarkdown 渲染，user 消息保持纯文字
{isUser ? (
  <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
) : (
  <div className="prose prose-sm prose-stone max-w-none">
    <ReactMarkdown>{message.text}</ReactMarkdown>
  </div>
)}
```

需要确保 Tailwind 的 `@tailwindcss/typography` 插件已启用（提供 `prose` class）。如果没有启用，安装并在 tailwind config 中加入。如果不想引入 typography 插件，也可以手动给 ReactMarkdown 内的元素写样式。

### 2. 管理侧边栏在 /chat 页面露出

根 layout 包含 `<Sidebar />`，chat 页面用 `fixed inset-0 z-50` 覆盖，但侧边栏图标仍然从左边缘露出。

**修复**：用 Next.js route group 分离布局。

#### 步骤：

1. 创建 `src/app/(admin)/layout.tsx`——包含 Sidebar 的布局：
```tsx
import { Sidebar } from "@/components/sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
    </div>
  );
}
```

2. 把所有现有页面目录移入 `(admin)/`：
```
src/app/(admin)/page.tsx            ← 原 src/app/page.tsx
src/app/(admin)/products/           ← 原 src/app/products/
src/app/(admin)/quotes/             ← 原 src/app/quotes/
src/app/(admin)/customer-quotes/    ← 原 src/app/customer-quotes/
src/app/(admin)/data-quality/       ← 原 src/app/data-quality/
src/app/(admin)/import/             ← 原 src/app/import/
src/app/(admin)/files/              ← 原 src/app/files/
src/app/(admin)/scan/               ← 原 src/app/scan/
src/app/(admin)/triage/             ← 原 src/app/triage/
```

3. 把 API routes 也移入 `(admin)/`：
```
src/app/(admin)/api/                ← 原 src/app/api/
```

注意：Next.js route group `(admin)` 不影响 URL——`/products` 仍然是 `/products`，`/api/quotes/...` 仍然是 `/api/quotes/...`。

4. 修改根 layout `src/app/layout.tsx`，去掉 Sidebar：
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Supplier Quotation MVP",
  description: "Local supplier quotation management tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

5. `src/app/chat/layout.tsx` 保持不变（已有独立 layout）。

6. `src/app/chat/chat-client.tsx` 中去掉 `fixed inset-0 z-50`——不再需要覆盖侧边栏了：
```tsx
// 从
<div className="fixed inset-0 z-50 flex bg-[#f7f3e8] text-ink">
// 改为
<div className="flex min-h-screen bg-[#f7f3e8] text-ink">
```

#### 注意

移动文件后，检查所有 `import` 路径是否仍然正确。`@/` alias 指向 `src/`，所以 `@/lib/...`、`@/components/...` 不受影响。`./actions` 等相对路径也不受影响（文件跟着目录一起移动）。但需要确认：
- `src/app/(admin)/quotes/actions.ts` 中 `import ... from "./actions"` 仍然有效
- `src/app/chat/actions.ts` 中 `import { createQuote, previewQuote } from "@/app/quotes/actions"` 改为 `from "@/app/(admin)/quotes/actions"`

### 3. 空结果提示文字模糊

当 DeepSeek 同时调用 `search_products` 和 `search_customer_history`，历史搜索无结果时显示"没有找到匹配产品"，容易跟产品搜索混淆。

**修复**：在 `chat-client.tsx` 中按 tool 类型显示不同的空结果文字：

```tsx
// ProductCardList 空结果
"没有找到匹配产品。"

// HistoryTable 空结果
"没有找到历史客户报价记录。"

// FactoryComparisonCard 空结果
"没有找到该品类的工厂报价对比。"
```

这些文字已经在现有代码中，但 `HistoryTable` 的文字是"没有找到历史客户报价"，`FactoryComparisonCard` 是"没有可对比的工厂报价"。确认这些保持不变即可（它们已经是正确的）。

问题出在 `ToolResultView` 里对 `search_products` 空结果的显示——当 `search_customer_history` 返回空结果时，也可能显示了 `ProductCardList` 的空结果提示。检查 `ToolResultView` 的 switch 逻辑是否正确匹配 `toolName`。

## 验证

1. `/chat` 页面不再显示管理侧边栏
2. `/products`、`/quotes` 等管理页面仍有侧边栏，功能正常
3. LLM 文字回复中 `**粗体**`、`### 标题`、表格都正确渲染
4. 用户消息仍然是纯文字气泡
5. API routes（`/api/products/[id]/image`、`/api/quotes/[id]/download`）仍然可访问
6. 空历史结果显示"没有找到历史客户报价"而非"没有找到匹配产品"

## Commit

`V9.0A: fix markdown rendering, separate chat layout, clarify empty results`
