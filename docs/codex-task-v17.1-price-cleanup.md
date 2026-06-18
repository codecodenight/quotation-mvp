# V17.1 — 价格误检 offer 清洗 + 路灯配件标记

## 背景

V10.3 导入 100 个未链接文件时，价格列误检导致非价格数据被当作 `purchase_price` 写入 `supplier_offers`。当前 391 条 RMB offer 的 `purchase_price > 500`，其中大量是误检。另有 5 个路灯线缆产品应标记为配件。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v17.1
```

## 新建文件：`scripts/v17.1-price-cleanup.ts`

```bash
npx tsx scripts/v17.1-price-cleanup.ts              # dry-run: 审计 + 报告
npx tsx scripts/v17.1-price-cleanup.ts --apply       # 执行清洗
```

---

## Part A — 价格误检 offer 审计+删除

### 误检模式（必须全部覆盖）

**模式 1: LED 芯片型号当价格 — price=2835**
- 查询：`purchase_price = 2835 AND currency = 'RMB'`
- 预估：59 条 offer
- 操作：**删除 offer**（不删产品——10W/20W/30W 等投光灯产品有其他工厂的正常 offer）
- 关联：同时删除这些 offer 的 `price_history` 记录

**模式 2: 列名被当作产品名 — product 级垃圾**
- 查询：`product_name IN ('LED chip', 'Dimension', 'Dimension 2wire', 'CCT', 'LiFePO4 Battery', 'LED Chip')`
- 预估：4-6 个产品，每个只有 1 条 offer
- 操作：**删除产品 + offer + product_params**（这些产品本身就是垃圾，不是真产品）
- 安全检查：确认 `quote_items` 和 `customer_quote_rows.matched_product_id` 无引用

**模式 3: MOQ/产能数据被当作产品**
- 查询：`product_name LIKE '%pieces' OR product_name LIKE '%pcs' OR product_name LIKE '%sets'`
- 补充查询：`product_name LIKE '%pcs/%' OR product_name GLOB '*[0-9]/[0-9]*pcs'`
- 预估：~30-55 个产品（太阳能壁灯草坪灯工厂）
- 操作：**删除产品 + offer + product_params**
- 安全检查：同模式 2

**模式 4: 型号数字部分被当价格 — 美莱德筒灯**
- 特征：`factory_name = '美莱德'` 且 `model_no LIKE 'JJL-C%'` 且 `purchase_price = model_no 中 C 后面的数字`
- 例：JJL-C1207 → price=1207, JJL-C1312 → price=1312
- 预估：56 条 offer
- 验证方法：`CAST(SUBSTR(model_no, 6) AS INTEGER) = CAST(purchase_price AS INTEGER)`
- 操作：**删除 offer**（产品本身可能是正常筒灯，但这些 offer 的价格是错的）
- 注意：这些产品可能没有其他 offer。如果删除后产品变成 0-offer 空壳，也删除产品

**模式 5: 雄企线条灯型号编码当价格**
- 特征：`factory_name = '雄企'` 且 `model_no LIKE 'LL%'` 且 price > 500
- 例：LL57150 → price=57150, LL40120 → price=40120
- 验证：`model_no` 中的数字子串 = `purchase_price`
- 预估：~57 条 offer（排除 QJ6870 系列——QJ6870 可能是合理价格需人工确认，先不动）
- 操作：**删除 offer**

### 不动的（需要人工确认）

以下 >500 RMB 的 offer 可能是合理高价，本次**不处理**：
- 汇盈聚磁吸灯 550-1610（磁吸灯系统可以贵）
- 中宏壁灯 605-637（可能合理）
- 宏硕净化灯 573-1500（T5T8 工程灯）
- 雄企 QJ6870 系列 6870 RMB（需要人工确认是否是工程灯真实价格）
- 开启、锐晶等少量边界情况

### 处理顺序

1. 加载全部 `supplier_offers` WHERE `purchase_price > 500 AND currency = 'RMB'`，JOIN products
2. 对每条 offer 按模式 1-5 分类
3. 记录分类结果到报告
4. dry-run 模式只输出统计，不写 DB
5. --apply 模式执行删除

### 删除安全检查

对每个待删除的产品，检查：
- `quote_items.product_id` — 如果有引用，跳过该产品，只删 offer
- `customer_quote_rows.matched_product_id` — 如果有引用，跳过该产品，只删 offer

对每个待删除的 offer，检查：
- `price_history.supplier_offer_id` — 有则一并删除

---

## Part B — 路灯线缆配件标记

5 个路灯线缆产品标记为 accessory：

```sql
-- 目标产品
SELECT id FROM products WHERE category = '路灯' 
AND (product_name LIKE '%含头总长度%' OR product_name LIKE '%1分%');
```

操作：插入 `product_params` 记录：
- `param_key = 'product_role'`
- `raw_value = 'accessory'`
- `normalized_value = 'accessory'`
- `source_field = 'manual_v17.1'`
- `confidence = 'high'`

先检查这 5 个产品是否已有 `product_role` 记录（V14.0 可能已给它们传播了参数，不影响标记）。

---

## 报告：`docs/v17.1-price-cleanup-report.md`

```markdown
# V17.1 价格误检清洗报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v17.1

## Part A: 价格误检

| 模式 | 描述 | offer 删除 | 产品删除 | 跳过(有FK) |
|---|---|---:|---:|---:|
| 1 | LED chip price=2835 | X | 0 | 0 |
| 2 | 列名当产品名 | X | X | X |
| 3 | MOQ 当产品 | X | X | X |
| 4 | 美莱德型号=价格 | X | X | X |
| 5 | 雄企编码=价格 | X | 0 | 0 |
| 合计 | | X | X | X |

### 未处理（需人工确认）

| 工厂 | 价格范围 | offer 数 | 原因 |
|---|---|---:|---|

## Part B: 路灯线缆配件

| product_id | product_name | 操作 |
|---|---|---|

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10284 | X | -X |
| supplier_offers | 12102 | X | -X |
| product_params | 96096 | X | -X |
| price_history | 9651 | X | -X |
```

---

## Commit

```
V17.1: clean up price misdetections and tag cable accessories
```

## 不做什么

- 不修改任何价格（只删除明确错误的 offer）
- 不处理"可能合理"的高价 offer
- 不改前端 / Prisma schema
- 不修改源 Excel 文件
- 不改已有脚本
