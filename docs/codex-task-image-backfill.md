# Codex Task: Image Backfill — 为已导入产品补充图片

## 目标

为 1,646 个没有 `image_path` 的已有产品从源 Excel 文件中提取并关联图片。

## 背景

- V2.6 加入了图片提取能力（.xlsx zip 解压 + .xls LibreOffice 转换）
- V2.7/V2.8 导入时已自动提取图片（486 个产品有图）
- V2.1 及更早的导入没有图片提取，这些产品的源文件可能包含嵌入图片但从未被提取

## 关键约束

- `products` 表没有 `source_file_id` 或 `source_row_index`
- `supplier_offers` 表有 `source_file_id`，可通过 `product_id` 关联到产品
- 图片提取依赖 `image-extractor.ts` 中的 `extractImagesFromExcel()`，返回 `ExtractedImage[]`（含 `anchorRow`）
- 匹配逻辑：image anchor row → 同行的 model_no → 已有产品
- 源 Excel 文件绝不修改
- 缩略图存储规范：300px max width, JPEG, `data/images/` 目录

## Step 0: 审计（只读）

1. 查询无图产品数：`SELECT COUNT(*) FROM products WHERE image_path IS NULL`
2. 通过 supplier_offers 关联找到这些产品的源文件：
   ```sql
   SELECT DISTINCT f.id, f.volume_name, f.relative_path, f.file_name,
          COUNT(DISTINCT p.id) as product_count
   FROM products p
   JOIN supplier_offers so ON so.product_id = p.id
   JOIN files f ON f.id = so.source_file_id
   WHERE p.image_path IS NULL
   GROUP BY f.id
   ORDER BY product_count DESC;
   ```
3. 统计：涉及多少个源文件、.xlsx vs .xls 比例、外置硬盘路径是否可访问
4. 抽样 3 个产品数最多的源文件，尝试 `extractImagesFromExcel()` 看是否有嵌入图片
5. 将审计结果写入 `docs/image-backfill-audit.md`

**STOP — 等确认后继续**

## Step 1: 编写 backfill 脚本

创建 `scripts/image-backfill.ts`（或在现有脚本基础上扩展），逻辑：

1. 查询所有无图产品 + 其 supplier_offers 的 source_file_id
2. 按 source_file_id 分组
3. 对每个源文件：
   a. 检查文件是否存在且可读
   b. 用 `extractImagesFromExcel(filePath, sheetName)` 提取图片
   c. 用 SheetJS 读取 Excel 获取每行的 cell 值
   d. 对每个提取到的 image（有 anchorRow），在该行和相邻行搜索匹配已有产品 model_no 的 cell
   e. 匹配成功且产品无图 → `storeExtractedImage()` 存储缩略图 → 更新 `products.image_path`
4. 支持 dry-run 模式（`--dry-run` 参数，只统计不写库）
5. 输出统计：处理文件数、提取图片数、成功匹配数、未匹配数、已有图跳过数

## Step 2: Dry-run

运行 backfill 脚本 dry-run 模式，将结果写入 `docs/image-backfill-dryrun.md`。

**STOP — 等确认后 apply**

## Step 3: Apply

1. 备份 DB
2. 运行 backfill 脚本 apply 模式
3. 将结果写入 `docs/image-backfill-result.md`
4. 验证：
   - `SELECT COUNT(*) FROM products WHERE image_path IS NOT NULL` 应增加
   - 抽查 5 个新增图片的产品，确认缩略图文件存在且可显示
5. git commit

## 注意事项

- 外置硬盘必须挂载（`/Volumes/My Passport/`）
- .xls 文件需要 LibreOffice（`soffice`）可用
- 同一个 anchorRow 可能对应 fill-down 后的多个产品 — 只给第一个匹配的产品赋图，或给同 model_no 的所有变体赋同一图
- 部分源文件可能没有嵌入图片（纯数据表），跳过即可
- 不要为已有 image_path 的产品覆盖图片
