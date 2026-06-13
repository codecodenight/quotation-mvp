# Codex Task: V4.1 — 报价质量修复（3 个客户可见问题）

## 目标

修复真实报价验收中发现的 3 个客户可见质量问题：
1. 健康检查不认 `size_display` 参数，误报"缺 Size"
2. CCT 提取把 `6500±500K` 的容差 `500K` 当独立色温
3. Product Details fallback 漏出中文标签和包装尺寸

参考：`docs/v4.1-real-quote-acceptance-input.md`

## Fix 1: 健康检查识别 size_display 参数

### 文件：`src/lib/quote-health.ts`

**现状**：`buildProductIssues()` 只检查 `product.size?.trim()`，不看 `product_params`。

**改动**：

1. `QuoteHealthProductInput` 增加可选字段：

```typescript
export type QuoteHealthProductInput = {
  productName: string;
  modelNo: string | null;
  remark: string | null;
  size: string | null;
  hasSizeParam?: boolean;  // 新增：product_params 中是否有 size_display/length_mm/width_mm/height_mm
};
```

2. `buildProductIssues()` 改 size 检查逻辑：

```typescript
if (!product.size?.trim() && !product.hasSizeParam) {
  issues.push("缺 Size");
}
```

### 文件：调用方传入 `hasSizeParam`

在 `src/app/quotes/actions.ts` 或 quotes page 中构建 `QuoteHealthProductInput` 时，从 `product.params` 判断：

```typescript
const SIZE_PARAM_KEYS = new Set(["size_display", "length_mm", "width_mm", "height_mm"]);
const hasSizeParam = product.params?.some(p => SIZE_PARAM_KEYS.has(p.paramKey) && p.normalizedValue?.trim()) ?? false;
```

需要检查所有调用 `buildQuoteHealth` / `checkQuoteItemHealth` 的地方，确保传入 `hasSizeParam`。

### 测试：`src/lib/quote-health.test.ts`

新增测试：

```typescript
test("does not warn size when hasSizeParam is true", () => {
  const health = buildQuoteHealth({
    productName: "LS-R02A-30W",
    modelNo: "LS-R02A-30W",
    remark: "充电灯 30W",
    size: null,
    hasSizeParam: true,
    supplierOffers: [/* ... valid offer ... */],
  });
  expect(health.productIssues).not.toContain("缺 Size");
});
```

---

## Fix 2: CCT 提取过滤无效值

### 文件：`scripts/extract-params.ts`

**现状**：`extractCct()` 第 1394 行 lookbehind `(?<![\d-~/])` 不含 `±`，导致 `6500±500K` 中的 `500K` 被单独匹配。

**改动**（两道防线）：

**A. lookbehind 加 `±`**：

```typescript
// 旧
for (const match of value.matchAll(/(?<![\d-~/])(\d{3,5})\s*K\b/gi)) {
// 新
for (const match of value.matchAll(/(?<![\d\-~/±])(\d{3,5})\s*K\b/gi)) {
```

**B. 最低阈值过滤**：在 `extractCct` 末尾，过滤掉 < 1800K 的独立值：

```typescript
return params.filter(p => {
  const num = parseInt(p.normalizedValue?.replace(/[^\d]/g, '') ?? '', 10);
  if (isNaN(num)) return true;  // 范围值/容差值保留
  return num >= 1800;
});
```

注意：范围值如 `3000-6500` 和容差值如 `6500±500` 不受此过滤影响（parseInt 取第一段数字 ≥ 1800）。

### 清理已有脏数据

apply 修复后，需要重跑受影响品类的参数提取来清理 DB 中已有的 22 条 CCT < 1800K 脏数据。

查询确认脏数据分布：

```sql
SELECT p.category, COUNT(*) FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE pp.param_key = 'cct'
  AND CAST(pp.normalized_value AS INTEGER) < 1800
  AND pp.normalized_value NOT LIKE '%-%'
  AND pp.normalized_value NOT LIKE '%±%'
GROUP BY p.category;
```

脚本修复后重跑对应品类的 `--target` 即可清理（clear-and-reinsert 模式）。

### 测试

在 `scripts/extract-params.ts` 中 `extractCct` 附近添加内联注释标记修复点。
测试方式：dry-run 跑一遍受影响品类，确认 normalized_value 中不再有 < 1800K 的独立值。

---

## Fix 3: Product Details fallback 过滤

### 文件：`src/lib/product-details-builder.ts`

**改动 A：增加 `lumens` 到 PARAM_FORMATTERS**

