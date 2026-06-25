# V35: Chat UX 三合一打磨

## 部分 A：工具结果标签区分

### 问题
产品搜索卡和工厂对比卡连续排列，用户分不清哪组是什么。

### 修改 `src/app/chat/chat-client.tsx`

在 `ToolResultView` 函数中，在各 case 的 return 前加一个标签行。用一个 helper 映射 toolName → 标签文字：

```typescript
const TOOL_LABELS: Record<string, string> = {
  search_products: "🔍 产品搜索",
  compare_factories: "📊 工厂对比",
  get_product_offers: "💰 供应商报价",
  search_customer_history: "📋 历史报价",
};
```

修改 `ToolResultView` 的返回结构，在每个工具结果上方加标签：

```tsx
function ToolResultView({ result, ... }) {
  if ("error" in result.data) { ... }

  const label = TOOL_LABELS[result.toolName];

  return (
    <div>
      {label && (
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">
          {label}
        </div>
      )}
      {renderToolContent(result, ...)}
    </div>
  );
}
```

把原来 switch 里的内容提取到 `renderToolContent` 或直接内联都行，关键是标签 div 在内容之前。

## 部分 B：Wellux 核价标记

### 问题
384 条 `factory_name = 'Wellux'` 的 offer 实际来自客户核价汇总文件，不是工厂报价。

### 执行 SQL

```bash
sqlite3 prisma/dev.db "UPDATE supplier_offers SET factory_name = 'Wellux(客户核价)' WHERE factory_name = 'Wellux';"
```

### 验证

```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM supplier_offers WHERE factory_name = 'Wellux';"
# 期望：0
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM supplier_offers WHERE factory_name = 'Wellux(客户核价)';"
# 期望：384
```

## 部分 C：恢复 Turbopack dev 脚本

### 修改 `package.json`

把 dev 脚本从：
```json
"dev": "rm -rf .next && NODE_OPTIONS='--max-old-space-size=2048' next dev",
```
改为：
```json
"dev": "rm -rf .next/dev && NODE_OPTIONS='--max-old-space-size=2048' next dev --turbopack",
```

注意：
- `rm -rf .next/dev` 而不是 `rm -rf .next`，避免清掉生产 build 缓存
- 加回 `--turbopack`

## 验证

```bash
npx next build
```

Build 成功即可。

## 不做
- 不改数据模型
- 不改 DeepSeek prompt
- 不删除任何数据
- 不改排序逻辑
