# V45.1 — Chat UI 改版：Claude/ChatGPT 风格 + 渐变紫色调

> **补录说明**：本任务由 Claude Fable 5 于 2026-07-07 直接执行完成，此文档为事后补录的记录（非 Codex 执行指令）。

## 背景

/chat 是部署后的客户主入口，原 UI 是米色纸质风格 + 固定 header 布局，用户要求改成 Claude/ChatGPT 式的现代对话界面，渐变紫色调。

## 完成内容

### 1. 欢迎页 → 对话展开式布局
- 无对话时（`hasConversation === false`）：居中欢迎页 = 渐变紫 logo + 标题 + 4 个快捷提示卡片（带描述文字）+ 居中输入框
- 发送第一条消息后切换为对话模式：固定 header + 消息流 + 底部输入框

### 2. 视觉
- 色调：violet-600 → indigo-600 渐变（按钮、用户气泡、表头、avatar）
- 背景：`layout.tsx` 淡紫渐变 `#f8f5ff → white → #f3eeff`
- header/输入栏玻璃磨砂（`bg-white/70 backdrop-blur-xl`）
- 消息 fade-in-up 动画、加载 subtle-pulse（`globals.css` 新增 keyframes）

### 3. 布局修复（重要）
- 对话模式和欢迎页容器从 `min-h-screen` 改为 **`h-screen`**：视口锁定，消息在 `<section>` 内部滚动，header 和输入框始终可见。`min-h-screen` 会导致消息多时整页变长、body 滚动
- 欢迎页模式下报价草稿面板改为正确出现在右侧（原实现会被挤到页面底部）
- 新增 `messagesEndRef` 自动滚动到底部

## 改动文件
- `src/app/chat/chat-client.tsx`（主体重写，业务逻辑不动）
- `src/app/chat/layout.tsx`（背景渐变）
- `src/app/globals.css`（动画 keyframes）
- `tailwind.config.ts`（补 cream 色）

## 遗留问题（UI 评审 2026-07-07）
- **主色过量**：violet 渐变用在 avatar/按钮/表头/气泡/徽章，违反"主色只用于 CTA"原则
- **与 admin 割裂**：admin 九页仍是纸质+墨绿风格，全站两套设计语言
- **待办**：建立项目 DESIGN.md（tokens/spacing/type scale/Do-Don't），按其统一 chat + admin
