# Codex Task: V2.19D Apply — 部分垃圾删除（40 junk + 1 suspect）

## 目标

备份 DB → 删除 V2.19D 审计确认的 40 个 junk 产品 + 1 个 suspect 产品（共 41）→ 生成报告。**不动源 Excel 文件。**

## 背景

V2.19D 审计报告（`docs/v2.19d-partial-junk-audit.md`）对 3 组 98 产品逐条标记。人工审阅确认：
- 40 个 `junk` 全部删除
- 1 个 `suspect`（工作灯-启阳 "COB" price=2100）也删除——是 LED 芯片类型标签，不是成品
- 2 个 `suspect`（尼奥 LST-5050）保留——真产品但价格错，归 V2.19E
- 55 个 `keep` 不动（其中部分有价格问题，后续处理）

## 删除范围

从 V2.19D 审计报告中提取的 41 个产品。用 product_name + category + factory_name 三元组精确匹配。

### 组 1: 灯带 — 尼奥（3 个 junk）

```
product_name IN ('6', '7', '8')
AND category = '灯带'
AND factory_name = '尼奥'
```

### 组 2: 面板灯 — 瑞鑫（22 个 junk）

```
product_name IN (
  '➕ 0.15', '➕0.2', '➕0.3', '➕0.4', '➕0.45',
  '➕0.5', '➕0.7', '➕0.8', '➕0.9', '➕1',
  '➕1.2', '➕1.3', '➕1.6', '➕1.8', '➕16',
  '➕2.1', '➕2.5', '➕2.6', '➕3.5', '➕4.2',
  '➕4.5', '➕5.1'
)
AND category = '面板灯'
AND factory_name = '瑞鑫'
```

### 组 3: 工作灯 — 启阳（15 个 junk + 1 个 suspect）

junk 15 个：
```
product_name IN (
  '1000PCS',
  '20W（SMD）',
  '3.7V 4400MAH Li battery',
  '3.7V 8800MAH Li battery',
  '7.4V 6600MAH Li battery',
  '7.4V1100MAH Li battery',
  '￥48.50', '￥49.20', '￥50.10',
  '￥59.46', '￥60.86', '￥61.90',
  '￥75.80', '￥77.90', '￥80.00'
)
AND category = '工作灯'
AND factory_name = '启阳'
```

suspect 1 个（追加）：
```
product_name = 'COB'
AND category = '工作灯'
AND factory_name = '启阳'
```

## 实现

### 脚本：`scripts/junk-cleanup-v2.19d.ts`（新建）

用 `npx tsx scripts/junk-cleanup-v2.19d.ts` 运行。支持 `--dry-run`（默认）和 `--apply`。

### 脚本结构

1. 硬编码 41 个目标产品的匹配条件（3 组，每组用 category + factory_name + product_name 列表）
2. 查找目标产品 ID
3. dry-run：显示各组命中数 + 安全检查
4. apply：备份 → 安全检查 → 级联删除 → 报告

### 目标产品查找

```sql
-- 用 UNION 合并 3 组
SELECT DISTINCT p.id
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE (p.category = '灯带' AND so.factory_name = '尼奥' AND p.product_name IN ('6','7','8'))
   OR (p.category = '面板灯' AND so.factory_name = '瑞鑫' AND p.product_name IN ('➕ 0.15','➕0.2',...))
   OR (p.category = '工作灯' AND so.factory_name = '启阳' AND p.product_name IN ('1000PCS','20W（SMD）',...,'COB'))
```

**注意**：product_name 含特殊字符（➕、￥、（）），SQL 中用参数化或小心转义。sqlite3 CLI 可用单引号包裹，内部单引号用 `''` 转义。

### 安全检查

1. 目标产品总数必须在 39-43 范围内（预期 41）
2. quote_items 引用必须 = 0
3. 逐组命中数必须匹配预期：灯带 3、面板灯 22、工作灯 16

### 级联删除顺序

```sql
DELETE FROM product_params WHERE product_id IN (目标产品 ID);
DELETE FROM price_history WHERE supplier_offer_id IN (目标产品的全部 offer ID);
DELETE FROM supplier_offers WHERE product_id IN (目标产品 ID);
DELETE FROM products WHERE id IN (目标产品 ID);
```

注意：删除产品的**全部** offer，不仅是匹配组的 offer（V2.19C 的教训）。

### 报告

写入 `docs/v2.19d-cleanup-report.md`：

```markdown
# V2.19D 部分垃圾删除报告

Generated: {timestamp}
Backup: {backup_path}

## 删除统计

| 组 | 品类 | 工厂 | 产品 | Offer | Params | Price History |
|---|---|---|---:|---:|---:|---:|
| 1 | 灯带 | 尼奥 | 3 | ... | ... | ... |
| 2 | 面板灯 | 瑞鑫 | 22 | ... | ... | ... |
| 3 | 工作灯 | 启阳 | 16 | ... | ... | ... |
| 合计 | | | 41 | ... | ... | ... |

## 全局数据变化

| 指标 | 删前 | 删后 |
|---|---:|---:|
| 总产品 | 9,928 | ~9,887 |
| 总 Offer | 10,985 | ... |

## 验证

- 剩余目标产品: 0
- quote_items 引用: 0
```

## 执行步骤

### Step 1: 新建脚本

创建 `scripts/junk-cleanup-v2.19d.ts`。参考 `scripts/junk-cleanup-v2.19c.ts`。

### Step 2: Dry-run

```bash
npx tsx scripts/junk-cleanup-v2.19d.ts --dry-run
```

确认总数 = 41 且 quote_items = 0。

### Step 3: Apply

```bash
npx tsx scripts/junk-cleanup-v2.19d.ts --apply
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
```

### Step 5: 提交

```bash
git add scripts/junk-cleanup-v2.19d.ts docs/v2.19d-cleanup-report.md
git commit -m "V2.19D: delete 41 partial-junk products (3 groups, per-product triage)"
```

## 验收标准

1. 备份存在
2. 报告生成完整
3. 删除产品数 = 41（灯带 3 + 面板灯 22 + 工作灯 16）
4. 全局产品数 ≈ 9,887
5. `tsc --noEmit` 无错误

## 不做的事

- **不动源 Excel 文件**
- 不删除 keep 产品（即使部分有价格问题）
- 不删除 2 个尼奥 LST-5050 suspect（保留，价格问题归 V2.19E）
- 不修复价格
- 不改 schema
