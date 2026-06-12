# Codex Task: V2.17F — 收紧价格列检测 + 重跑 dry-run

## 目标

在 V2.17E 基础上继续收紧 `scripts/tube-bulb-split-dryrun.ts` 和 `scripts/tube-bulb-split-apply.ts` 的价格列检测规则，消除剩余误判，重跑 dry-run。

**只做到 dry-run 停下。不 apply。**

## 背景

V2.17E 修复了大部分误判（`No./序号/功率` 等），但 dry-run 报告仍有以下问题：

1. **`灯珠颗数` 被当价格列** — 4 个 sheet 选了 `E/F 灯珠颗数`，值是 36/72/144（颗数不是价格）
2. **Model 列 = Price 列** — 2 个 sheet 的型号列和价格列指向同一列
3. **无表头列被当价格列** — ~10 个 sheet 选了空 header 的 E/F 列，无法判断是否真是价格
4. **差价/配件列含 RMB 被误认为采购价** — `阻燃长堵头+RMB0.12` 含 "RMB" 但实际是配件差价描述

## 修改内容（两个脚本同步改）

### Fix 1: `isNonPriceHeader()` 扩展黑名单

在 V2.17E 已有的 `isNonPriceHeader()` 函数中增加：

```typescript
// 在规格/功率/电气参数类正则中追加：
// 灯珠颗数|灯珠数|led qty|bead|数量
```

具体做法：找到 `isNonPriceHeader` 中匹配规格/功率的正则行，把 `灯珠颗数|灯珠数|led\s*qty|bead` 加进去。注意 `数量|qty|quantity|pcs` 如果 V2.17E 已包含就不要重复。

### Fix 2: Model 列 = Price 列 → 跳过

在 `buildMapping()` 或其调用方（处理 analysis 后构建 mapping 的地方），加一道检查：

```typescript
if (modelColumnIndex === priceColumnIndex) {
  // 同一列既当型号又当价格，视为不可导入
  // 将 sheet 标记为 skipReason = "型号列和价格列相同"
}
```

具体实现位置：

**dryrun 脚本**：在 `analyzeSheet()` 返回之前，或在调用 `buildMapping()` 之前判断。如果 `modelColumns[0].index === (rmbPriceColumns[0] ?? priceColumns[0]).index`，将 `hasImportColumns` 设为 `false`，`skipReason` 设为 `"型号列和价格列相同"`。

**apply 脚本**：同样位置，同样逻辑。

### Fix 3: 无表头列不自动作为价格列

在价格列候选筛选中（`analyzeSheet()` 的 for 循环里），对 **header 为空或纯空白** 的列，不加入 `priceColumns` / `rmbPriceColumns`。

修改位置：在 `if (priceValues.length >= threshold)` 判断内，追加条件：

```typescript
if (priceValues.length >= threshold) {
  const signal = columnSignal(index, header, priceValues.length, ...);
  if (isNonPriceHeader(header) && !isPriceHeader(header)) {
    // V2.17E 已有：非价格语义表头，跳过
  } else if (!header.trim()) {
    // V2.17F 新增：无表头列，不作为价格候选
  } else {
    priceColumns.push(signal);
    // ... rmbPriceColumns / usdPriceColumns 逻辑
  }
}
```

两个脚本都改。

### Fix 4: 差价/配件/附加费列排除

`isRmbPriceHeader()` 目前只要含 `rmb|含税|单价|价格` 就返回 true。需要加一个排除条件：如果表头同时包含差价/配件/附加类关键词，不视为价格列。

在 `isRmbPriceHeader()` 中追加排除：

```typescript
function isRmbPriceHeader(header: string): boolean {
  const text = normalizeText(header);
  if (isUsdPriceHeader(text)) return false;
  // 差价/配件/附加费列：含 RMB/元 但不是主价格
  if (/堵头|差价|配件|加价|附加|升级|差额|补差|运费差|包装差|物料差/i.test(text)) return false;
  return /rmb|人民币|含税|不含税|单价|价格|报价|出厂|工厂价|成本|采购|cny|元/i.test(text);
}
```

两个脚本都改。

---

## 执行步骤

### Step 1: 修改两个脚本

按上述 Fix 1-4 修改 `scripts/tube-bulb-split-dryrun.ts` 和 `scripts/tube-bulb-split-apply.ts`。

### Step 2: 重跑 dry-run

```bash
npx tsx scripts/tube-bulb-split-dryrun.ts --report docs/v2.17f-dryrun-report.md
```

### Step 3: 验证 + 提交

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/tube-bulb-split-dryrun.ts scripts/tube-bulb-split-apply.ts docs/v2.17f-dryrun-report.md docs/codex-task-v2.17f.md
git commit -m "V2.17F: tighten price column detection, re-run dry-run"
```

## 验收标准

1. **无 `灯珠颗数` 被选为价格列**：4 个之前误判的 sheet 应该选到真正的价格列或被标为不可导入
2. **无 model==price 同列**：产品目录 `T泡-DB4` 和异性泡 `GU10,MR16` 应该被跳过（skipReason = "型号列和价格列相同"）
3. **无空表头列被选为价格列**：之前 ~10 个选了无 header 的 E/F 列的 sheet，应该重新选到有 header 的价格列或被标为不可导入
4. **`阻燃长堵头+RMB0.12` 不再被当价格列**：ERP灯管报价表 sheet 应该选到其他列或被跳过
5. **V2.17E 已确认正确的 sheet 价格列不变**：
   - 嘉家旺202404 → `L 不含税单价`
   - 杭州汇孚 包装成本差价表 (×2) → `K 含税不含运费`
   - t8 灯管 -2024.4.14 → `A 含税出厂价`
   - NEW ERP T8 TUBE → `I PRICE(RMB)`
   - 光极 Packinglist → `T DOB 110-265V的价格 两年质保`
   - 合力 AC&DC T泡 → `J 价格`
   - 合力灯管报价表 → `J 涂粉管价格（￥）`
   - 嘉家旺 整体报价 (×2) → `L 不含税单价`
6. tsc / lint / build / test 全过

## 不做的事

- 不 apply
- 不改 batch-import-v2.14.ts
- 不做参数提取
- 不改 UI
- 不修改源 Excel 文件
