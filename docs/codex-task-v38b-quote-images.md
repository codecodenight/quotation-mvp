# V38B: 报价单产品图片嵌入

## 背景

产品库中 7,220/9,807 (74%) 产品有缩略图（JPEG, 300px 宽，存于 `data/images/source/`）。但报价管线（预览 + 导出）完全没有图片：Prisma 查询不选 `imagePath`，`QuoteWorkbookItem` 没有此字段，`QuoteTableModel` 也没有图片列。

V38A 已建立共享 `QuoteTableModel`。V38B 在这个模型上加图片列，预览显示缩略图，Excel 嵌入图片。

## 目标

- 预览表格第一列显示产品缩略图
- Excel 导出第一列嵌入产品图片
- 无图产品留空列
- 预览和导出的列一致（符合 V38A 原则）

## 数据流打通

### 1. Prisma 查询加 `imagePath`

`src/app/(admin)/quotes/actions.ts` 中的 `prepareQuoteItems` 函数：

```typescript
// 在 product include 中加：
product: {
  include: {
    params: { select: { ... } },
  },
  // 不需要额外 select，include 默认返回所有标量字段，包括 imagePath
},
```

确认：`product` 使用的是 `include`（不是 `select`），所以 `imagePath` 已经在返回值中。但需要确认 `previewQuote` 路径也能拿到它。

检查 `previewQuote` 中构建 items 的地方，确保 `imagePath` 被传入 `QuotePreviewItem`。

### 2. `QuoteWorkbookItem` 加 `imagePath`

`src/lib/quote-export.ts`：

```typescript
export type QuoteWorkbookItem = {
  // ...existing fields...
  imagePath?: string | null;
};
```

### 3. `QuotePreviewItem` 传递 `imagePath`

`src/lib/quote-preview.ts` 中 `QuotePreviewItem` extends `Omit<QuoteWorkbookItem, "salePrice">`，所以自动获得 `imagePath`。

确认 `previewQuote`（actions.ts）在构建 items 时包含 `imagePath: offer.product.imagePath`。

### 4. `createQuote`（actions.ts）在构建 `QuoteWorkbookData` 时也要传 `imagePath`

## QuoteTableModel 加图片列

### `src/lib/quote-table-model.ts`

#### 新增图片列类型

`QuoteTableColumn` 已有 `key / header / width / align / numFmt`。图片不需要新字段——用 `key: "image"` 即可。图片路径存在 `cells.image` 中（string 类型的文件路径）。

#### 列插入

品类模板和 generic 都在第一列插入图片列：

```typescript
const imageColumn: QuoteTableColumn = {
  key: "image",
  header: "Photo",
  width: 12,
  align: "center",
};
```

在 `buildTemplateColumns` 和 `buildGenericColumns` 中，将 `imageColumn` 插入到 columns 数组的最前面。

#### 行数据

`buildTemplateRowCells` 和 `buildGenericRowCells` 中，加入：

```typescript
cells.image = item.imagePath ?? null;
```

`QuoteWorkbookItem` 的 `imagePath` 被传入 `buildTemplateItem` 时也要传递。在 `QuoteTemplateItem` 中加 `imagePath?: string | null`，`buildTemplateItem` 中赋值。

模板的 `buildRowCells` 返回值也要加 `image: item.imagePath ?? null`。

**注意**：不要在 29 个模板的 `buildRowCells` 中各自加 `image`。图片是通用列，应该在 `buildTemplateRowCells`（quote-table-model.ts）中统一加入，和 `factoryName`/`purchasePrice` 的处理方式一样。

## HTML 预览显示缩略图

### `src/app/(admin)/quotes/quotes-client.tsx`

`formatPreviewCell` 函数中，对 `image` 列特殊处理：

```typescript
function formatPreviewCell(value: unknown, column: QuotePreviewData["columns"][number]): React.ReactNode {
  if (column.key === "image") {
    if (!value || typeof value !== "string") {
      return "-";
    }
    return <img src={`/api/images?path=${encodeURIComponent(String(value))}`} alt="" className="h-12 w-12 object-contain" />;
  }
  // ...existing logic...
}
```

**注意**：`formatPreviewCell` 当前返回 `string`，需要改返回类型为 `React.ReactNode`。

产品图片已有 API 路由吗？检查 `src/app/(admin)/api/images/` 是否存在。如果不存在，需要新建一个简单的图片代理 route：

```typescript
// src/app/(admin)/api/images/route.ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imagePath = searchParams.get("path");
  if (!imagePath || !existsSync(imagePath)) {
    return new NextResponse(null, { status: 404 });
  }
  const buffer = await readFile(imagePath);
  return new NextResponse(buffer, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
```

如果已有图片服务路由，复用它。

## Excel 嵌入图片

### `src/lib/quote-export.ts`

在 `writeQuoteWorkbook`（generic 路径）和 `writeTemplatedQuoteWorkbook`（模板路径）中，写完行数据后，遍历 model.rows 嵌入图片：

```typescript
import { readFileSync, existsSync } from "node:fs";

// 在写完所有行之后：
const imageColumnIndex = columns.findIndex(col => col.key === "image");
if (imageColumnIndex >= 0) {
  for (let i = 0; i < model.rows.length; i++) {
    const imagePath = model.rows[i].cells.image;
    if (typeof imagePath !== "string" || !imagePath || !existsSync(imagePath)) {
      continue;
    }
    try {
      const buffer = readFileSync(imagePath);
      const imageId = workbook.addImage({ buffer, extension: "jpeg" });
      sheet.addImage(imageId, {
        tl: { col: imageColumnIndex, row: dataStartRow + i - 1 },
        ext: { width: 60, height: 60 },
      });
    } catch {
      // 图片读取失败，留空
    }
  }
}
```

其中 `dataStartRow`：
- generic 路径：数据从第 8 行开始（index 7）
- 模板路径：数据从第 2 行开始（index 1）

行高需要调整以容纳图片：
- generic 路径：已有 `row.height = 54`，足够
- 模板路径：当前 `row.height = 22`，需要改为 `Math.max(22, 50)`（有图时扩展）

图片列宽也需要调整：`width: 12` 对应约 86px，足够 60px 图片。

## 测试

### `src/lib/quote-table-model.test.ts` 新增

```
- 有 imagePath 的产品 → model.rows[0].cells.image 等于路径字符串
- 无 imagePath 的产品 → model.rows[0].cells.image 为 null
- columns 第一列是 { key: "image", header: "Photo" }
- customerMode=false 时 image 仍在第一列（在 factoryName 之前）
```

### 现有测试

现有 `quote-table-model.test.ts` 和 `quote-export.test.ts` 中的 fixture 不含 `imagePath`，应该继续通过（`imagePath` 是可选字段，缺失时 cells.image = null）。

## 验证

```bash
npx vitest run
npx next build
```

用验收脚本生成一个含图片产品的 Excel，打开确认图片嵌入在第一列。

## 不做
- 不改数据模型
- 不改 Chat
- 不改 DeepSeek prompt
- 不删除任何数据
- 不做图片缺失警告（V38C 范围）
- 不做图片裁剪/缩放处理（直接用现有 300px 缩略图）
