# V38A: 统一报价渲染模型 QuoteTableModel

## 背景

当前报价输出有三套独立的列定义和值计算逻辑：
1. 通用导出（mixed categories）：`buildQuoteColumns` + `readQuoteCellValue`
2. 品类模板导出（single category）：`template.columns` + `template.writeRow`
3. HTML 预览：`buildQuotePreview` 硬编码列

三者互不知道对方存在，导致预览 ≠ 导出。品类模板路径还完全忽略 `customerMode`。

## 目标

建立统一的 `QuoteTableModel`，让预览和导出都从同一份 model 读列和值。

**验收标准**：同一组产品，预览表头、列序、单元格文本、价格格式、客户/内部模式与 Excel 完全一致。

## 新建 `src/lib/quote-table-model.ts`

### 类型定义

```typescript
export type QuoteCellValue = string | number | null;

export type QuoteTableColumn = {
  key: string;
  header: string;
  width: number;
  align?: "left" | "center" | "right";
  numFmt?: string;       // Excel 专用，如 '#,##0.00 "USD"'
};

export type QuoteTableRow = {
  productId: string;
  supplierOfferId: string;
  cells: Record<string, QuoteCellValue>;
  warnings: CategorizedWarning[];
};

export type QuoteTableModel = {
  templateId: string;          // "panel" | "downlight" | "generic" | ...
  customerMode: boolean;
  meta: {
    customerName: string;
    currency: string;
    profitMargin: number;
    exchangeRate: number | null;
    purchaseCurrency: string;
    createdAt: Date;
  };
  columns: QuoteTableColumn[];
  rows: QuoteTableRow[];
};
```

### 核心函数

```typescript
export function buildQuoteTableModel(
  quote: QuoteWorkbookData,
  options: { customerMode: boolean },
): QuoteTableModel
```

逻辑：
1. `findCategoryTemplate(quote)` 判断单品类 vs 混合
2. 单品类 → 调用 `template.buildRowCells(item, index)` 获取 keyed cells
3. 混合品类 → 调用 `buildGenericRowCells(item)` 获取 keyed cells
4. 如果 `customerMode === false`，在列定义中插入 `factoryName`（在 modelNo 之后）和 `purchasePrice`（在 salePrice 之前），并在每行 cells 中填入对应值
5. 调用 `checkQuoteItemHealth` 生成 warnings，附加到每行
6. 返回 `QuoteTableModel`

### 渲染规则

HTML 和 Excel 都用相同方式遍历：
```typescript
model.columns.map(column => row.cells[column.key])
```

## 修改品类模板

### 每个模板（29 个）新增 `buildRowCells`

以面板灯为例（`src/lib/quote-templates/panel.ts`）：

```typescript
export const panelTemplate: QuoteTemplateConfig = {
  // ...existing columns, writeRow, writeHeader...

  buildRowCells(item: QuoteTemplateItem, index: number): Record<string, QuoteCellValue> {
    return {
      no: index + 1,
      modelNo: item.modelNo ?? item.productName,
      power: appendSuffix(readParam(item, "watts"), "W"),
      size: readPanelSize(item),
      material: readParam(item, "material") || item.material || "",
      cct: formatCct(readParam(item, "cct")),
      cri: prefixValue(readParam(item, "cri"), "Ra"),
      pf: readParam(item, "pf"),
      voltage: appendSuffix(readParam(item, "voltage"), "V"),
      driver: readParam(item, "driver_type"),
      ip: prefixValue(readParam(item, "ip"), "IP"),
      salePrice: item.salePrice,
      moq: cleanMoq(item.moq),
      ctnQty: item.ctnQty ?? "",
      ctnSize: formatCtnSize(item),
      volume: calcVolume(item.ctnLength, item.ctnWidth, item.ctnHeight),
    };
  },
};
```

**关键要求**：`buildRowCells` 返回的 key 必须与 `columns[].key` 一一对应。

**不要删除旧的 `writeRow`**。保留它作为 fallback，直到测试验证新路径完全正确后再考虑移除（不在 V38A 范围内）。

### `QuoteTemplateConfig` 接口扩展

```typescript
export interface QuoteTemplateConfig {
  category: string;
  sheetName: string;
  columns: QuoteTemplateColumn[];
  writeRow: (ws: Worksheet, rowIndex: number, item: QuoteTemplateItem) => void;
  writeHeader?: (ws: Worksheet) => void;
  buildRowCells: (item: QuoteTemplateItem, index: number) => Record<string, QuoteCellValue>;
}
```

## 修改通用导出路径

### `src/lib/quote-export.ts`

新增 `buildGenericRowCells` 函数，返回 keyed cells（与现有 `readQuoteCellValue` 逻辑一致，但用 Record 而非 switch）。

