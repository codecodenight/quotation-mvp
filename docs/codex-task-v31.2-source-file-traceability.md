# V31.2: 产品卡源文件回溯

## 背景
用户在 chat 中看到产品卡（尤其是型号缺失的产品如 "10W (筒灯)"），需要能直接打开源 Excel 文件确认完整信息。数据链路已存在：`supplier_offers.source_file_id → files → absolute_path_snapshot`。98% 的 offer 有 source_file_id。

## 目标
在 chat 产品卡的 offer 信息旁显示源文件名，点击可打开源文件。

## 实现步骤

### 1. 扩展 ChatProductOffer 类型（`src/lib/chat-tools.ts`）

在 `ChatProductOffer` 类型中增加两个可选字段：
```typescript
export type ChatProductOffer = {
  id: string;
  factory_name: string;
  purchase_price: string;
  currency: string;
  moq: string | null;
  source_file_id: string | null;    // 新增
  source_file_name: string | null;  // 新增
};
```

同样给 `ProductOffersResult.offers` 数组元素加这两个字段。

### 2. 查询时 join files 表（`src/lib/chat-tools.ts`）

找到 `searchProducts` 函数中查询 `supplier_offers` 的地方，在 Prisma include 里加入 file 关联：
```typescript
supplierOffers: {
  include: { file: { select: { id: true, fileName: true } } },
  ...
}
```

注意：Prisma schema 中 `SupplierOffer` model 的 file 关联字段名可能是 `file` 或 `sourceFile`。先检查 `prisma/schema.prisma` 里 `SupplierOffer` 的关系字段名，用实际名称。

同样修改 `getProductOffers` 函数中的查询。

### 3. 新增 API 路由：打开源文件（`src/app/(admin)/api/files/[id]/open/route.ts`）

```typescript
import { exec } from "node:child_process";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";

import { resolveStoredFilePath } from "@/lib/file-paths";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
  const resolvedPath = await resolveStoredFilePath(file);
  try {
    await stat(resolvedPath);
  } catch {
    return NextResponse.json({ error: "源文件当前不可读取" }, { status: 404 });
  }
  exec(`open "${resolvedPath}"`);
  return NextResponse.json({ ok: true, fileName: file.fileName });
}
```

### 4. 修改 chat 产品卡 UI（`src/app/chat/chat-client.tsx`）

#### 4a. ProductCardList 组件
在 "推荐：工厂 / 价格" 那行下面，如果 `recommended_offer.source_file_name` 存在，增加一行显示源文件按钮：

```tsx
{product.recommended_offer?.source_file_id && (
  <button
    type="button"
    onClick={() => openSourceFile(product.recommended_offer!.source_file_id!)}
    className="mt-1 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-leaf"
    title={product.recommended_offer.source_file_name ?? ""}
  >
    <FileSpreadsheet size={12} />
    {product.recommended_offer.source_file_name ?? "源文件"}
  </button>
)}
```

`FileSpreadsheet` 已经 import 了（lucide-react）。

#### 4b. OfferComparisonTable 组件
在每行 offer 的工厂名下面，加源文件名（小字）：
```tsx
<div className="font-semibold">{offer.factory_name}</div>
{offer.source_file_name && (
  <button
    type="button"
    onClick={() => openSourceFile(offer.source_file_id!)}
    className="text-xs text-stone-400 hover:text-leaf truncate max-w-[200px]"
    title={offer.source_file_name}
  >
    📄 {offer.source_file_name}
  </button>
)}
```

#### 4c. openSourceFile 函数
在 `ChatClient` 组件内新增：
```typescript
async function openSourceFile(fileId: string) {
  try {
    const res = await fetch(`/api/files/${fileId}/open`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "无法打开文件");
    }
  } catch {
    alert("无法连接服务器");
  }
}
```

### 5. 验证

```bash
npx next build
```

Build 成功即可。

## 不做
- 不改 DeepSeek prompt
- 不改 products 页面（只改 chat）
- 不删除任何产品
- 不改文件下载 API（已有的 GET `/api/files/[id]` 保持不变）
