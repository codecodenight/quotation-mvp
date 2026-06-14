# V7.0B：源文件本地归档迁移

## 背景

V7.0A 审计确认：`files` 表中 1,725 条记录 `volume_name='My Passport'`，其中约 682 条被 `supplier_offers` / `price_history` FK 引用。未被引用的约 1,043 条是 PDF catalog/cert/spec 等非报价文件。

产品图片已在本地 `data/images/`。但 10,837 条 `supplier_offers` 的源文件溯源完全依赖外置硬盘。本次迁移把被引用的源文件复制到本地，更新 DB 路径，消除硬盘依赖。

## 前置条件

- 外置硬盘 "My Passport" 必须挂载在 `/Volumes/My Passport/`
- V7.0A 审计报告已存在（参考用，本脚本独立发现数据）

## 要求

写 `scripts/v7.0b-archive-migrate.ts`，输出报告到 `docs/v7.0b-migration-report.md`。

支持两种模式：
- `--dry-run`（默认）：只报告，不复制文件，不改 DB
- `--apply`：复制文件 + 更新 DB

### Step 0：备份数据库

仅 `--apply` 模式：
```
cp prisma/dev.db backups/dev-before-v7.0b-{timestamp}.sqlite
```

### Step 1：发现需要迁移的文件

查询 `files` 表中 `volume_name = 'My Passport'` 且满足以下至少一个条件的记录：
- 有 `supplier_offers.source_file_id` 引用
- 有 `price_history.old_source_file_id` 或 `new_source_file_id` 引用

统计：
- 需迁移文件数 + 总大小（MB/GB）
- 不需迁移（孤儿）文件数 + 总大小
- 按 `file_type` 分组统计

### Step 2：验证源文件存在

对每个需迁移的文件，检查 `absolute_path_snapshot` 指向的文件是否存在于磁盘。

报告：
- 存在的文件数
- 不存在的文件数 + 列表（前 20 个）

如果不存在文件超过总数的 10%，`--apply` 模式打印警告但继续执行（跳过不存在的文件）。

### Step 3：复制文件（仅 --apply）

目标目录：`data/source-archive/`

对每个存在的待迁移文件：
1. 目标路径 = `data/source-archive/{relative_path}`（保持原有目录结构）
2. 如果目标文件已存在且大小一致，跳过（幂等）
3. 创建必要的子目录
4. 复制文件

报告：复制数、跳过数、失败数、总大小。

### Step 4：更新 DB 路径（仅 --apply，事务内）

在 `prisma.$transaction` 中，对每个成功复制的文件：

```sql
UPDATE files SET
  volume_name = 'local',
  absolute_path_snapshot = '{project_root}/data/source-archive/{relative_path}'
WHERE id = ?
```

`relative_path` 保持不变（目录结构已保留）。

安全检查：更新前验证 `(volume_name='local', relative_path)` 不会与已有 local 记录冲突。

### Step 5：更新 .gitignore

如果 `.gitignore` 中没有 `data/source-archive/`，添加一行。

### Step 6：后验证

1. 所有已迁移文件的 `volume_name` 已变为 `'local'`
2. `supplier_offers` 引用的 `source_file_id` FK 仍然有效
3. `price_history` 引用的 FK 仍然有效
4. `files` 表总记录数未变
5. 未迁移的 My Passport 文件（孤儿 + 不存在）仍保持原路径
6. `data/source-archive/` 目录文件数 = 成功复制数

### 输出格式

`docs/v7.0b-migration-report.md` 包含：

1. **迁移概览** — 需迁移/孤儿/不存在分布、文件类型分布
2. **复制结果**（apply 模式）— 复制/跳过/失败计数 + 总大小
3. **DB 更新结果**（apply 模式）— 更新记录数
4. **后验证** — 6 项检查结果
5. **未迁移文件** — 孤儿文件列表（前 50 个）、不存在文件列表

## 验证

- `npx tsc --noEmit --pretty false` 通过
- dry-run 模式不改 DB、不复制文件
- apply 模式正确复制 + 更新 DB + 后验证全通过
- 报告已生成

## 不做

- 不复制孤儿文件（未被 FK 引用的 My Passport 文件）
- 不删除外置硬盘上的文件
- 不修改 `supplier_offers` / `price_history` / `products` 表
- 不处理 `customer_quote_files`（它没有 volume_name，路径语义不同）
- 不删除或修改 DB 中未迁移的 files 记录
