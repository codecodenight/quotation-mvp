# Codex Task: V2.19C — 明确垃圾数据删除（5 组 54 产品）

## 目标

备份 DB → 删除 V2.19B 扫描确认的 5 组明确垃圾数据（共 54 产品）→ 生成报告。**不动源 Excel 文件。**

## 背景

V2.19B 全品类污染扫描（`docs/v2.19b-pollution-scan.md`）发现 3 个 🔴 + 2 个 🟡 组合为明确垃圾。人工审阅确认（`docs/v2.19b-review.md`）这 5 组全部是列错位或表头误导入，可安全删除。

## 删除范围

精确匹配以下 5 个 `category + factory_name` 组合：

| # | category | factory_name | 预期产品数 | 根因 |
|---|---|---|---:|---|
| 1 | 吸顶灯 | 力音 | 11 | 尺寸/交期当产品名 |
| 2 | 面板灯 | 侧发光大面板灯核价明细（600x600）.xlsx | 10 | 规格备注当产品名 |
| 3 | 线条灯 | 广交会最终核价 | 6 | 序号当产品名 |
| 4 | 轨道灯 | 核价Wellux Quotation- Ordinary LED Track Light 2021-11-29.xlsx | 14 | 装箱单表头当产品名 |
| 5 | 灯带 | 迪闻 | 13 | 价格文本当产品名 |

**注意**：factory_name 第 2、3、4 组实际是文件名（导入脚本把文件名当工厂名了）。匹配时用精确等号，不用 LIKE。

## 实现

### 脚本：`scripts/junk-cleanup-v2.19c.ts`（新建）

用 `npx tsx scripts/junk-cleanup-v2.19c.ts` 运行。支持 `--dry-run`（默认）和 `--apply`。

### 目标集合

在脚本中硬编码 5 组匹配条件：

```typescript
const TARGET_GROUPS = [
  { category: "吸顶灯", factoryName: "力音" },
  { category: "面板灯", factoryName: "侧发光大面板灯核价明细（600x600）.xlsx" },
  { category: "线条灯", factoryName: "广交会最终核价" },
  { category: "轨道灯", factoryName: "核价Wellux Quotation- Ordinary LED Track Light 2021-11-29.xlsx" },
  { category: "灯带", factoryName: "迪闻" },
];
```

目标产品 SQL（用 OR 拼接 5 组条件）：

```sql
SELECT DISTINCT p.id
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE (p.category = '吸顶灯' AND so.factory_name = '力音')
   OR (p.category = '面板灯' AND so.factory_name = '侧发光大面板灯核价明细（600x600）.xlsx')
   OR (p.category = '线条灯' AND so.factory_name = '广交会最终核价')
   OR (p.category = '轨道灯' AND so.factory_name = '核价Wellux Quotation- Ordinary LED Track Light 2021-11-29.xlsx')
   OR (p.category = '灯带' AND so.factory_name = '迪闻')
```

### Dry-run 输出

```
=== V2.19C: 明确垃圾删除 (DRY RUN) ===

逐组统计：
  1. 吸顶灯 — 力音: 11 products / 11 offers
  2. 面板灯 — 侧发光大面板灯核价明细: 10 products / 10 offers
  3. 线条灯 — 广交会最终核价: 6 products / 6 offers
  4. 轨道灯 — Wellux Quotation: 14 products / 14 offers
  5. 灯带 — 迪闻: 13 products / 13 offers

合计：
  产品（将删除）: 54
  Offer（将删除）: 54
  product_params（将删除）: {count}
  price_history（将删除）: {count}

安全检查：
  ✅/❌ quote_items 引用: {count}
  ✅/❌ 总数在 50-58 范围内
```

### Apply 流程

1. **备份**：`cp prisma/dev.db backups/dev-before-v2.19c-{date}.sqlite`
2. **安全检查**：
   - quote_items 引用 = 0（否则 abort）
   - 目标产品数在 50-58 范围内（否则 abort）
3. **执行删除**（按顺序）：
   - DELETE FROM product_params WHERE product_id IN (目标产品)
   - DELETE FROM price_history WHERE supplier_offer_id IN (目标 offer)
   - DELETE FROM supplier_offers WHERE id IN (目标 offer)
   - DELETE FROM products WHERE id IN (目标产品)
4. **Post-delete 验证**：全局产品/offer/params 总数

### 报告

写入 `docs/v2.19c-cleanup-report.md`：

```markdown
# V2.19C 明确垃圾删除报告

Generated: {timestamp}
Backup: {backup_path}

## 逐组删除统计

| # | 品类 | 工厂/文件名 | 产品 | Offer | Params | Price History |
|---|---|---|---:|---:|---:|---:|
| 1 | 吸顶灯 | 力音 | 11 | 11 | ... | ... |
| ... | ... | ... | ... | ... | ... | ... |
| 合计 | | | 54 | 54 | ... | ... |

## 全局数据变化

| 指标 | 删前 | 删后 |
|---|---:|---:|
| 总产品 | 9,982 | ~9,928 |
| 总 Offer | 11,066 | ~11,012 |
| 总参数 | 37,197 | ... |
```

## 执行步骤

### Step 1: 新建脚本

创建 `scripts/junk-cleanup-v2.19c.ts`。参考 `scripts/ruixue-cleanup.ts` 的结构。

### Step 2: Dry-run

```bash
npx tsx scripts/junk-cleanup-v2.19c.ts --dry-run
```

确认总数 = 54 且 quote_items = 0。

### Step 3: Apply

```bash
npx tsx scripts/junk-cleanup-v2.19c.ts --apply
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
```

### Step 5: 提交

```bash
git add scripts/junk-cleanup-v2.19c.ts docs/v2.19c-cleanup-report.md
git commit -m "V2.19C: delete 54 junk products across 5 factory groups"
```

## 验收标准

1. `backups/dev-before-v2.19c-*.sqlite` 备份存在
2. `docs/v2.19c-cleanup-report.md` 生成完整
3. 删除产品数 = 54（5 组合计）
4. 每组删除数与 V2.19B 报告一致
5. 全局产品数 ≈ 9,928
6. `tsc --noEmit` 无错误

## 不做的事

- **不动源 Excel 文件**
- 不删除"部分垃圾"组（尼奥/瑞鑫/启阳 → V2.19D）
- 不修复 price=0 问题（伟润/欧诺 → V2.19E）
- 不改 schema
- 不改任何前端代码
