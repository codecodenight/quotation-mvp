# Codex Task: V2.19A Step 1 — 瑞雪净化灯垃圾数据删除

## 目标

备份 DB → 删除 V2.19A Step 0 审计确认的垃圾产品及关联数据 → 验证净化灯品类覆盖率提升。**不动源 Excel 文件。**

## 背景

V2.19A Step 0 审计报告（`docs/v2.19a-ruixue-audit.md`）确认：
- 1,368 个瑞雪净化灯产品的 product_name 和 model_no 全是数字编码，purchase_price 是 MOQ 梯度（1000/3000/5000/10000），remark/size 全空
- quote_items = 0，无报价引用
- product_params = 4，price_history = 0
- **6 个正常产品**（T8AP60/T8GlassAC60/T8PC90 系列）有真实型号名和图片，必须排除

## 删除范围

**目标集合**：满足以下全部条件的产品：
1. `category = '净化灯'`
2. 有 offer 且 `factory_name LIKE '瑞雪%'`
3. `product_name NOT GLOB '*[a-zA-Z]*'`（名称不含任何英文字母 = 纯数字编码）

条件 3 排除了 6 个有字母型号名的正常产品。

**级联删除顺序**：
1. `product_params` → WHERE product_id IN 目标集合
2. `price_history` → WHERE supplier_offer_id IN 目标 offer 集合
3. `supplier_offers` → WHERE product_id IN 目标集合 AND factory_name LIKE '瑞雪%'
4. `products` → 目标集合中无剩余 offer 的产品

## 实现

### 脚本：`scripts/ruixue-cleanup.ts`（新建）

用 `npx tsx scripts/ruixue-cleanup.ts` 运行。支持两种模式：

```bash
npx tsx scripts/ruixue-cleanup.ts --dry-run   # 只显示将要删除的数量，不改数据
npx tsx scripts/ruixue-cleanup.ts --apply      # 执行删除
```

不带参数默认 `--dry-run`。

### 脚本结构

```typescript
// 1. 解析 --dry-run / --apply
// 2. 用 CTE 定义目标集合（一处定义，复用于所有 DELETE）
// 3. dry-run: 显示各表将删除的数量 + 保留的数量
// 4. apply: 备份 DB → 执行 DELETE → 显示结果 → 生成报告
```

### 目标集合 CTE

所有查询共用的目标产品 ID 集合：

```sql
WITH target_products AS (
  SELECT DISTINCT p.id
  FROM products p
  JOIN supplier_offers so ON so.product_id = p.id
  WHERE p.category = '净化灯'
    AND so.factory_name LIKE '瑞雪%'
    AND p.product_name NOT GLOB '*[a-zA-Z]*'
),
target_offers AS (
  SELECT so.id
  FROM supplier_offers so
  WHERE so.product_id IN (SELECT id FROM target_products)
    AND so.factory_name LIKE '瑞雪%'
)
```

### Dry-run 输出

```
=== V2.19A Step 1: 瑞雪净化灯垃圾删除 (DRY RUN) ===

目标范围：
  产品（将删除）: 1,362
  Offer（将删除）: 1,362
  product_params（将删除）: 4
  price_history（将删除）: 0

保留范围：
  瑞雪净化灯正常产品（有字母名）: 6
  净化灯其他工厂产品: 191

安全检查：
  ✅ quote_items 引用: 0
  ✅ 目标产品全部 product_name 为纯数字

产品名采样（将删除前 10）:
  10000101 | price=10000
  10000102 | price=10000
  ...

产品名采样（保留的瑞雪产品）:
  T8AP60-UV-HPF-421-DL-ISO | price=...
  ...
```

### Apply 流程

1. **备份**：`cp prisma/dev.db backups/dev-before-v2.19a-step1-{date}.sqlite`
2. **安全检查**：
   - 确认 quote_items 引用 = 0（否则 abort）
   - 确认目标产品数在 1,350-1,370 范围内（否则 abort，防止条件错误扩大删除）
