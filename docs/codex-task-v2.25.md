# Codex Task: V2.25 — 普照三防灯旧价格异常审计 + 修正

## 目标

审计并修正 `PZ-HP-B1/B2` 系列 6 条 supplier_offers 的异常价格（price=1/2 RMB）。这些价格显然错误，若用户选到会导致导出 USD 价格严重失真。

## 背景

V2.24 PDF 导入发现，DB 中已存在 6 条普照三防灯 offer，价格为 1 或 2 RMB：

| 旧 model_no | 旧 price | 可能对应的 V2.24 正确 model | V2.24 正确 price |
|---|---:|---|---:|
| PZ-HP-B1-1*600 | 1 | PZ-HP-B-1*600 18W | 13.38 |
| PZ-HP-B1-1*1200 | 1 | PZ-HP-B-1*1200 36W | 24.31 |
| PZ-HP-B1-1*1500 | 1 | PZ-HP-B-1*1500 48W | 33.24 |
| PZ-HP-B2-1*600 | 2 | PZ-HP-B2-1*600 18W | 15.84 |
| PZ-HP-B2-1*1200 | 2 | PZ-HP-B2-1*1200 36W | 26.72 |
| PZ-HP-B2-1*1500 | 2 | PZ-HP-B2-1*1500 48W | 36.36 |

旧数据来源文件（双 .xlsx 扩展名值得注意）：
```
户外照明 工业照明/三防灯/普照/普照2025-10月更新/2025年10月份汇孚广交会报价-三防灯-净化灯/25年10月汇孚广交会双色管报价表25.10.13.xlsx.xlsx
```

V2.24 从 2025-04 PDF 导入了正确价格的产品，但 model_no 格式略有不同（`B-1*600` vs `B1-1*600`），所以旧产品和新产品可能共存为不同记录。

## 依赖

无新依赖。用 sqlite3 + tsx 脚本。

---

## 脚本：`scripts/puzhao-price-audit-v2.25.ts`（新建）

### 命令行接口

```bash
# Step 1: 只读审计
npx tsx scripts/puzhao-price-audit-v2.25.ts --audit

# Step 2: 修正（审计报告确认后）
npx tsx scripts/puzhao-price-audit-v2.25.ts --fix
```

### Step 1: --audit（只读）

查询并输出以下信息，写入 `docs/v2.25-puzhao-audit.md`：

#### 1.1 找到异常 offer

```sql
SELECT p.id, p.product_name, p.model_no, p.category, p.image_path,
       p.remark, p.size_display,
       so.id as offer_id, so.factory_name, so.purchase_price, so.currency,
       so.moq, so.ctn_qty, so.price_updated_at,
       f.file_name, f.relative_path
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
LEFT JOIN files f ON so.source_file_id = f.id
WHERE p.category = '三防灯'
  AND so.factory_name = '普照'
  AND p.model_no LIKE 'PZ-HP-B%'
ORDER BY p.model_no;
```

这会同时返回旧的 price=1/2 记录和 V2.24 新导入的正确价格记录，方便对比。

#### 1.2 检查 quote_items 引用

```sql
SELECT qi.id, qi.quote_id, qi.product_name, qi.model_no, qi.purchase_price,
       q.created_at as quote_date
FROM quote_items qi
JOIN quotes q ON qi.quote_id = q.id
JOIN supplier_offers so ON qi.offer_id = so.id
JOIN products p ON so.product_id = p.id
WHERE p.category = '三防灯'
  AND so.factory_name = '普照'
  AND p.model_no LIKE 'PZ-HP-B%';
```

如果有 quote_items 引用，记录但**不阻止修正**——错误价格的 quote_items 本身就是错误的。

#### 1.3 检查 product_params

```sql
SELECT pp.product_id, p.model_no, pp.param_key, pp.normalized_value, pp.unit
FROM product_params pp
JOIN products p ON pp.product_id = p.id
WHERE p.category = '三防灯'
  AND p.model_no LIKE 'PZ-HP-B%'
ORDER BY p.model_no, pp.param_key;
```

#### 1.4 检查源 Excel 文件

在 files 表中查找源文件记录：

```sql
SELECT id, file_name, relative_path, file_type
FROM files
WHERE relative_path LIKE '%汇孚广交会%双色管%'
   OR file_name LIKE '%双色管报价表25.10%';
```

#### 1.5 判定逻辑

对每条 model_no LIKE `PZ-HP-B1-%` 或 `PZ-HP-B2-%`（注意是 B1 不是 B-1）且 price ≤ 5 的 offer：

