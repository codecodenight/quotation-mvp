# V6.2B：执行 auto-safe 跨品类碰撞拆分

## 背景

V6.2A 对 54 组疑似跨品类碰撞做了只读分层计划：

- 311 条 auto-safe offers（190 个 target buckets）
- 92 条 review-needed（本轮不处理）
- 67 条 skip

V6.2B 执行 auto-safe 拆分：为每个 target bucket 创建新产品，将 offer 迁移到新产品。

参考：`docs/v6.2a-split-plan.md`、`scripts/v6.2a-split-plan.ts`（品类推断 + 分类逻辑可复用）。

## 排除规则（硬编码）

以下产品 **必须排除**，不迁移任何 offer：

| product_id | model_no | 原因 |
|---|---|---|
| `011c8254-4be9-492f-972f-585685479e45` | SL-FA-60W | 太阳能 vs 太阳能壁灯 假阳性 + 20 customer_quote_rows + 迁移后 0 offer |
| `114ab7a9-860e-49ad-9f2b-2b8ea428b3f0` | SL-FD-100W | 太阳能 vs 太阳能壁灯 假阳性 + 16 customer_quote_rows + 4 quote_items + 迁移后 0 offer |
| `307f98cb-4714-4a07-adb3-8f67bd8ae6aa` | SL-FD-200W | 太阳能 vs 太阳能壁灯 假阳性 + 16 customer_quote_rows + 2 quote_items + 迁移后 0 offer |

排除后实际处理：302 条 auto-safe offers（原 311 - 9 排除），181 个 target buckets（原 190 - 9 排除，每个排除产品 3 个 bucket）。

## 要求

写 `scripts/v6.2b-apply-splits.ts`，输出报告到 `docs/v6.2b-apply-report.md`。

### Step 0：备份数据库

```
cp prisma/dev.db prisma/dev.db.bak-v6.2b
```

### Step 1：重新计算 auto-safe 拆分计划

复用 V6.2A 的品类推断逻辑（CATEGORY_RULES、inferCategory、checkCategoryConflict），重新识别碰撞组并分类。**不要解析 V6.2A 的 markdown 报告。**

过滤掉排除列表中的三个产品。

验证：实际 auto-safe offer 数量应为 302。如果不等于 302，打印差异详情并 `process.exit(1)`。

### Step 2：在事务中执行拆分

在 `prisma.$transaction` 中：

对每个 target bucket（model_no + inferred_category）：

1. **创建新产品**：
   - `id`：UUID v4
   - `model_no`：沿用原产品的 model_no
   - `product_name`：`{model_no} ({inferred_category})`
   - `category`：inferred_category
   - `created_at` / `updated_at`：当前时间
   - 其他字段从原产品复制：`unit`
   - 不复制：`min_price`、`max_price`、`avg_price`（迁移后需重算）
   - 如果同一 bucket 有来自多个原产品的 offer，使用第一个原产品作为模板

2. **迁移 offer**：`UPDATE supplier_offers SET product_id = {new_product_id} WHERE id IN ({offer_ids})`

3. **迁移关联数据**：
   - `product_params`：属于被迁移 offer 的参数 → `UPDATE product_params SET product_id = {new_product_id} WHERE supplier_offer_id IN ({offer_ids})`
   - `price_history`：属于被迁移 offer 的价格历史 → `UPDATE price_history SET product_id = {new_product_id} WHERE supplier_offer_id IN ({offer_ids})`

4. **重算原产品价格统计**：对迁移后仍有 offer 的原产品，重算 min_price / max_price / avg_price
5. **计算新产品价格统计**：对新产品，根据其 offer 计算 min_price / max_price / avg_price

### Step 3：处理空壳原产品

迁移后 offer 数为 0 的原产品（排除了三个 SL-* 后，预计有 16W、70W、32W、2835 四个）：

- **不删除**产品（可能有外部引用或未来用途）
- 将 min_price / max_price / avg_price 设为 NULL
- 在报告中列出这些空壳产品

### Step 4：后验证

事务提交后：

1. 产品总数 = 之前 + 新建数
2. supplier_offers 总数不变
3. product_params 总数不变
4. price_history 总数不变
5. quote_items 总数不变
6. customer_quote_rows 总数不变
7. 每个新产品至少有 1 个 offer
8. 每个新产品的 category 与其 offer 的 inferred_category 一致
9. 排除列表中三个产品的 offer 未被迁移（offer 数不变）
10. 18W灯管产品（f5b0f347）仍保留 ≥7 个 offer

### 输出格式

`docs/v6.2b-apply-report.md` 包含：

1. **总览**
   - 新建产品数、迁移 offer 数、排除产品数
   - 空壳原产品数
   - DB before/after 计数对比
   - 所有后验证检查结果

2. **新建产品表**
   - 每个新产品：id、model_no、category、offer_count、factories、min_price、max_price

3. **空壳原产品表**
   - product_id、model_no、原 category

4. **排除产品确认**
   - 三个 SL-* 产品的 offer 数未变

5. **FK 引用产品状态**
   - 18W灯管的迁移后 offer 数

## 验证

- `npx tsc --noEmit --pretty false` 通过
- 脚本运行成功
- 后验证全部通过
- 报告已生成

## 不做

- 不处理 review-needed 和 skip 的 offer
- 不迁移排除列表中三个产品的 offer
- 不删除空壳产品
- 不动 customer_quote_rows 或 quote_items 的 FK
