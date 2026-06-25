# V39: Chat 报价草稿增加预览和门禁

## 背景

Chat 已有"加入→报价草稿→生成报价单→下载"的基本流程（`chat-client.tsx` 的 `DraftItem` + `generateQuoteFromChatDraft`）。但和 quotes 页面相比缺少几个关键能力：

1. **无预览**：点"生成报价单"直接导出 Excel，用户看不到格式化后的表格和警告
2. **无价格门禁**：V38C 的 `suspicious_low` 确认只在 quotes 页面，Chat 完全没有
3. **无 customerMode**：硬编码 `customerMode: true`，不能切换内部/客户模式
4. **无警告**：用户在生成前看不到 quote-health 的任何警告

## 目标

- 草稿面板增加"预览"按钮，点击后显示 `QuotePreviewData` 表格（复用 quotes 页面的 preview 渲染逻辑）
- 预览中显示警告统计（tierCounts badge）
- 有 `suspicious_low` 时弹出确认对话框，用户确认后才能生成
- 增加 customerMode 开关
- "生成报价单"改为两步：先预览 → 再确认生成

## 实现

### 1. 草稿面板增加预览状态

`src/app/chat/chat-client.tsx`：

```typescript
const [draftPreview, setDraftPreview] = useState<QuotePreviewData | null>(null);
```

在 `QuoteSettings` 中加 `customerMode`:

```typescript
type QuoteSettings = {
  customerName: string;
  profitMargin: string;
  currency: string;
  exchangeRate: string;
  customerMode: boolean;  // ← 新增
};
```

默认值 `customerMode: true`。

### 2. 预览操作

新增 `previewDraft` 函数，调用 `previewQuote` server action：

```typescript
async function previewDraft() {
  const formData = buildCurrentDraftFormData();
  const preview = await previewQuote(formData);
  setDraftPreview(preview);
}
```

**注意**：`previewQuote` 已经在 `@/app/(admin)/quotes/actions` 中导出。Chat 的 `actions.ts` 已经 import 了它（`generateQuoteFromChatDraft` 内部调用了 `previewQuote`）。需要把 `previewQuote` 也从 Chat actions 导出，或者直接在 chat-client.tsx 中 import quotes/actions 的 `previewQuote`。

但要注意：chat-client.tsx 是客户端组件（"use client"），不能直接 import server action。应该在 `src/app/chat/actions.ts` 中增加一个 `previewChatDraft` 导出函数：

```typescript
export async function previewChatDraft(input: ChatQuoteDraftInput): Promise<QuotePreviewData> {
  const formData = buildChatQuoteFormData(input);
  return previewQuote(formData);
}
```

### 3. 草稿面板 UI 改动

当前草稿面板（`DraftPanel` 组件）底部有一个"生成报价单"按钮。改为两个阶段：

**阶段一：无预览时**
- 显示"预览报价"按钮（主按钮）
- 点击后调用 `previewChatDraft`，展示预览表格

**阶段二：有预览时**
- 显示预览表格（columns + rows，复用 `formatPreviewCell` 的逻辑）
- 显示警告 badge（tierCounts）
- 显示"生成报价单"按钮（主按钮）+ "重新预览"（次按钮）
- 点击"生成报价单"时检查 suspicious_low 门禁

**预览表格渲染**：不需要完全复制 quotes-client.tsx 的 PreviewRow 组件。用一个简化版表格即可：

```tsx
<div className="overflow-x-auto">
  <table className="w-full text-xs">
    <thead>
      <tr>
        {draftPreview.columns.map(col => (
          <th key={col.key} className="px-2 py-1 text-center bg-stone-100">{col.header}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {draftPreview.rows.map((row, i) => (
        <tr key={i} className={row.warnings.length > 0 ? "bg-amber-50" : ""}>
          {draftPreview.columns.map(col => (
            <td key={col.key} className="px-2 py-1 text-center border-t border-line">
              {formatChatPreviewCell(row.cells[col.key], col)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

图片列（`col.key === "image"`）显示为 `<img>` 缩略图，和 quotes 页面一样用 `/api/products/[id]/image` 路由。如果 image 路径不方便在 Chat 中渲染，可以跳过图片列（`col.key !== "image"` 过滤掉）。

### 4. customerMode 开关

在草稿面板的设置区域（customerName / profitMargin / currency / exchangeRate 输入框附近），加一个 checkbox：

```tsx
<label className="flex items-center gap-1.5 text-xs">
  <input
    type="checkbox"
    checked={!settings.customerMode}
    onChange={e => setSettings(s => ({ ...s, customerMode: !e.target.checked }))}
  />
  内部模式（显示工厂名+采购价）
</label>
```

将 `settings.customerMode` 传入 `previewChatDraft` 和 `generateQuoteFromChatDraft`。

### 5. suspicious_low 门禁

在 `generateQuote` 函数中，如果 `draftPreview` 有 suspicious_low 警告，弹出 `window.confirm`（和 quotes-client.tsx 的逻辑一致）。

### 6. 预览失效

当用户修改草稿内容（增删产品、改数量、改设置）时，清空 `draftPreview`：

```typescript
// 在 addDraftItem, removeDraftItem, updateDraftItem, setSettings 中加入：
setDraftPreview(null);
```

这样修改草稿后必须重新预览才能生成。

### 7. `ChatQuoteDraftInput` 加 `customerMode`

`src/app/chat/actions.ts` 中 `ChatQuoteDraftInput` 加 `customerMode?: boolean`。
`buildChatQuoteFormData` 中把 `customerMode` 写入 FormData（`formData.set("customerMode", input.customerMode ? "on" : "")`）。

## 验证

```bash
npm run test:quick
npx tsc --noEmit
```

注意：验证用 `npm run test:quick`（排除重型 exceljs 测试），不要用 `npm run test`（会超时）。

## 不做
- 不改 DeepSeek prompt 或工具定义
- 不改 quotes 页面
- 不改 QuoteTableModel 或 quote-export
- 不做 multi-turn 上下文（V41 范围）
- 不删除任何数据
- 不做数据模型变更
