# V31.1: Chat Markdown 表格渲染修复

## 问题
DeepSeek 返回的 Markdown 表格（GFM pipe table 语法）在 chat 页面原样显示为纯文本管道符号，没有渲染成 HTML 表格。

## 根因
`react-markdown` 默认只支持 CommonMark，不支持 GFM（GitHub Flavored Markdown）扩展。表格是 GFM 特性，需要 `remark-gfm` 插件。

## 修复步骤

### 1. 安装依赖
```bash
npm install remark-gfm
```

### 2. 修改 `src/app/chat/chat-client.tsx`

在文件顶部 import 区域添加：
```typescript
import remarkGfm from "remark-gfm";
```

找到 `<ReactMarkdown>` 调用（约第 354 行），改为：
```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
```

### 3. 验证
```bash
npx next build
```
Build 成功即可。

## 不做
- 不改其他文件
- 不改 Tailwind prose 样式（已经有 `prose-table` / `prose-th` / `prose-td` 样式）
- 不改 DeepSeek prompt