`writeQuoteWorkbook` 改为：
1. 调用 `buildQuoteTableModel(quote, options)` 获取 model
2. 从 model 读取 columns 和 rows
3. 写入 Excel（样式逻辑不变）

`writeTemplatedQuoteWorkbook` 同理：
1. 从 model 读取 columns 和 rows
2. 用 `model.columns.map(col => row.cells[col.key])` 构建 `row.values`
3. 样式仍由通用格式化函数处理（不再调用 `template.writeRow`）

### 通用 Excel 格式化

将所有模板共享的格式化逻辑提取为一个函数：

```typescript
function applyDataRowStyle(
  row: ExcelJS.Row,
  priceColumnIndex: number,
  currency: string,
): void {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  });
  if (priceColumnIndex > 0) {
    row.getCell(priceColumnIndex).numFmt = `#,##0.00 "${currency}"`;
  }
}
```

价格列位置从 `model.columns.findIndex(c => c.key === "salePrice") + 1` 获取。

## 修改 HTML 预览

### `src/lib/quote-preview.ts`

`buildQuotePreview` 改为：
1. 调用 `buildQuoteTableModel(quote, options)` 获取 model
2. 从 model.rows 读取 cells 和 warnings
3. 返回 `QuotePreviewData`，其中 `rows` 直接引用 model 数据

`QuotePreviewData` 需要扩展：
- 新增 `columns: QuoteTableColumn[]` 字段
- 预览 UI 用 `columns` 渲染表头，而非硬编码

### `src/app/(admin)/quotes/quotes-client.tsx`

`QuotePreviewPanel` 改为从 `preview.columns` 动态渲染表头和行，而非硬编码：

```tsx
<thead>
  <tr>
    {preview.columns.map(col => (
      <th key={col.key} className="px-3 py-3">{col.header}</th>
    ))}
    <th className="px-3 py-3">检查</th>
  </tr>
</thead>
<tbody>
  {rows.map(row => (
    <tr key={row.productId}>
      {preview.columns.map(col => (
        <td key={col.key} className="px-3 py-3">
          {row.cells[col.key] ?? ""}
        </td>
      ))}
      <td>...warnings...</td>
    </tr>
  ))}
</tbody>
```

## `previewQuote` server action

`src/app/(admin)/quotes/actions.ts` 中的 `previewQuote`：
1. 构建 `QuoteWorkbookData`（包含 items + meta）
2. 调用 `buildQuoteTableModel(quote, { customerMode })` 获取 model
3. 从 model 构建 `QuotePreviewData` 返回给客户端

需要注意：`previewQuote` 现在需要给 items 计算 `salePrice` 后才传给 model builder，因为 model builder 需要 salePrice 填充价格列。当前 `previewQuote` 不计算 salePrice（它在 `buildQuotePreview` 内部算）。重构后 salePrice 的计算需要提前到 model builder 之前，或者 model builder 接受未计算的价格并自行调用 `calculateSalePrice`。

建议：让 model builder 接收与 `QuoteWorkbookData` 相同的输入（items 中包含 salePrice），由调用方负责提前算好 salePrice。这样 model builder 是纯数据变换，不含价格计算逻辑。

## 测试

### `src/lib/quote-table-model.test.ts`

用 fixture 锁定以下场景的列和值：

**场景 1：单品类面板灯 + customerMode=true**
- 验证 columns 等于面板灯模板列（No/Model/Power/Size/.../Volume）
- 验证 rows[0].cells 所有 key 有值
- 验证无 factoryName/purchasePrice 列

**场景 2：单品类面板灯 + customerMode=false**
- 验证 columns 在 modelNo 后有 factoryName，salePrice 前有 purchasePrice
- 验证 rows[0].cells.factoryName 有值
- 验证 rows[0].cells.purchasePrice 有值

**场景 3：混合品类 + customerMode=true**
- 验证走 generic 列（Model/ProductDetails/UnitPrice/MOQ/CTN/Volume/Remark）
- 验证无 factoryName/purchasePrice

**场景 4：混合品类 + customerMode=false**
- 验证有 factoryName/purchasePrice 列

**场景 5：预览和导出使用同一个 builder**
- 对同一组输入，分别调 preview 和 export 的 model builder
- 断言 columns 和 rows 的 cells key/value 完全一致

### 现有测试

`src/lib/quote-export.test.ts` 和 `src/lib/quote-preview.test.ts` 中的现有测试必须继续通过。

## 验证

```bash
npx vitest run
npx next build
```

## 不做
- 不加图片列（V38B）
- 不改 Chat
- 不改数据模型
- 不改 DeepSeek prompt
- 不删除任何数据
- **不删除旧的 `writeRow`**（保留至测试验证完毕）
- 不改 Excel 样式/颜色/字体（只改数据流向）
