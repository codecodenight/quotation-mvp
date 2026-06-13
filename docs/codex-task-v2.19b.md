# Codex Task: V2.19B — 全品类污染扫描

## 目标

只读扫描全库 9,982 产品，按 `category + factory_name` 分组检测污染特征，生成排名报告 `docs/v2.19b-pollution-scan.md`。**不删除任何数据。**

## 背景

V2.19A 发现瑞雪净化灯 1,368 条垃圾产品（列错位导入：数字编码当产品名、MOQ 当价格、remark/size 全空）。同一批量导入脚本跑过 600+ 文件，需确认其他品类是否有同类问题。

## 污染特征定义

一个 `category + factory_name` 组合如果满足以下多个特征，视为污染嫌疑：

| 特征 | 检测方式 | 权重 |
|---|---|---|
| **空壳产品** | remark 空 AND size 空 AND image_path 空 AND 无 product_params | 高 |
| **数字编码名** | product_name 不含任何中文或英文字母（`NOT GLOB '*[a-zA-Z]*' AND NOT GLOB '*[一-鿿]*'`）| 高 |
| **product_name = model_no** | 产品名和型号完全相同，可能是自动复制 | 中 |
| **价格异常集中** | 前 3 个价格占该组 >80% 的 offer | 中 |
| **整千价格** | purchase_price 为 1000/2000/3000/5000/10000 等整千数 | 中 |
| **quote_items 零引用** | 该组产品从未出现在报价中 | 低（仅辅助判断） |

## 实现

### 脚本：`scripts/pollution-scan.ts`（新建）

用 `npx tsx scripts/pollution-scan.ts` 运行。

### 查询设计

所有查询通过 sqlite3 CLI 执行（参考 `scripts/ruixue-audit.ts`）。

**Query 1 — 按 category + factory 分组的基础统计 + 空壳率**

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  so.factory_name,
  COUNT(DISTINCT p.id) as product_count,
  COUNT(DISTINCT so.id) as offer_count,
  -- 空壳：remark 空 AND size 空 AND image_path 空
  COUNT(DISTINCT CASE
    WHEN (p.remark IS NULL OR TRIM(p.remark) = '')
     AND (p.size IS NULL OR TRIM(p.size) = '')
     AND (p.image_path IS NULL OR TRIM(p.image_path) = '')
    THEN p.id END) as hollow_count,
  -- 数字编码名：不含中英文字母
  COUNT(DISTINCT CASE
    WHEN p.product_name NOT GLOB '*[a-zA-Z]*'
     AND p.product_name NOT GLOB '*[一-鿿]*'
    THEN p.id END) as numeric_name_count,
  -- product_name = model_no
  COUNT(DISTINCT CASE
    WHEN p.product_name = p.model_no THEN p.id END) as name_eq_model_count
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
GROUP BY p.category, so.factory_name
ORDER BY p.category, product_count DESC
```

**Query 2 — 按 category + factory 的参数覆盖**

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  so.factory_name,
  COUNT(DISTINCT p.id) as product_count,
  COUNT(DISTINCT pp.product_id) as with_params_count
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
LEFT JOIN product_params pp ON pp.product_id = p.id
GROUP BY p.category, so.factory_name
```

**Query 3 — 按 category + factory 的价格集中度**

对每个 category + factory 组合，计算前 3 个最常见价格占总 offer 的比例：

```sql
-- 先拿每个组的 offer 总数和 top-3 价格数量
WITH price_ranked AS (
  SELECT
    COALESCE(p.category, '未分类') as category,
    so.factory_name,
    CAST(so.purchase_price AS INTEGER) as price_int,
    COUNT(*) as cnt,
    ROW_NUMBER() OVER (
      PARTITION BY p.category, so.factory_name
      ORDER BY COUNT(*) DESC
    ) as rn
  FROM supplier_offers so
  JOIN products p ON so.product_id = p.id
  GROUP BY p.category, so.factory_name, price_int
)
SELECT
  category,
  factory_name,
  SUM(cnt) as total_offers,
  SUM(CASE WHEN rn <= 3 THEN cnt ELSE 0 END) as top3_count,
  GROUP_CONCAT(CASE WHEN rn <= 3 THEN price_int || ':' || cnt END, ', ') as top3_prices
FROM price_ranked
GROUP BY category, factory_name
```

**Query 4 — 整千价格统计**

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  so.factory_name,
  COUNT(*) as offer_count,
  SUM(CASE
    WHEN CAST(so.purchase_price AS INTEGER) IN (1000,2000,3000,5000,10000) THEN 1 ELSE 0
  END) as round_thousand_count
