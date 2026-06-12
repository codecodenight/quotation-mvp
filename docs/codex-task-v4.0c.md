# Codex Task: V4.0C — 报价 Product Details 参数化生成

## 目标

报价预览和导出 Excel 的 "Product Details" 列，优先用 `product_params` 生成稳定、客户可读的英文规格描述。没有足够结构化参数时 fallback 到现有 `remark + size` 逻辑。

**不改数据库。不改价格公式。不改报价模板列结构。不改 product_params 数据。**

---

## 当前状态

### Product Details 生成逻辑

`src/lib/quote-export.ts` 第 253 行：

```ts
export function buildProductDetails(item: QuoteWorkbookItem): string {
  const remark = stripModelPrefix(item.productRemark?.trim() ?? "", item.modelNo);
  const productName = stripModelPrefix(item.productName?.trim() ?? "", item.modelNo);
  const size = item.size?.trim() ?? "";
  const details = remark || productName;

  if (details && size) {
    return `${details}\nSize: ${size}`;
  }
  if (details) {
    return details;
  }
  return size;
}
```

问题：
- 投光灯 remark 是原始 Key:Value 格式（`Watt: 10W\nPF: 0.9\n...`），质量还行但顺序不受控
- 面板灯很多 remark 为空，只显示 model_no（对客户无意义）
- 灯带 remark 是 `Description: Item：5M LED RGB Strip Light...` 格式，杂乱
- Size 和 remark 可能有重复信息

### 调用路径（3 处）

1. **Excel 导出**：`readQuoteCellValue("productDetails", item)` → `buildProductDetails(item)`
2. **预览**：`quote-preview.ts` 第 86 行 → `buildProductDetails({ ...item, salePrice })`
3. **历史报价详情**：`quote-history.ts` 第 175 行 → `buildProductDetails({...})`

### 数据流

`prepareQuoteItems()` 在 `src/app/quotes/actions.ts` 第 276 行：
- 查询 `prisma.supplierOffer.findMany({ include: { product: true } })`
- 映射到 `QuoteWorkbookItem`，其中 `productRemark = offer.product.remark`
- **目前不加载 `product.params`**

---

## 改动范围

### 1. 新建 `src/lib/product-details-builder.ts`

核心函数：

```ts
import type { ProductParamDisplay } from "./product-param-display";

export type ProductDetailsParam = Pick<ProductParamDisplay, "paramKey" | "normalizedValue" | "unit" | "rawValue">;

export function buildProductDetailsFromParams(params: ProductDetailsParam[]): string | null
```

**输出格式**（每行一个参数，Key: Value 格式）：

```
Power: 18W
CCT: 3000-6500K
IP: IP65
Size: 90×66×23mm
Material: Aluminum
Beam Angle: 110°
PF: 0.9
Luminous Efficacy: 80-90 lm/W
Voltage: AC220-240V
```

**参数输出顺序**（固定）：

| 优先级 | param_key | 英文标签 | 格式化规则 |
|---:|---|---|---|
| 1 | watts | Power | `{normalizedValue}{unit}` → `18W` |
| 2 | cct | CCT | `{normalizedValue}{unit}` → `3000-6500K` |
| 3 | ip | IP | `{normalizedValue}` → `IP65` |
| 4 | size_display | Size | `{normalizedValue}` → `90×66×23mm` |
| 5 | material | Material | `{normalizedValue}` → `Aluminum` |
| 6 | beam_angle | Beam Angle | 末尾无 ° 则补 → `110°` |
| 7 | pf | PF | `{normalizedValue}` → `0.9` |
| 8 | luminous_efficacy | Luminous Efficacy | `{normalizedValue}{unit}` → `80-90 lm/W` |
| 9 | voltage | Voltage | `{normalizedValue}` → `AC220-240V` |
| 10 | led_type | LED Type | `{normalizedValue}` → `SMD2835` |
| 11 | leds_per_meter | LEDs/m | `{normalizedValue}` → `120` |
| 12 | color | Color | `{normalizedValue}` → `RGB` |
| 13 | panel_size | Panel Size | `{normalizedValue}` → `600×600` |
| 14 | cutout_mm | Cutout | `{normalizedValue}{unit}` → `75mm` |
| 15 | cri | CRI | `{normalizedValue}` → `Ra80` |

**规则**：
- 只输出上表中列出的 param_key（忽略 `length_mm`, `width_mm`, `height_mm`, `diameter_mm` 等——这些已被 `size_display` 覆盖）
- 跳过 `normalizedValue` 为空或 null 的参数
- 每行格式：`{英文标签}: {格式化值}`
- 行之间用 `\n` 分隔
- 返回 `null` 如果有效行数 < 2（不够组成有意义的描述）

