# Codex Task: V2.19E — 价格异常调查（伟润 + 欧诺 + 尼奥）

## 目标

调查 3 个 factory 组的价格异常问题，生成报告 `docs/v2.19e-price-audit.md`。**不修改任何数据。**

## 背景

V2.19B/D 扫描发现以下价格异常：

| 组 | category | factory_name | 产品数 | 问题 |
|---|---|---|---:|---|
| 1 | 线条灯 | 伟润 | 578 | 534 个 price=0，占 92%；型号正常（BG-149 等），参数覆盖 100% |
| 2 | 面板灯 | 欧诺 塑料 小面板灯 | 22 | 8 个 price=0 或 price=1；型号正常（LPR9-12WR 等） |
| 3 | 灯带 | 尼奥 | 8 | LST-2835 ×3 price=2835、LST-5050 ×2 price=5050（芯片型号当价格）；COB-240/288 price 可能是灯珠数 |

这些不是垃圾数据（产品名和参数正常），而是价格列检测错误或价格丢失。方向是**修复**不是删除。

## 调查内容

### 对每个组查询

**1. 价格分布**

```sql
SELECT
  CAST(so.purchase_price AS REAL) as price,
  COUNT(*) as cnt
FROM supplier_offers so
JOIN products p ON so.product_id = p.id
WHERE p.category = ? AND so.factory_name = ?
GROUP BY price
ORDER BY cnt DESC
LIMIT 20
```

**2. 源文件信息**

```sql
SELECT
  f.id as file_id,
  f.file_name,
  f.relative_path,
  COUNT(so.id) as offer_count
FROM supplier_offers so
JOIN products p ON so.product_id = p.id
LEFT JOIN files f ON so.source_file_id = f.id
WHERE p.category = ? AND so.factory_name = ?
GROUP BY f.id, f.file_name, f.relative_path
ORDER BY offer_count DESC
```

**3. 产品采样（price=0 和 price>0 各取 10 条）**

```sql
-- price=0 采样
SELECT p.product_name, p.model_no, so.purchase_price, p.remark, p.size
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = ? AND so.factory_name = ?
  AND (CAST(so.purchase_price AS REAL) = 0 OR so.purchase_price IS NULL)
ORDER BY p.product_name
LIMIT 10

-- price>0 采样
SELECT p.product_name, p.model_no, so.purchase_price, p.remark, p.size
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = ? AND so.factory_name = ?
  AND CAST(so.purchase_price AS REAL) > 0
ORDER BY p.product_name
LIMIT 10
```

**4. Price history 检查**

```sql
SELECT COUNT(*) as history_count,
  SUM(CASE WHEN CAST(old_price AS REAL) > 0 THEN 1 ELSE 0 END) as had_nonzero_price
FROM price_history ph
JOIN supplier_offers so ON ph.supplier_offer_id = so.id
JOIN products p ON so.product_id = p.id
WHERE p.category = ? AND so.factory_name = ?
```

如果 `had_nonzero_price > 0`，说明这些产品曾经有非零价格，后来被覆盖为 0（二次导入问题）。

**5. 尼奥专项：芯片型号价格检查**

```sql
SELECT p.product_name, p.model_no, so.purchase_price, p.remark
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '灯带' AND so.factory_name = '尼奥'
  AND CAST(so.purchase_price AS REAL) > 100
ORDER BY so.purchase_price DESC
```

### 源文件检查

对每个组找到的源文件路径，检查文件是否存在于磁盘：

```bash
test -f "/Volumes/My Passport/{relative_path}" && echo "EXISTS" || echo "MISSING"
```

如果文件存在，报告中标注"可重新导入"。如果不存在，标注"源文件缺失，无法修复"。

**注意**：不读取 Excel 文件内容，只检查文件是否存在。

## 报告格式

写入 `docs/v2.19e-price-audit.md`：

```markdown
# V2.19E 价格异常调查报告

Generated: {timestamp}

## 总结

| 组 | 品类 | 工厂 | 产品数 | price=0 | 异常价格 | 源文件 | 可修复？ |
|---|---|---|---:|---:|---:|---|---|
| 1 | 线条灯 | 伟润 | 578 | 534 | 0 | ... | ... |
| 2 | 面板灯 | 欧诺 | 22 | 8 | 0 | ... | ... |
| 3 | 灯带 | 尼奥 | 8 | 0 | 5 | ... | ... |

## 组 1: 线条灯 — 伟润

### 价格分布
（表格）

### 源文件
（表格 + 磁盘存在性）

### 产品采样
#### price=0（前 10）
（表格）
#### price>0（前 10）
（表格）

### Price history
（有无历史非零价格）

### 修复建议
{基于调查结果的修复方向}

---

## 组 2: 面板灯 — 欧诺
（同上）

## 组 3: 灯带 — 尼奥
（同上 + 芯片型号价格列表）

## 修复方案总结

| 组 | 方向 | 前提条件 |
|---|---|---|
| 伟润 | 重新导入 / 批量修正 / 标记不可报价 | 源文件存在且有正确价格列 |
| 欧诺 | 同上 | 同上 |
| 尼奥 | 人工修正 5 条价格 / 或从源文件重新提取 | 知道正确价格值 |
```

## 执行步骤

### Step 1: 新建调查脚本

创建 `scripts/price-audit-v2.19e.ts`。参考 `scripts/ruixue-audit.ts` 的 sqlite3 CLI 模式。

### Step 2: 运行

```bash
npx tsx scripts/price-audit-v2.19e.ts
```

### Step 3: 验证

确认报告生成完整，源文件存在性检查有结果。

### Step 4: 提交

```bash
git add scripts/price-audit-v2.19e.ts docs/v2.19e-price-audit.md
git commit -m "V2.19E: price anomaly audit — 伟润/欧诺/尼奥 investigation"
```

## 验收标准

1. `docs/v2.19e-price-audit.md` 生成完整
2. 3 组都有价格分布、源文件信息、产品采样、price_history 检查
3. 源文件磁盘存在性有明确结果
4. 修复建议基于实际数据（不是猜测）
5. 脚本可重复运行

## 不做的事

- **不修改任何数据**（价格修复是后续任务）
- 不读取 Excel 文件内容（只检查文件是否存在）
- 不改 schema
- 不删除产品