FROM supplier_offers so
JOIN products p ON so.product_id = p.id
GROUP BY p.category, so.factory_name
```

**Query 5 — quote_items 引用**

```sql
SELECT
  COALESCE(p.category, '未分类') as category,
  so.factory_name,
  COUNT(DISTINCT qi.id) as quote_item_count
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
LEFT JOIN quote_items qi ON qi.product_id = p.id AND qi.supplier_offer_id = so.id
GROUP BY p.category, so.factory_name
```

### 评分逻辑

合并 5 个查询结果后，对每个 `category + factory` 组合计算污染评分：

```typescript
function computePollutionScore(group: GroupStats): number {
  let score = 0;
  const hollowRate = group.hollowCount / group.productCount;
  const numericNameRate = group.numericNameCount / group.productCount;
  const nameEqModelRate = group.nameEqModelCount / group.productCount;
  const noParamsRate = 1 - (group.withParamsCount / group.productCount);
  const top3Concentration = group.top3Count / group.totalOffers;
  const roundThousandRate = group.roundThousandCount / group.offerCount;

  // 高权重
  if (hollowRate > 0.8) score += 30;
  else if (hollowRate > 0.5) score += 15;

  if (numericNameRate > 0.5) score += 25;
  else if (numericNameRate > 0.2) score += 10;

  // 中权重
  if (nameEqModelRate > 0.8) score += 15;

  if (top3Concentration > 0.8 && group.totalOffers > 10) score += 15;

  if (roundThousandRate > 0.5) score += 15;

  if (noParamsRate > 0.9) score += 10;

  // 低权重
  if (group.quoteItemCount === 0) score += 5;

  return score;
}
```

**阈值**：
- score ≥ 50：🔴 高度疑似污染
- score 30-49：🟡 需人工审查
- score < 30：不列出（正常数据）

只报告 product_count ≥ 5 的组合（避免噪声）。

### 报告格式

写入 `docs/v2.19b-pollution-scan.md`：

```markdown
# V2.19B 全品类污染扫描报告

Generated: {timestamp}
扫描范围: {product_count} 产品 / {offer_count} offers / {category_count} 品类

## 总结

- 扫描组合数: {total_groups}（category × factory，≥5 产品）
- 🔴 高度疑似: {count} 组
- 🟡 需审查: {count} 组
- 正常: {count} 组

## 🔴 高度疑似污染

### {rank}. {category} — {factory_name}（score: {score}）

| 指标 | 值 |
|---|---|
| 产品数 | ... |
| 空壳率 | ...% |
| 数字编码名率 | ...% |
| name=model 率 | ...% |
| 参数覆盖 | ...% |
| 前 3 价格集中度 | ...%（{top3_prices}）|
| 整千价格率 | ...% |
| quote_items 引用 | ... |

产品名采样（前 5）:
| product_name | model_no | purchase_price |
|---|---|---:|
| ... | ... | ... |

---

## 🟡 需人工审查

（同上格式，但精简）

## 附录：按品类汇总

| 品类 | 工厂数 | 产品总数 | 🔴 | 🟡 | 占比 |
|---|---:|---:|---:|---:|---|
```

**采样查询**：对每个 🔴/🟡 组合，额外查 5 条产品采样：

```sql
SELECT p.product_name, p.model_no, so.purchase_price
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = ? AND so.factory_name = ?
ORDER BY p.product_name
LIMIT 5
```

## 执行步骤

### Step 1: 新建扫描脚本

创建 `scripts/pollution-scan.ts`。参考 `scripts/ruixue-audit.ts` 的 sqlite3 CLI 查询模式。

### Step 2: 运行

```bash
npx tsx scripts/pollution-scan.ts
```

### Step 3: 验证

确认报告生成且包含所有必要部分。

### Step 4: 提交

```bash
git add scripts/pollution-scan.ts docs/v2.19b-pollution-scan.md
git commit -m "V2.19B: full pollution scan — flag junk imports across all categories"
```

## 验收标准

1. `docs/v2.19b-pollution-scan.md` 生成完整
2. 报告覆盖所有 32 品类
3. 已知的瑞雪净化灯不再出现在报告中（已被 V2.19A 清理）
4. 每个 🔴/🟡 组合有产品名采样
5. 评分逻辑合理：正常工厂数据不应被误报为 🔴
6. 脚本可重复运行（幂等，覆盖写入）

## 不做的事

- **不删除任何数据**
- 不改 schema
- 不读源 Excel 文件
- 不导入新数据
- 不改任何前端代码