### 2. 修改 `src/lib/quote-export.ts`

**QuoteWorkbookItem 扩展**：

```ts
export type QuoteWorkbookItem = {
  // ... existing fields ...
  productParams?: ProductDetailsParam[];  // NEW — optional
};
```

**buildProductDetails 改造**：

```ts
export function buildProductDetails(item: QuoteWorkbookItem): string {
  // 1. 尝试参数化生成
  if (item.productParams && item.productParams.length > 0) {
    const paramDetails = buildProductDetailsFromParams(item.productParams);
    if (paramDetails) {
      return paramDetails;
    }
  }

  // 2. Fallback: 现有 remark + size 逻辑（完全不变）
  const remark = stripModelPrefix(item.productRemark?.trim() ?? "", item.modelNo);
  const productName = stripModelPrefix(item.productName?.trim() ?? "", item.modelNo);
  const size = item.size?.trim() ?? "";
  const details = remark || productName;

  if (details && size) {
    return `${details}\nSize: ${size}`;
  }
  if (details) {
    return details;
  }
  return size;
}
```

注意：`productParams` 是 optional 的。所有不传 params 的调用方（比如现有测试、历史报价）自动走 fallback。

### 3. 修改 `src/app/quotes/actions.ts`

**prepareQuoteItems 加载 params**：

```ts
const offers = await prisma.supplierOffer.findMany({
  where: { id: { in: offerIds } },
  include: {
    product: {
      include: {
        params: {
          select: {
            paramKey: true,
            rawValue: true,
            normalizedValue: true,
            unit: true,
            confidence: true,
          },
        },
      },
    },
  },
});
```

**createQuote 和 previewQuote 传递 params**：

在映射 `QuoteWorkbookItem` 时增加：

```ts
productParams: offer.product.params.map(p => ({
  paramKey: p.paramKey,
  rawValue: p.rawValue,
  normalizedValue: p.normalizedValue,
  unit: p.unit,
})),
```

### 4. 修改 `src/lib/quote-history.ts`

**serializeQuoteDetailItem 加载 params**：

`getQuoteDetail` 的 Prisma 查询需要也 include `product.params`。`serializeQuoteDetailItem` 映射时传递 `productParams`。

修改 `src/app/quotes/actions.ts` 中 `getQuoteDetail` 的查询：

```ts
include: {
  items: {
    include: {
      product: {
        include: {
          params: {
            select: { paramKey: true, rawValue: true, normalizedValue: true, unit: true, confidence: true },
          },
        },
      },
      supplierOffer: true,
    },
  },
},
```

`serializeQuoteDetailItem` 在 `quote-history.ts` 中调用 `buildProductDetails` 时传入 params。需要扩展 `QuoteDetailItemRow` 类型以包含 `product.params`。

---

## Size 去重规则

如果 `productParams` 中有 `size_display`，则不再额外输出 `Size: {item.size}`——因为 `buildProductDetailsFromParams` 已经输出了 `Size: 90×66×23mm`。

如果 `productParams` 中没有 `size_display` 但 `item.size` 有值，且参数化生成成功（≥2 行），则在参数化输出末尾追加 `Size: {item.size}`。

实现方式：修改 `buildProductDetails`：

```ts
if (item.productParams && item.productParams.length > 0) {
  const paramDetails = buildProductDetailsFromParams(item.productParams);
  if (paramDetails) {
    const hasSizeDisplay = item.productParams.some(p => p.paramKey === "size_display" && p.normalizedValue);
    const size = item.size?.trim();
    if (!hasSizeDisplay && size) {
      return `${paramDetails}\nSize: ${size}`;
    }
    return paramDetails;
  }
}
```

---

## 测试

### 新建 `src/lib/product-details-builder.test.ts`

