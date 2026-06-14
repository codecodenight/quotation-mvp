# Codex Task: V5.0D — 报价中心历史客户售价参考 UI

## 目标

在报价中心（quotes page），当用户选中一个产品时，显示该产品的历史客户 FOB USD 售价记录作为定价参考。

## 背景

V5.0B 导入了 6,139 行历史客户报价到 `customer_quote_rows`，V5.0C 完成了产品匹配（2,847 行有 `matched_product_id`）。现在需要把这些数据在 UI 上呈现出来，让用户在做新报价时能看到"这个产品之前报给谁、报了多少钱"。

### 数据来源

```sql
SELECT cqr.sale_price_usd, cqr.sale_price_text, cqr.raw_model,
       cqf.customer_name, cqf.quote_date, cqf.file_name
FROM customer_quote_rows cqr
JOIN customer_quote_files cqf ON cqr.file_id = cqf.id
WHERE cqr.matched_product_id = ?
  AND cqr.sale_price_usd IS NOT NULL
ORDER BY cqf.quote_date DESC
```

---

## 设计

### 展示位置

在报价中心已选产品列表中，每个产品卡片下方，**紧跟在 offer 选择器之后**，加一个可折叠的历史售价参考区域。

### 展示规则

1. **只在有数据时显示**：如果产品没有匹配到任何 `customer_quote_rows`，不显示任何内容
2. **默认折叠**：显示一行摘要，点击展开详细列表
3. **摘要行格式**：`📋 历史售价参考 (N条) | 最近: $X.XX (YYYY-MM, 客户名)`
4. **展开后显示表格**：

| 日期 | 客户 | FOB USD | 来源文件 |
|---|---|---:|---|
| 2024-05 | HACHIZAI | $0.44 | To HACHIZAI - Plastic LED Panel... |
| 2023-11 | — | $0.33 | 核价 Welfull LED Products... |

5. **排序**：按 `quote_date` 降序（最新在前）
6. **最多显示 10 条**：超过 10 条的截断，显示"还有 N 条更早记录"
7. **客户名为 NULL 时显示 "（内部核价）"**

### 数据获取

在现有 quotes page 的产品数据加载流程中，对每个已选产品 batch 查询历史售价记录。用 Prisma 或 raw SQL 均可，优先复用现有的数据获取模式。

新增一个 server-side 函数（或在现有的产品数据获取函数中追加）：

```typescript
async function getHistoricalQuotes(productId: number): Promise<HistoricalQuote[]>
```

返回：
```typescript
interface HistoricalQuote {
  salePriceUsd: number;
  salePriceText: string | null;
  customerName: string | null;
  quoteDate: string | null;
  fileName: string;
}
```

### 性能考虑

- 不要为每个产品单独查询——batch 查询所有已选产品的历史记录
- 如果已选产品列表为空，不查询
- 用 `matched_product_id IN (...)` 一次查完

---

## 执行步骤

### Step 1: 添加数据获取函数

在合适的位置（参考现有 quotes page 的数据获取方式）添加 `getHistoricalQuotes` 函数。

### Step 2: 修改 quotes page 组件

在已选产品的 offer 选择器下方，添加历史售价参考 UI。

### Step 3: 验证

```bash
npx tsc --noEmit --pretty false
```

启动 dev server，在报价中心选择一个有历史记录的产品，确认历史售价参考正确显示。

### Step 4: 提交

```bash
git add -A
git commit -m "V5.0D: historical customer quote reference UI in quotes page"
```

## 验收标准

1. 有匹配记录的产品显示历史售价参考区域
2. 无匹配记录的产品不显示任何额外内容
3. 折叠/展开工作正常
4. 日期、客户名、价格格式正确
5. `tsc --noEmit` 通过
6. 不改 `customer_quote_rows` / `customer_quote_files` 数据
7. 不影响现有报价功能

## 不做的事

- 不做人工匹配修正界面
- 不改历史数据
- 不做客户维度管理
- 不做价格趋势图
- 不改导出模板