- 检查是否存在对应的 V2.24 正确产品（model_no 去掉 `1` 后匹配，如 `PZ-HP-B1-1*600` → `PZ-HP-B-1*600 18W`）
- 如果 V2.24 产品已存在且有正确价格 → 旧产品是重复品，标记为 `duplicate-delete`
- 如果 V2.24 产品不存在 → 标记为 `needs-price-correction`（但本次预期全部是 duplicate）

#### 1.6 报告格式

```markdown
# V2.25 — 普照三防灯价格异常审计

Generated: {timestamp}

## 异常 Offer 列表

| Product ID | Model | Price | Source File | V2.24 Match | Action |
|---|---|---:|---|---|---|

## Quote Items 引用检查

（无引用 / 有 N 条引用，列出）

## Product Params 检查

（有/无 params 需要处理）

## 建议操作

- 删除 N 条异常产品 + N 条异常 offer
- 删除 N 条关联 params
- 删除 N 条关联 price_history（如有）
```

### Step 2: --fix（写 DB）

只在审计报告确认全部是 `duplicate-delete` 时执行。

1. **备份 DB**：`cp prisma/dev.db backups/dev-before-v2.25-{timestamp}.sqlite`

2. **删除顺序**（外键安全）：
   - 删除 `price_history` WHERE offer_id IN (异常 offer ids)
   - 删除 `product_params` WHERE product_id IN (异常 product ids)
   - 删除 `supplier_offers` WHERE id IN (异常 offer ids)
   - 检查异常 product 是否还有其他 offer（来自其他工厂）
     - 如果没有其他 offer → 删除 product
     - 如果有其他 offer → 只删 offer，保留 product
   - 删除 `quote_items` WHERE offer_id IN (异常 offer ids)（如有）

3. **写结果报告** `docs/v2.25-puzhao-fix-result.md`：

```markdown
# V2.25 — 普照三防灯价格修正结果

Generated: {timestamp}
DB Backup: backups/dev-before-v2.25-{timestamp}.sqlite

## 操作摘要

| 操作 | 数量 |
|---|---:|
| Products deleted | N |
| Offers deleted | N |
| Params deleted | N |
| Price history deleted | N |
| Quote items deleted | N |

## 删除明细

（列出每条删除的 product/offer）

## 验证

| Metric | Before | After |
|---|---:|---:|
| 三防灯 products | X | Y |
| 三防灯 普照 offers | X | Y |
```

### 安全边界

- `--fix` 只删除 price ≤ 5 且 model_no 匹配 `PZ-HP-B1-%` 或 `PZ-HP-B2-%` 的记录
- 不碰 `PZ-HP-B-` 或 `PZ-HP-A` 系列（这些是正确的 V2.22/V2.24 导入）
- 如果审计发现任何预期外的情况（如旧产品有图片、有正常价格的 offer），报告并跳过，不自动删除
- `--audit` 不写 DB

---

## 执行步骤

### Step 1: 创建脚本

新建 `scripts/puzhao-price-audit-v2.25.ts`，包含 `--audit` 和 `--fix` 两个模式。

用 Prisma client 做查询（`import { PrismaClient } from "@prisma/client"`），用 `$queryRaw` 做复杂 JOIN 查询，用 `$executeRaw` 做删除。

### Step 2: 运行审计

```bash
npx tsx scripts/puzhao-price-audit-v2.25.ts --audit
```

检查 `docs/v2.25-puzhao-audit.md` 确认全部是 duplicate-delete。

### Step 3: 运行修正

```bash
npx tsx scripts/puzhao-price-audit-v2.25.ts --fix
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
```

```bash
sqlite3 prisma/dev.db "SELECT model_no, purchase_price FROM supplier_offers so JOIN products p ON so.product_id=p.id WHERE p.category='三防灯' AND so.factory_name='普照' AND p.model_no LIKE 'PZ-HP-B%' ORDER BY model_no"
```

确认只剩 V2.22/V2.24 导入的正确价格记录。

### Step 5: 提交

```bash
git add scripts/puzhao-price-audit-v2.25.ts docs/v2.25-puzhao-audit.md docs/v2.25-puzhao-fix-result.md
git commit -m "V2.25: audit and fix 普照三防灯 PZ-HP-B1/B2 price anomaly"
```

## 验收标准

1. 审计报告清晰列出 6 条异常 offer 及其来源、V2.24 对应关系
2. quote_items 引用已检查
3. 修正只删除确认的重复/错误记录
4. V2.22/V2.24 导入的正确记录不受影响
5. DB 备份存在
6. `tsc --noEmit` 通过
7. 修正后 `PZ-HP-B%` 只剩正确价格（13-37 RMB 范围）

## 不做的事

- 不碰其他工厂或其他品类的价格问题（尼奥/瑞鑫/欧诺留给 V2.19F）
- 不修改导入逻辑
- 不修改 schema
- 不做 UI 改动
