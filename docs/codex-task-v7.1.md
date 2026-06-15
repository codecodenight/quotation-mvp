# V7.1：彻底清除移动硬盘依赖

## 背景

V7.0B 已将 681 个被 offer 引用的源文件复制到 `data/source-archive/`。但 files 表仍有 1,044 条 `volume_name='My Passport'` 记录：
- 1,043 条孤儿（无任何 FK 引用，安全删除）
- 1 条碰撞文件（ID `07dec2c3-d664-4d47-bd65-6bb4126ddfd1`，15 条 offer 引用）

本任务目标：files 表中 My Passport 记录归零。

## 要求

写 `scripts/v7.1-drive-cleanup.ts`，支持 `--dry-run`（默认）和 `--apply`。

### Step 0：备份（仅 --apply）

```
cp prisma/dev.db backups/dev-before-v7.1-{timestamp}.sqlite
```

### Step 1：解决碰撞文件

碰撞文件 `07dec2c3-d664-4d47-bd65-6bb4126ddfd1`：
- volume_name = 'My Passport'
- relative_path = '核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx'
- file_size = 27,461,689

它的本地副本 `591cc262-bda4-4598-b12f-89148a773ee8`：
- volume_name = 'local'
- relative_path = '核价- Quotation- LED Solar Wall Light & Garden Light - 20240521.xlsx'
- file_size = 27,461,689（完全一致）

操作：
1. 将引用碰撞文件的 15 条 `supplier_offers.source_file_id` 从 `07dec2c3...` 改指 `591cc262...`
2. 检查 `price_history.old_source_file_id` 和 `price_history.new_source_file_id` 是否引用 `07dec2c3...`（预期为 0）
3. 删除 files 表中 `07dec2c3...` 这条记录

### Step 2：删除孤儿 My Passport 记录

删除 files 表中所有满足以下条件的记录：
- `volume_name = 'My Passport'`
- `id NOT IN (SELECT DISTINCT source_file_id FROM supplier_offers WHERE source_file_id IS NOT NULL)`
- `id NOT IN (SELECT DISTINCT old_source_file_id FROM price_history WHERE old_source_file_id IS NOT NULL)`
- `id NOT IN (SELECT DISTINCT new_source_file_id FROM price_history WHERE new_source_file_id IS NOT NULL)`

Step 1 执行后，碰撞文件已无引用，也会被这个条件删掉——如果 Step 1 已删则跳过。

### Step 3：验证

6 项验证（全部必须 PASS）：

1. `files` 表中 `volume_name = 'My Passport'` 记录数 = 0
2. `supplier_offers` 中无 `source_file_id` 指向不存在的 files 记录
3. `price_history` 中无 `old_source_file_id` 或 `new_source_file_id` 指向不存在的 files 记录
4. `supplier_offers` 总数不变（11,084）
5. `price_history` 总数不变（9,857）
6. `files` 总数 = 之前的总数 - 删除数

### Step 4：报告

输出到 `docs/v7.1-drive-cleanup-report.md`：
- 碰撞文件处理：迁移的 offer 数
- 孤儿记录删除：按文件类型（xlsx/xls/pdf/other）统计
- files 表 before/after 按 volume_name 统计
- 6 项验证结果

## 验证

- `npx tsc --noEmit --pretty false` 通过
- dry-run 不改 DB
- apply 后 files 表零 My Passport 记录

## 不做

- 不动 supplier_offers/products/product_params 的其他字段
- 不动 data/source-archive/ 目录内容
- 不动 local 文件记录
- 不修改 file-paths.ts 或其他运行时代码