3. **执行删除**（按顺序，每步用 sqlite3 执行）：
   ```sql
   -- Step 1: 删 product_params
   DELETE FROM product_params WHERE product_id IN (SELECT id FROM target_products);

   -- Step 2: 删 price_history
   DELETE FROM price_history WHERE supplier_offer_id IN (SELECT id FROM target_offers);

   -- Step 3: 删 supplier_offers
   DELETE FROM supplier_offers WHERE id IN (SELECT id FROM target_offers);

   -- Step 4: 删 products
   DELETE FROM products WHERE id IN (SELECT id FROM target_products);
   ```
4. **Post-delete 验证**：
   ```sql
   -- 净化灯剩余统计
   SELECT COUNT(*) as products FROM products WHERE category = '净化灯';
   SELECT COUNT(*) as offers FROM supplier_offers so
     JOIN products p ON so.product_id = p.id WHERE p.category = '净化灯';

   -- 覆盖率
   -- 图片
   SELECT COUNT(CASE WHEN image_path IS NOT NULL AND TRIM(image_path) != '' THEN 1 END) as with_image,
          COUNT(*) as total
   FROM products WHERE category = '净化灯';

   -- 参数
   SELECT COUNT(DISTINCT pp.product_id) as with_params, COUNT(DISTINCT p.id) as total
   FROM products p LEFT JOIN product_params pp ON pp.product_id = p.id
   WHERE p.category = '净化灯';

   -- 全局统计
   SELECT COUNT(*) FROM products;
   SELECT COUNT(*) FROM supplier_offers;
   SELECT COUNT(*) FROM product_params;
   ```

### 报告

Apply 成功后写入 `docs/v2.19a-cleanup-report.md`：

```markdown
# V2.19A Step 1 瑞雪净化灯垃圾删除报告

Generated: {timestamp}

## 删除统计

| 表 | 删除数 |
|---|---:|
| products | ... |
| supplier_offers | ... |
| product_params | ... |
| price_history | ... |

## 净化灯覆盖率变化

| 指标 | 删前 | 删后 |
|---|---:|---:|
| 产品数 | 1,559 | ~197 |
| 图片覆盖 | 11% | ~83% |
| 参数覆盖 | 12% | ~98% |
| Size 覆盖 | 12% | ~96% |
| CTN 覆盖 | 9% | ~73% |

## 全局数据变化

| 指标 | 删前 | 删后 |
|---|---:|---:|
| 总产品 | 11,344 | ~9,982 |
| 总 Offer | 12,428 | ~11,066 |
| 总参数 | 37,236 | ~37,232 |

## 保留的瑞雪净化灯产品

| product_name | model_no | image_path |
|---|---|---|
| T8AP60-UV-HPF-421-DL-ISO | ... | ... |
| ... | ... | ... |
```

## 执行步骤

### Step 1: 新建清理脚本

创建 `scripts/ruixue-cleanup.ts`。用 sqlite3 CLI（参考 `scripts/ruixue-audit.ts` 的 `queryRows` 模式）。

### Step 2: Dry-run

```bash
npx tsx scripts/ruixue-cleanup.ts --dry-run
```

确认数字合理（产品 ~1,362，排除 6 个正常产品）。

### Step 3: Apply

```bash
npx tsx scripts/ruixue-cleanup.ts --apply
```

确认备份创建 + 删除成功 + 报告生成。

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
npm test
```

确认无编译错误、测试通过（删除数据不影响代码逻辑）。

### Step 5: 提交

```bash
git add scripts/ruixue-cleanup.ts docs/v2.19a-cleanup-report.md
git commit -m "V2.19A step 1: delete 1362 ruixue junk products, coverage 11%→83%"
```

## 验收标准

1. `backups/dev-before-v2.19a-step1-*.sqlite` 备份存在
2. `docs/v2.19a-cleanup-report.md` 生成完整
3. 删除产品数 ≈ 1,362（1,368 减去 6 个正常产品）
4. 6 个正常产品（T8AP60/T8GlassAC60/T8PC90 系列）仍在 DB
5. 净化灯图片覆盖率 > 80%
6. 净化灯参数覆盖率 > 95%
7. 全局产品数 ≈ 9,982
8. `tsc --noEmit` 无错误
9. 所有已有测试通过

## 不做的事

- **不动源 Excel 文件**
- 不改 schema
- 不导入新数据
- 不改任何前端代码
- 不删除图片文件（6 个有 image_path 的产品被保留）
