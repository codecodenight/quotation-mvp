# Codex Task: V2.17E — 修复价格列检测 + 重跑灯管/球泡导入

## 目标

修正 `scripts/tube-bulb-split-dryrun.ts` 和 `scripts/tube-bulb-split-apply.ts` 的价格列自动检测逻辑，然后回滚 DB 到 V2.17D 前备份，重新 dry-run。

**本任务只做到 dry-run 停下。不 apply。**

## 背景

V2.17D 的 91 个 sheet 中 86 个选错了价格列。根因：`sortSignal` 按数字密度（count）排序，`No./序号/功率` 等全数字列排在真正价格列前面。审计报告：`docs/v2.17e-price-column-audit.md`。

## Step 1: 备份当前 DB + 回滚

```bash
cp prisma/dev.db backups/dev-before-v2.17e-$(date +%Y%m%d-%H%M%S).sqlite
cp backups/dev-before-v2.17d-tube-bulb-20260612-085146.sqlite prisma/dev.db
```

回滚后验证：

```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM products; SELECT COUNT(*) FROM supplier_offers; SELECT COUNT(*) FROM price_history;"
```

期望：products=10,970 / offers=11,990 / price_history=8,198（V2.17D 之前的值）。

## Step 2: 修改价格列检测（两个脚本同步改）

在 `scripts/tube-bulb-split-dryrun.ts` 和 `scripts/tube-bulb-split-apply.ts` 中做以下修改。两个脚本有独立但结构相同的函数副本，必须**两个都改**。

### 2a: 新增 `isNonPriceHeader()` 函数

添加在 `isRmbPriceHeader` 附近：

```typescript
function isNonPriceHeader(header: string): boolean {
  const text = normalizeText(header);
  // 序号类
  if (/^(no\.?|序号|序\s*号|item\s*no\.?|sn|s\/n|编号)$/i.test(text)) return true;
  // 规格/功率/电气参数类
  if (/^(功率|w数|watt(age)?|power|电流|current|电压|voltage|尺寸|size|规格|spec|长度|length|直径|diameter|数量|qty|quantity|pcs|重量|weight|净重|毛重|体积|cbm|箱数|包装数|光通量|lumen|色温|cct|显指|cri|光效|pf|频率|hz)$/i.test(text)) return true;
  // 产品名称/描述类（纯名称列不应是价格列）
  if (/^(产品名称|品名|product\s*name|名称|品类|类别|category|type|系列|series|颜色|color|材质|material|灯头|base|角度|angle|认证|cert)$/i.test(text)) return true;
  return false;
}
```

### 2b: 修改 `analyzeSheet()` 中价格列候选过滤

在 `for (let index = 0; ...)` 循环中，添加非价格列过滤。修改前：

```typescript
if (priceValues.length >= threshold) {
  const signal = columnSignal(index, header, priceValues.length, uniqueSamples(priceValues));
  priceColumns.push(signal);
  if (isRmbPriceHeader(header) || ...) {
    rmbPriceColumns.push(signal);
  }
}
```

修改后：

```typescript
if (priceValues.length >= threshold) {
  const signal = columnSignal(index, header, priceValues.length, uniqueSamples(priceValues));
  // 非价格语义表头：只有在表头同时匹配价格关键词时才保留
  if (isNonPriceHeader(header) && !isPriceHeader(header)) {
    // 跳过，不加入任何价格候选
  } else {
    priceColumns.push(signal);
    if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
      rmbPriceColumns.push(signal);
    }
  }
}
```

apply 脚本中同样处理，注意 apply 版还有 `usdPriceColumns`：

```typescript
if (priceValues.length >= threshold) {
  const signal = columnSignal(index, header, priceValues.length, priceSamples);
  if (isNonPriceHeader(header) && !isPriceHeader(header)) {
    // 跳过
  } else {
    priceColumns.push(signal);
    if (isUsdPriceHeader(header) || filePriceHint === "usd") {
      usdPriceColumns.push(signal);
    }
    if (isRmbPriceHeader(header) || (filePriceHint === "rmb" && !isUsdPriceHeader(header))) {
      rmbPriceColumns.push(signal);
    }
  }
}
```

### 2c: 修改 `sortSignal()` — 优先价格语义

修改前：

```typescript
function sortSignal(a: ColumnSignal, b: ColumnSignal): number {
  return b.count - a.count || a.index - b.index;
}
```

修改后：

```typescript
function sortSignal(a: ColumnSignal, b: ColumnSignal): number {
  const aPrice = isPriceHeader(a.header) ? 1 : 0;
  const bPrice = isPriceHeader(b.header) ? 1 : 0;
  if (aPrice !== bPrice) return bPrice - aPrice;
  return b.count - a.count || a.index - b.index;
}
```

含价格关键词的列优先排第一，然后才看数字密度。两个脚本都改。

### 2d: dry-run 报告增加风险标记

在 dryrun 脚本的报告生成部分，对 priceColumn 没有价格关键词的 sheet 加 `⚠️` 标记。

找到报告中输出每 sheet price column 的地方（应在 `writeReport` 函数或类似位置），对 `result.priceColumn` 做判断：

```typescript
const priceColumnDisplay = result.priceColumn;
const priceWarning = !isPriceHeader(/* price column header */) ? " ⚠️" : "";
// 在报告表格中拼接 priceColumnDisplay + priceWarning
```

具体实现：在 `SheetDryRunResult` 类型中加一个 `priceColumnHeader: string` 字段（或者从现有 `priceColumn` string 如 `"A No."` 中提取 header 部分），然后在 writeReport 时判断 `isPriceHeader(result.priceColumnHeader)`。

如果改动太大，可以简化为：对 `result.priceColumn` 做正则检测：

```typescript
const hasSemanticPrice = /价格|单价|含税|不含税|rmb|cny|出厂|工厂价|成本|采购|price|报价|元/i.test(result.priceColumn);
const priceWarning = hasSemanticPrice ? "" : " ⚠️无价格关键词";
```

## Step 3: 运行修正后 dry-run

```bash
npx tsx scripts/tube-bulb-split-dryrun.ts --report docs/v2.17e-dryrun-report.md
```

## Step 4: 验证 + 提交

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/tube-bulb-split-dryrun.ts scripts/tube-bulb-split-apply.ts docs/v2.17e-dryrun-report.md docs/v2.17e-price-column-audit.md
git commit -m "V2.17E: fix price column detection, rollback V2.17D, re-run dry-run"
```

## 验收标准

1. DB 已回滚到 V2.17D 之前（products=10,970）
2. dry-run 报告中 5 个已知正确 sheet 的价格列不变：
   - 嘉家旺202404 → `L 不含税单价`
   - 杭州汇孚 包装成本差价表 (×2) → `K 含税不含运费`
   - t8 灯管 -2024.4.14 → `A 含税出厂价`
   - NEW ERP T8 TUBE → `I PRICE(RMB)`
3. 光极 Packinglist 不再选 `A No.` 作价格列
4. 合力 AC&DC T泡 不再选 `B 序号NO.` 作价格列
5. 合力 灯管报价表 各 sheet 不再选 `A NO.` 作价格列
6. 嘉家旺 整体报价 (×2) 不再选 `G 初始实际功率±5％` 作价格列
7. 无价格关键词的 sheet 在报告中有 `⚠️` 标记
8. tsc / lint / build / test 全过

## 不做的事

- 不 apply（等人工 review dry-run 报告后再决定）
- 不修改 batch-import-v2.14.ts（那个脚本有独立的列检测，不在本次范围）
- 不做参数提取
- 不改 UI
- 不修改源 Excel 文件
