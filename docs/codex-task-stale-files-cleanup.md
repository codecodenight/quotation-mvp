# Codex Task: Stale Files 表记录清理

## 目标

清理 `files` 表中 258 条在硬盘上已找不到的 stale 记录。保留所有产品和报价数据不动。

## 背景

`docs/drive-db-diff-report.md` 的比对结果：
- 硬盘文件被用户重新整理过目录结构
- 258 条 DB `files` 记录在硬盘上找不到（路径+文件名+大小均不匹配）
- 其中 9 条被 `supplier_offers.source_file_id` 引用（共 201 条 offers）
- 其中 3 条是通用名图片（`图片1.png`、`02.jpg`、`Christy-quotation...pdf`），有候选但无法确认 → 不处理
- 其余 249 条无任何 import 引用

### 9 条有引用的源文件

| 文件名 | offers 数 | 品类 |
|---|---:|---|
| 3.Kyqee Track light（CNY).xls | 151 | 轨道灯 |
| 优泽价格产品系列 2023.10.xlsx | 24 | 球泡 |
| 中山开启轨道系列报价2021.5.13.xlsx | 17 | 磁吸灯 |
| 炬星应急灯管报价单（欧标汇孚林总).xls | 3 | 球泡 |
| 东莞弘磊照明科技有限公司报价表--杭州汇孚.xls | 2 | 地埋灯 |
| 二代五星庭院灯AX-FB-TYD garden light20240316.xls | 1 | 庭院灯 |
| 荣耀庭院灯AX-FB-TYD garden light 20240316.xls | 1 | 庭院灯 |
| 菱形庭院灯报价含税-202309.xls | 1 | 庭院灯 |
| 云霄庭院灯报价.xlsx | 1 | 庭院灯 |

## 前置条件

- `docs/drive-db-diff-report.md` 已生成（2026-06-11）
- DB 当前状态：2,140 products / 2,230 offers / 735 files（My Passport）/ 2,755 product_params
- 工作树 clean

---

## Step 0: 备份 + 验证前置

```bash
cp prisma/dev.db backups/dev-before-stale-files-cleanup-$(date +%Y%m%d-%H%M%S).sqlite
```

验证当前状态：

```sql
SELECT COUNT(*) FROM files WHERE volume_name = 'My Passport';
-- 期望: 735

SELECT COUNT(*) FROM supplier_offers WHERE source_file_id IS NOT NULL;
-- 记录初始值

SELECT COUNT(*) FROM raw_products;
-- 记录初始值
```

将结果写入 `docs/stale-files-cleanup-report.md`。

---

## Step 1: 识别 stale file IDs

从 `docs/drive-db-diff-report.md` 和 `docs/drive-db-diff-details.csv` 中提取所有 status = `db-file-missing-no-match` 的 file 记录。

验证方式：用脚本读取 CSV，提取 `db-file-missing-no-match` 行的 DB path，然后查 `files` 表匹配 `absolute_path_snapshot`，得到 file IDs。

**关键**：排除 3 条 `db-path-missing-candidate-on-disk` 的记录（`图片1.png`、`02.jpg`、`Christy-quotation-LED STRIP LIGHT - 202305.pdf`），只处理 `db-file-missing-no-match`。

期望得到 **258 个 file IDs**。如果数量不符，在报告中说明差异原因。

---

## Step 2: 检查引用关系（dry-run）

对 258 个 stale file IDs，分别查询：

```sql
-- supplier_offers 引用
SELECT f.id, f.file_name, COUNT(so.id) as offer_count
FROM files f
JOIN supplier_offers so ON so.source_file_id = f.id
WHERE f.id IN (<stale_ids>)
GROUP BY f.id;

-- raw_products 引用（ON DELETE RESTRICT，不能直接删）
SELECT f.id, f.file_name, COUNT(rp.id) as raw_count
FROM files f
JOIN raw_products rp ON rp.source_file_id = f.id
WHERE f.id IN (<stale_ids>)
GROUP BY f.id;

-- price_history 引用
SELECT f.id, f.file_name,
  COUNT(CASE WHEN ph.old_source_file_id = f.id THEN 1 END) as old_refs,
  COUNT(CASE WHEN ph.new_source_file_id = f.id THEN 1 END) as new_refs
FROM files f
JOIN price_history ph ON ph.old_source_file_id = f.id OR ph.new_source_file_id = f.id
WHERE f.id IN (<stale_ids>)
GROUP BY f.id;
```

将引用汇总写入报告。

**期望**：
- supplier_offers 引用：9 个 file IDs，共 201 条 offers
- raw_products 引用：需要确认数量（之前未统计）
- price_history 引用：可能为 0（当前 price_history 0 条记录）

