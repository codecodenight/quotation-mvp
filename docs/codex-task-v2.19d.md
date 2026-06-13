# Codex Task: V2.19D — 部分垃圾逐条审计

## 目标

对 V2.19B 扫描确认的 3 组"部分垃圾"（共 98 产品）生成逐产品清单，按规则自动标记 `junk` / `suspect` / `keep`，写入报告供人工确认。**不删除任何数据。**

## 背景

V2.19B 污染扫描 + 人工审阅（`docs/v2.19b-review.md`）确认这 3 组不能整组删除，需逐条判断：

| 组 | category | factory_name | 产品数 | 问题 |
|---|---|---|---:|---|
| 1 | 灯带 | 尼奥 | 11 | 混合：纯数字名是垃圾，LST-开头是真产品但 price 错 |
| 2 | 面板灯 | 瑞鑫 | 46 | 混合：specs/notes 当产品名，部分有参数，13 个 price=0 |
| 3 | 工作灯 | 启阳 | 41 | 混合：MOQ/配件当产品名，部分有参数和图片 |

## 标记规则

对每个产品，按以下规则自动标记：

### `junk`（明确垃圾）

满足以下**任一**条件：

1. `product_name` 不含任何中文或英文字母（纯数字/符号）
2. `product_name` 完全匹配以下模式之一：
   - 以 `¥` 或 `￥` 开头（价格文本当产品名）
   - 以 `另：` 或 `另:` 开头（备注当产品名）
   - 以 `内盒` 或 `外箱` 开头（包装备注当产品名）
   - 匹配 `^\d+PCS$`（MOQ 当产品名，如 "1000PCS"）
   - 匹配 `^\d+W（.*）$`（功率规格当产品名，如 "20W（SMD）"）
3. `product_name` 看起来是电池配件而非成品：匹配 `V.*MAH.*battery`（如 "3.7V 4400MAH Li battery"）

### `suspect`（疑似垃圾，需人工确认）

不满足 `junk` 规则，但满足以下**任一**条件：

1. `purchase_price` = 0 或 NULL
2. `product_name` = `model_no`（自动复制）且无 `image_path` 且无 `product_params`
3. `purchase_price` 看起来不合理：对灯带品类 > 5000，对面板灯/工作灯 > 2000

### `keep`（保留）

不满足 `junk` 也不满足 `suspect`。

## 实现

### 脚本：`scripts/partial-junk-audit.ts`（新建）

用 `npx tsx scripts/partial-junk-audit.ts` 运行。

### 查询

对 3 组分别查全量产品数据：

```sql
SELECT
  p.id,
  p.product_name,
  p.model_no,
  p.category,
  so.factory_name,
  so.purchase_price,
  p.image_path,
  p.remark,
  p.size,
  (SELECT COUNT(*) FROM product_params pp WHERE pp.product_id = p.id) as param_count,
  (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) as quote_item_count,
  (SELECT COUNT(*) FROM supplier_offers so2 WHERE so2.product_id = p.id) as total_offer_count
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = ? AND so.factory_name = ?
ORDER BY p.product_name
```

### 报告格式

写入 `docs/v2.19d-partial-junk-audit.md`：

```markdown
# V2.19D 部分垃圾逐条审计报告

Generated: {timestamp}

## 总结

| 组 | 品类 | 工厂 | 产品数 | junk | suspect | keep |
|---|---|---|---:|---:|---:|---:|
| 1 | 灯带 | 尼奥 | 11 | ... | ... | ... |
| 2 | 面板灯 | 瑞鑫 | 46 | ... | ... | ... |
| 3 | 工作灯 | 启阳 | 41 | ... | ... | ... |
| 合计 | | | 98 | ... | ... | ... |

## 组 1: 灯带 — 尼奥

### junk（{count}）

| product_name | model_no | price | 原因 |
|---|---|---:|---|
| 6 | 6 | 6 | 纯数字名 |
| ... | ... | ... | ... |

### suspect（{count}）

| product_name | model_no | price | image | params | 原因 |
|---|---|---:|---|---:|---|
| ... | ... | ... | ... | ... | ... |

### keep（{count}）

| product_name | model_no | price | image | params |
|---|---|---:|---|---:|
| ... | ... | ... | ... | ... |

---

## 组 2: 面板灯 — 瑞鑫
（同上格式）

## 组 3: 工作灯 — 启阳
（同上格式）

## quote_items 引用检查

| 组 | 有引用的产品数 | 详情 |
|---|---:|---|
| 灯带 — 尼奥 | ... | ... |
| 面板灯 — 瑞鑫 | ... | ... |
| 工作灯 — 启阳 | ... | ... |
```

每个产品只出现在一个分类中（junk > suspect > keep 优先级）。

## 执行步骤

### Step 1: 新建审计脚本

创建 `scripts/partial-junk-audit.ts`。参考 `scripts/ruixue-audit.ts` 的 sqlite3 CLI 模式。

### Step 2: 运行

```bash
npx tsx scripts/partial-junk-audit.ts
```

### Step 3: 验证

确认报告覆盖全部 98 产品，每个产品有明确标记和原因。

### Step 4: 提交

```bash
git add scripts/partial-junk-audit.ts docs/v2.19d-partial-junk-audit.md
git commit -m "V2.19D: partial junk audit — per-product triage for 3 mixed groups"
```

## 验收标准

1. `docs/v2.19d-partial-junk-audit.md` 生成完整
2. 3 组合计 98 产品全部出现在报告中
3. 每个 `junk` 产品有标记原因
4. 每个 `suspect` 产品有标记原因 + image/params 信息辅助判断
5. `keep` 产品有价格/image/params 信息供复核
6. quote_items 引用检查结果明确
7. 脚本可重复运行（幂等，覆盖写入）

## 不做的事

- **不删除任何数据**
- 不改 schema
- 不修复价格（price=0 修复 → V2.19E）
- 不改任何前端代码