```ts
test("generates structured details from params", () => {
  const result = buildProductDetailsFromParams([
    { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
    { paramKey: "ip", normalizedValue: "IP65", unit: null, rawValue: "IP65" },
    { paramKey: "cct", normalizedValue: "3000-6500", unit: "K", rawValue: "3000-6500K" },
    { paramKey: "voltage", normalizedValue: "AC220-240V", unit: "V", rawValue: "AC220-240V" },
    { paramKey: "size_display", normalizedValue: "90×66×23mm", unit: null, rawValue: "90*66*23" },
  ]);

  expect(result).toBe(
    "Power: 18W\nCCT: 3000-6500K\nIP: IP65\nSize: 90×66×23mm\nVoltage: AC220-240V"
  );
});

test("returns null when fewer than 2 displayable params", () => {
  expect(buildProductDetailsFromParams([
    { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
  ])).toBeNull();
});

test("skips params with empty normalized value", () => {
  const result = buildProductDetailsFromParams([
    { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
    { paramKey: "ip", normalizedValue: "", unit: null, rawValue: "" },
    { paramKey: "cct", normalizedValue: "3000", unit: "K", rawValue: "3000K" },
  ]);

  expect(result).toBe("Power: 18W\nCCT: 3000K");
});

test("ignores unknown param keys", () => {
  const result = buildProductDetailsFromParams([
    { paramKey: "watts", normalizedValue: "18", unit: "W", rawValue: "18W" },
    { paramKey: "length_mm", normalizedValue: "300", unit: "mm", rawValue: "300" },
    { paramKey: "height_mm", normalizedValue: "55", unit: "mm", rawValue: "55" },
    { paramKey: "cct", normalizedValue: "4000", unit: "K", rawValue: "4000K" },
  ]);

  expect(result).toBe("Power: 18W\nCCT: 4000K");
});

test("appends degree sign to beam_angle if missing", () => {
  const result = buildProductDetailsFromParams([
    { paramKey: "watts", normalizedValue: "50", unit: "W", rawValue: "50W" },
    { paramKey: "beam_angle", normalizedValue: "120", unit: null, rawValue: "120" },
  ]);

  expect(result).toBe("Power: 50W\nBeam Angle: 120°");
});
```

### 修改 `src/lib/quote-preview.test.ts`

现有测试不传 `productParams`，应继续通过（fallback 逻辑不变）。

可选：增加一个带 `productParams` 的 preview 测试，验证输出用参数化格式。

---

## 不做的事

- 不改数据库 schema
- 不改报价模板列结构（Product Details 仍是一列）
- 不改价格公式
- 不改 product_params 数据
- 不加 "参数版 vs remark 版" 切换功能（V4.0C 直接用参数版，有参数就用，没有就 fallback）
- 不改前端 UI（预览表格渲染 productDetails 的方式不变）

---

## 验收标准

1. **有参数的投光灯**：Product Details 输出 `Power: 10W\nCCT: 6000-6500K\nIP: IP65\nSize: 90×66×23mm\nBeam Angle: 110°\nPF: 0.9\nLuminous Efficacy: 80-90 lm/W\nVoltage: AC220-240V`（顺序固定，格式干净）
2. **参数少于 2 的面板灯**：fallback 到 remark + size（和 V4.0B 前行为一致）
3. **无参数的旧产品**：完全 fallback 到现有逻辑，不报错
4. **Size 不重复**：有 `size_display` 参数时不额外输出 `Size: {raw size}`
5. **预览和 Excel 一致**：预览里看到的 Product Details 和导出 Excel 完全一致
6. **历史报价详情**：也使用参数化生成（如果产品当前有 params）
7. **现有测试不破坏**：`quote-preview.test.ts` 等现有测试继续通过
8. **新测试**：`product-details-builder.test.ts` 覆盖参数化生成、fallback、去重、边界场景
9. **tsc / lint / build / test** 全部通过

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v4.0c-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 新建参数化构建器

新建 `src/lib/product-details-builder.ts` + `src/lib/product-details-builder.test.ts`。

### Step 3: 修改 buildProductDetails

修改 `src/lib/quote-export.ts`：
- `QuoteWorkbookItem` 加 optional `productParams`
- `buildProductDetails` 增加参数化分支 + Size 去重

### Step 4: 修改数据加载

修改 `src/app/quotes/actions.ts`：
- `prepareQuoteItems` include `product.params`
- `createQuote` 和 `previewQuote` 映射时传 `productParams`
- `getQuoteDetail` include `product.params`

### Step 5: 修改历史报价

修改 `src/lib/quote-history.ts`：
- `QuoteDetailItemRow` 类型扩展包含 `product.params`
- `serializeQuoteDetailItem` 传递 `productParams` 给 `buildProductDetails`

### Step 6: 验证

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
```

手动验证：
- 开 dev server
- 选一个投光灯产品进报价 → 预览 → 检查 Product Details 是否为参数化格式
- 选一个无参数产品 → 预览 → 确认 fallback 正常
- 导出 Excel → 检查 Product Details 列内容和预览一致
- 查看一条历史报价详情 → 确认 Product Details 正确

### Step 7: 提交

```bash
git add src/lib/product-details-builder.ts src/lib/product-details-builder.test.ts src/lib/quote-export.ts src/lib/quote-history.ts src/app/quotes/actions.ts
git commit -m "V4.0C: generate Product Details from structured params with remark fallback"
```