当前 `lumens` 不在 PARAM_FORMATTERS 中，导致工作灯等品类只能产生 Power + PF 两行，勉强过阈值或触发 fallback。

```typescript
const PARAM_FORMATTERS: ParamFormatter[] = [
  { key: "watts", label: "Power", format: formatWithUnit },
  { key: "cct", label: "CCT", format: formatWithUnit },
  { key: "ip", label: "IP", format: formatPlain },
  { key: "lumens", label: "Lumens", format: formatWithUnit },       // 新增
  { key: "size_display", label: "Size", format: formatPlain },
  // ... 其余不变
];
```

位置：放在 `ip` 之后、`size_display` 之前。

### 文件：`src/lib/quote-export.ts`

**改动 B：fallback 路径过滤包装标签和空值**

`buildProductDetails()` 的 fallback 分支（第 270 行），在使用 remark 前清洗：

```typescript
const remark = cleanRemarkForCustomer(
  stripModelPrefix(item.productRemark?.trim() ?? "", item.modelNo)
);
```

新增 `cleanRemarkForCustomer` 函数（同文件内）：

```typescript
function cleanRemarkForCustomer(text: string): string {
  if (!text) return "";
  return text
    .split(/\n/)
    .filter(line => !/外箱尺寸|内盒尺寸|彩盒尺寸|包装尺寸|carton\s*size/i.test(line))
    .filter(line => !/^\s*\S+\s*[:：]\s*[/／]\s*$/.test(line))  // "Voltage: /" 这种空值行
    .join("\n")
    .trim();
}
```

注意：这个函数只在 fallback 路径使用，不影响 param-based 路径。

### 测试：`src/lib/product-details-builder.test.ts`

新增 lumens 测试：

```typescript
test("includes lumens in output", () => {
  const result = buildProductDetailsFromParams([
    { paramKey: "watts", normalizedValue: "20", unit: "W", rawValue: "20W" },
    { paramKey: "lumens", normalizedValue: "1600", unit: "lm", rawValue: "1600LM" },
  ]);
  expect(result).toBe("Power: 20W\nLumens: 1600lm");
});
```

### 测试：`src/lib/quote-export.test.ts`

新增 fallback 过滤测试：

```typescript
test("fallback filters packaging labels and empty values from remark", () => {
  const details = buildProductDetails({
    productName: "LS-W12F-20W",
    modelNo: "LS-W12F-20W",
    productRemark: "PF: 0.9\nVoltage: /\nPower: 20W±10%\nLumen: 1600LM±10%\n外箱尺寸(MM) 参考用: 620*280*280",
    size: "128*93*28",
    productParams: [],
  });
  expect(details).not.toContain("外箱尺寸");
  expect(details).not.toContain("Voltage: /");
});
```

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v4.1-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 修改代码

按上述 3 个 Fix 修改 4 个文件：
1. `src/lib/quote-health.ts` — hasSizeParam
2. `scripts/extract-params.ts` — CCT lookbehind + threshold
3. `src/lib/product-details-builder.ts` — lumens formatter
4. `src/lib/quote-export.ts` — cleanRemarkForCustomer

并更新调用方传入 hasSizeParam（检查 `src/app/quotes/` 下所有调用 `buildQuoteHealth` 的地方）。

### Step 3: 跑测试

```bash
npm test
```

确保所有新增和已有测试通过。

### Step 4: 清理 CCT 脏数据

确认受影响品类后重跑参数提取（用对应 `--target`）。

### Step 5: 验证 + 提交

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add src/lib/quote-health.ts src/lib/quote-health.test.ts \
        src/lib/product-details-builder.ts src/lib/product-details-builder.test.ts \
        src/lib/quote-export.ts src/lib/quote-export.test.ts \
        scripts/extract-params.ts \
        src/app/quotes/actions.ts
git commit -m "V4.1: fix size health check, CCT tolerance extraction, product details fallback"
```

## 验收标准

1. `LS-R02A-30W`（有 size_display 参数）不再提示"缺 Size"
2. `XYJ-SWL-1000LM` 不再显示 `CCT: 500K`
3. DB 中 CCT < 1800K 的独立值全部清除（22 → 0）
4. `LS-W12F-20W` 的 Product Details 不含中文包装标签
5. Product Details 包含 Lumens 行
6. 所有测试通过

## 不做的事

- 不改 CTN 缺失警告分层（Issue 5，优先级低）
- 不改凯晟德太阳能壁灯数据源问题（Issue 4，数据限制）
- 不改 UI 布局
- 不加新参数筛选
- 不改 Prisma schema
