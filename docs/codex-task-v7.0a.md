# V7.0A：硬盘依赖审计

## 背景

系统的源文件（Excel/PDF）存储在外置硬盘 "My Passport" 上。`files` 表中 1,725 条记录的 `volume_name = 'My Passport'`，仅 12 条 `volume_name = 'local'`。10,837 条 `supplier_offers` 通过 `source_file_id` 引用外置硬盘文件。

产品图片已提取到本地 `data/images/`（7,453 产品有图）。DB 本身是本地 SQLite。但源文件溯源完全依赖外置硬盘 — 硬盘断开则无法追溯任何 offer 的来源文件。

本次审计评估硬盘依赖的范围和影响，为 V7.0B 本地归档迁移提供决策数据。

**本次为只读审计，不改库。**

## 要求

写 `scripts/v7.0a-drive-audit.ts`，输出报告到 `docs/v7.0a-drive-audit.md`。

### Step 1：files 表依赖概览

统计 `files` 表：

1. 按 `volume_name` 分组计数
2. 按 `file_type` × `volume_name` 分组计数
3. 外置硬盘文件总大小（`file_size` 求和，转 GB）
4. 外置硬盘文件按顶层目录（`relative_path` 的第一级路径段）分组计数

### Step 2：FK 依赖分析

统计引用外置硬盘文件的 FK 关系：

1. `supplier_offers.source_file_id` → 引用 My Passport 文件的 offer 数量
2. `supplier_offers` 中 `source_file_id IS NULL` 的数量（V6.1 stale cleanup 遗留）
3. `price_history.old_source_file_id` / `new_source_file_id` → 引用 My Passport 的记录数
4. `raw_products.source_file_id` → 引用 My Passport 的记录数
5. 哪些 My Passport 文件完全没有被任何 FK 引用（孤儿文件）

### Step 3：运行时依赖分析

扫描 `src/` 目录下所有 `.ts` / `.tsx` 文件（不含 `scripts/`），查找：

1. 使用 `files` 表 `relative_path` / `absolute_path_snapshot` / `volume_name` 的代码位置
2. 读取外部文件（`fs.readFile`/`readFileSync` 等）且路径来源为 DB 的代码
3. 使用 `source_file_id` 关联的代码位置

目的：确定哪些运行时功能（非导入脚本）依赖外置硬盘文件可读。

### Step 4：产品图片独立性验证

1. 确认所有 `products.image_path` 都指向 `data/images/` 本地目录
2. 检查是否有任何 image_path 指向外置硬盘路径
3. 确认 `data/images/` 目录实际存在且非空

### Step 5：customer_quote_files 依赖

1. `customer_quote_files` 表是否有路径字段引用外置硬盘
2. 如果有，统计依赖量

### Step 6：迁移规模估算

基于以上数据，计算：

1. 被 FK 引用的外置硬盘文件数量和总大小
2. 未被引用的外置硬盘文件数量和总大小
3. 运行时功能是否会因硬盘断开而中断（基于 Step 3 结果）
4. 如果只迁移"被引用"文件，需要多少本地空间

### 输出格式

`docs/v7.0a-drive-audit.md` 包含：

1. **依赖概览** — volume 分组、file_type 分布、顶层目录分布
2. **FK 依赖** — 各表引用计数、孤儿文件数
3. **运行时依赖** — 引用 files 表路径的代码位置列表 + 影响评估
4. **图片独立性** — 本地 vs 外置硬盘 image_path 统计
5. **客户报价依赖** — customer_quote_files 路径依赖
6. **迁移规模** — 被引用文件数/大小、运行时影响总结
7. **建议** — V7.0B 迁移策略建议（迁移范围、预估空间、优先级）

## 验证

- `npx tsc --noEmit --pretty false` 通过
- 脚本运行不修改 DB
- 报告已生成

## 不做

- 不改库
- 不移动/复制文件
- 不修改 files 表路径
- 不实现迁移逻辑
