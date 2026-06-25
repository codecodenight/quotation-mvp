# V20.1: 重复 Offer + 垃圾产品清理

## Goal

清理 V20.0 审计发现的两类数据质量问题：
1. 非产品行残留（句子型 model_no、说明文本被当作产品导入）
2. 同产品同工厂重复 offer（419 组，源于历史多次导入未 upsert）

## Context

- V20.0 报告：`docs/v20.0-price-config-audit-report.md`
- V2.10 已引入 upsert（product_id + factory_name），但历史导入在此之前
- V17.1 已清理 186 条价格误检 offer + 83 垃圾产品，本次是其后续
- FK 安全约束：quote_items 和 customer_quote_rows 引用 product_id，被引用产品不能删
- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v20.1-offer-dedup-cleanup.ts`，支持 `--dry-run`（默认）和 `--apply` 两种模式。

### Part A: 垃圾产品删除

检测条件（满足任一）：
1. `model_no` 长度 > 50 字符（正常型号不会这么长）
2. 该产品所有 offer 的 `purchase_price` 都是 0
3. `model_no` 包含明显非产品关键词：`MOQ`、`warranty`、`Packing`、`payment`、`working days`、`T/T`、`minimum`、`lead time`

安全检查：
- 如果产品有 `quote_items` 引用 → 跳过，报告
- 如果产品有 `customer_quote_rows` 匹配 → 跳过，报告
- 如果产品有 `image_path` 不为 null → 跳过，报告（有图说明可能是真产品）

删除顺序：price_history → supplier_offers → product_params → products

输出：
```
Part A: 垃圾产品
  检测到: N
  跳过(FK/图片): N
  删除: N products + N offers + N params + N price_history
```

### Part B: 重复 Offer 去重

对每个 `(product_id, factory_name)` 组（COUNT > 1）：

1. 选出保留的 offer：按以下优先级排序，保留第一个
   - `purchase_price > 0`（排除 0 元）
   - CTN 完整度分数：`ctn_length IS NOT NULL` + `ctn_width IS NOT NULL` + `ctn_height IS NOT NULL` + `ctn_qty IS NOT NULL`（0-4 分）
   - `price_updated_at IS NOT NULL`
   - `created_at DESC`（最新优先）

2. 对被淘汰的 offer：
   - 如果 offer 被 `quote_items` 引用 → 跳过，报告
   - 如果淘汰 offer 价格和保留 offer 不同且 > 0 → 写一条 `price_history`（old_price = 淘汰价格，new_price = 保留价格）
   - 删除淘汰 offer 的 `price_history` 记录（old/new source_file_id 引用）
   - 删除淘汰 offer

3. 如果保留 offer 的 CTN/MOQ/lead_time 不如淘汰 offer 完整，把淘汰 offer 的非空字段补到保留 offer 上（merge 最佳信息）

输出：
```
Part B: 重复 Offer 去重
  多 offer 组: 419
  跳过(FK): N
  淘汰 offer: N
  新增 price_history: N
  信息补全: N offers updated
```

### Part C: 验证

清理后运行：
- `SELECT COUNT(*) FROM supplier_offers` — 比清理前减少
- `SELECT COUNT(*) FROM products` — 比清理前减少（Part A）
- `SELECT product_id, factory_name, COUNT(*) FROM supplier_offers GROUP BY product_id, factory_name HAVING COUNT(*) > 1` — 应为 0 行（除了 FK 跳过的）
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — all pass

### Part D: 报告

写到 `docs/v20.1-offer-dedup-cleanup-report.md`：

```markdown
# V20.1 重复 Offer + 垃圾产品清理报告

## 备份
备份路径: backups/dev-before-v20.1-YYYYMMDD-HHMMSS.sqlite

## Part A: 垃圾产品
删除: X products + Y offers + Z params + W price_history
跳过: N (原因列表)
样本: (前 10 个删除的产品 model_no)

## Part B: 重复 Offer 去重
处理组数: 419
淘汰 offer: N
新增 price_history: N
信息补全: N
跳过: N (原因)

## 清理后数据
- Products: before → after
- Offers: before → after
- 残余重复组: N

## tsc / vitest 结果
```
