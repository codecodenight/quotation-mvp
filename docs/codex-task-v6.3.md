# V6.3：删除 V6.2B 遗留空壳产品

## 背景

V6.2B 跨品类碰撞拆分时，将部分 offer 迁移到了新产品，但原产品没有被删除，留下 4 个 0-offer 的空壳产品。这些产品会出现在报价中心搜索结果中，但无法添加到报价（因为没有 offer），造成用户困惑。

## 范围

删除以下 4 个产品及其关联 product_params：

| ID | model_no | category | offer 数 | quote_items 引用 | customer_quote_rows 引用 | params |
|---|---|---|---|---|---|---|
| `8e15ff84-8568-446e-8122-6f5c35eb0ce2` | 16W | 面板灯 | 0 | 0 | 0 | 5 |
| `092637af-0e1b-48de-b2ec-5edd587bc91a` | 32W | 面板灯 | 0 | 0 | 0 | 6 |
| `dceee231-9c2e-4891-9024-0daa5323bf30` | 70W | 面板灯 | 0 | 0 | 0 | 6 |
| `4b4e1369-038b-4e50-a2e2-220f1e76ffc5` | 2835 | 路灯 | 0 | 0 | 0 | 0 |

## 要求

写 `scripts/v6.3-empty-shell-cleanup.ts`，支持 `--dry-run`（默认）和 `--apply`。

### Step 0：备份（仅 --apply）

```
cp prisma/dev.db backups/dev-before-v6.3-{timestamp}.sqlite
```

### Step 1：安全检查

对每个目标产品 ID 确认：
- `supplier_offers` 中 0 条引用
- `quote_items` 中 0 条引用
- `customer_quote_rows.matched_product_id` 中 0 条引用
- `price_history`（通过 supplier_offer_id）中 0 条间接引用

任何一项不为 0 则跳过该产品并在报告中标记 SKIP。

### Step 2：删除

1. 删除 `product_params` 中 `product_id` 为目标 ID 的记录
2. 删除 `products` 中目标 ID 的记录

### Step 3：验证

1. 4 个目标 ID 在 `products` 表中不存在
2. `products` 总数 = 10,226 - 4 = 10,222
3. `supplier_offers` 总数不变（11,084）

### Step 4：报告

输出到 `docs/v6.3-empty-shell-report.md`：
- 每个产品的安全检查结果和删除状态
- products / product_params before/after 计数

## 验证

- `npx tsc --noEmit --pretty false` 通过
- dry-run 不改 DB
- apply 后目标产品不存在

## 不做

- 不动其他产品
- 不动 supplier_offers / quote_items
