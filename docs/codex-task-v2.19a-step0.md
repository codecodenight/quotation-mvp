# Codex Task: V2.19A Step 0 — 瑞雪净化灯污染审计

## 目标

只读审计瑞雪净化灯 1,368 条产品的完整关联范围，生成报告写入 `docs/v2.19a-ruixue-audit.md`。**不删除任何数据**。

## 背景

V4.4A 数据质量仪表盘发现净化灯品类 1,559 个产品中图片 11%、参数 12%、Size 12%。调查发现 1,368 个产品来自单一文件"瑞雪报价2023.8.31 - 净化灯-.xlsx"，这些产品的 product_name 和 model_no 全是数字编码（`10000101`），purchase_price 是 1000/3000/10000 等整数，remark/size 全空。疑似列检测错位导致的垃圾导入。

## 实现

### 脚本：`scripts/ruixue-audit.ts`（新建）

用 `tsx scripts/ruixue-audit.ts` 运行，读 DB 生成报告。

### 查询清单

所有查询以 `factory_name LIKE '瑞雪%'` 且 `category = '净化灯'` 为范围。

**1. 产品和 Offer 基本统计**

```sql
-- 产品数
SELECT COUNT(*) FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';

-- Offer 数
SELECT COUNT(*) FROM supplier_offers so
JOIN products p ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';

-- 产品名分布（采样前 20 个）
SELECT product_name, model_no, so.purchase_price
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%'
ORDER BY p.product_name LIMIT 20;
```

**2. Quote Items 引用检查**

```sql
SELECT COUNT(*) FROM quote_items qi
JOIN supplier_offers so ON qi.supplier_offer_id = so.id
JOIN products p ON qi.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';
```

如果 > 0，列出具体 quote_id + product_name。

**3. Product Params 检查**

```sql
SELECT COUNT(*) FROM product_params pp
JOIN products p ON pp.product_id = p.id
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';
```

**4. Price History 检查**

```sql
SELECT COUNT(*) FROM price_history ph
JOIN supplier_offers so ON ph.supplier_offer_id = so.id
JOIN products p ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';
```

**5. 图片路径检查**

```sql
SELECT COUNT(*), 
  SUM(CASE WHEN image_path IS NOT NULL AND TRIM(image_path) != '' THEN 1 ELSE 0 END) as with_image
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';
```

如果有 image_path，列出具体路径（用于后续判断是否要删图片文件）。

**6. Remark / Size 覆盖**

```sql
SELECT 
  SUM(CASE WHEN p.remark IS NOT NULL AND TRIM(p.remark) != '' THEN 1 ELSE 0 END) as has_remark,
  SUM(CASE WHEN p.size IS NOT NULL AND TRIM(p.size) != '' THEN 1 ELSE 0 END) as has_size
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%';
```

**7. 价格分布**

```sql
SELECT CAST(so.purchase_price AS INTEGER) as price, COUNT(*) as cnt
FROM supplier_offers so
JOIN products p ON so.product_id = p.id
WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%'
GROUP BY price ORDER BY cnt DESC LIMIT 10;
```

**8. 删除后影响预估**

删除 1,368 产品后，净化灯品类剩余产品/offer/params/image 的数量和覆盖率：

```sql
-- 剩余产品数
SELECT COUNT(*) FROM products WHERE category = '净化灯'
AND id NOT IN (
  SELECT DISTINCT p.id FROM products p
  JOIN supplier_offers so ON so.product_id = p.id
  WHERE p.category = '净化灯' AND so.factory_name LIKE '瑞雪%'
);
```

类似方式计算剩余 remark/size/image/params 覆盖。

### 报告格式

写入 `docs/v2.19a-ruixue-audit.md`，结构：

```markdown
# V2.19A 瑞雪净化灯污染审计报告

Generated: {timestamp}

## 范围

- 工厂: 瑞雪*
- 品类: 净化灯
- 源文件: {relative_path}

## 1. 基本统计

| 指标 | 数量 |
|---|---:|
| 产品 | ... |
| Offer | ... |
| ... | ... |

## 2. 关联检查

| 关联表 | 记录数 | 安全删除？ |
|---|---:|---|
| quote_items | 0 | ✅ |
| product_params | ... | ... |
| price_history | ... | ... |

## 3. 产品名采样（前 20）

| product_name | model_no | purchase_price |
|---|---|---:|
| ... | ... | ... |

## 4. 价格分布

| 价格 (RMB) | 数量 |
|---:|---:|
| ... | ... |

## 5. 图片路径

{列出有 image_path 的记录，或 "无"}

## 6. 删除后预估

| 指标 | 删前 | 删后 | 变化 |
|---|---:|---:|---|
| 净化灯产品数 | 1,559 | ~191 | -1,368 |
| 图片覆盖 | 11% | ~83% | ... |
| 参数覆盖 | 12% | ~99% | ... |
| ... | ... | ... | ... |

## 7. 结论

{安全删除 / 有风险 — 以及风险点}
```

## 执行步骤

### Step 1: 新建审计脚本

创建 `scripts/ruixue-audit.ts`。

脚本直接用 `@prisma/client` 或 `better-sqlite3`（看项目已有模式）查 DB，把结果格式化写入 `docs/v2.19a-ruixue-audit.md`。

参考项目已有的 `scripts/extract-params.ts` 的 Prisma 用法。

### Step 2: 运行

```bash
npx tsx scripts/ruixue-audit.ts
```

### Step 3: 验证

确认报告生成且内容完整。

### Step 4: 提交

```bash
git add scripts/ruixue-audit.ts docs/v2.19a-ruixue-audit.md
git commit -m "V2.19A step 0: ruixue audit report — 1368 junk products identified"
```

## 验收标准

1. `docs/v2.19a-ruixue-audit.md` 生成完整
2. 报告包含所有 8 项查询结果
3. 明确标注每个关联表是否安全删除
4. 删除后预估覆盖率数字合理
5. 脚本可重复运行（幂等，覆盖写入）

## 不做的事

- **不删除任何数据**
- 不改 schema
- 不读源 Excel 文件
- 不导入新数据