---

## Step 3: dry-run 报告

**不写 DB**。生成 dry-run 报告到 `docs/stale-files-cleanup-report.md`，包含：

### 3.1 操作计划

| 操作 | 记录数 | 说明 |
|---|---:|---|
| raw_products.source_file_id 需处理 | ? | ON DELETE RESTRICT，必须先解除引用 |
| supplier_offers.source_file_id → NULL | ? | 解除引用（虽然 ON DELETE SET NULL 会自动做，但显式更安全） |
| price_history 引用 → NULL | ? | 如有 |
| files 记录删除 | 258 | stale 记录 |
| 不处理（候选） | 3 | 通用名，无法确认 |

### 3.2 受影响的 supplier_offers 明细

列出每个 file 对应的 offers：file_name、offer 数量、涉及品类。

### 3.3 raw_products 处理方案

如果有 raw_products 引用 stale files：
- 方案 A：将 `raw_products.source_file_id` 指向一个 placeholder file 记录（如 `[stale-source]`）
- 方案 B：直接删除这些 raw_products 记录（如果它们只是导入中间态）

**在报告中列出受影响的 raw_products 数量和方案建议，但不做选择。这是本任务唯一的停止点。**

### 3.4 验证预期

| 检查项 | 操作前 | 操作后预期 |
|---|---:|---:|
| files (My Passport) | 735 | 477 (735 - 258) |
| files (total) | 747 | 489 (747 - 258) |
| supplier_offers | 2,230 | 2,230（不变） |
| products | 2,140 | 2,140（不变） |
| offers with source_file_id | ? | ? - 201 |
| raw_products | ? | 取决于方案 |
| product_params | 2,755 | 2,755（不变） |

---

## Step 4: 等用户确认

**STOP。** 等用户审阅 `docs/stale-files-cleanup-report.md` 后再执行 apply。

用户需要确认：
1. raw_products 处理方案（A 或 B）
2. 258 条删除 + 201 条 NULL 是否符合预期

---

## Step 5: apply

用户确认后执行。**所有操作在一个事务中。**

```sql
BEGIN;

-- 5.1 处理 raw_products 引用（按用户确认的方案）
-- （具体 SQL 在 dry-run 报告确认后确定）

-- 5.2 supplier_offers.source_file_id → NULL
UPDATE supplier_offers SET source_file_id = NULL
WHERE source_file_id IN (<9_stale_file_ids_with_refs>);

-- 5.3 price_history 引用 → NULL（如有）
UPDATE price_history SET old_source_file_id = NULL
WHERE old_source_file_id IN (<stale_ids>);
UPDATE price_history SET new_source_file_id = NULL
WHERE new_source_file_id IN (<stale_ids>);

-- 5.4 删除 258 条 stale file 记录
DELETE FROM files WHERE id IN (<258_stale_ids>);

COMMIT;
```

---

## Step 6: 验证 + 提交

```sql
-- 行数验证
SELECT COUNT(*) FROM files WHERE volume_name = 'My Passport';
-- 期望: 477

SELECT COUNT(*) FROM supplier_offers;
-- 期望: 2,230（不变）

SELECT COUNT(*) FROM products;
-- 期望: 2,140（不变）

SELECT COUNT(*) FROM product_params;
-- 期望: 2,755（不变）

-- 确认无悬空引用
SELECT COUNT(*) FROM supplier_offers so
WHERE so.source_file_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id = so.source_file_id);
-- 期望: 0

SELECT COUNT(*) FROM raw_products rp
WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.id = rp.source_file_id);
-- 期望: 0
```

- 结果追加到 `docs/stale-files-cleanup-report.md`
- `npm test` / `npm run lint` / `npm run build` 通过
- git commit

---

## 不做的事

- 不删 products 或 supplier_offers 或 product_params
- 不处理 3 条 `db-path-missing-candidate-on-disk` 记录
- 不修改 474 条路径匹配正常的 files 记录
- 不扫描硬盘新增文件（那是 V2.13A 的事）
- 不改任何源 Excel 文件
- 不改 UI / 导出模板 / API

## 注意事项

- Schema 变更用 raw SQL + sqlite3（Prisma schema-engine 在此机器有 empty error bug）
- `raw_products` 的 FK 是 `ON DELETE RESTRICT`，**必须**先解除引用才能删 file 记录
- 脚本从 `docs/drive-db-diff-details.csv` 读取 stale file 列表，不要硬编码 file IDs
- 报告文件路径：`docs/stale-files-cleanup-report.md`
