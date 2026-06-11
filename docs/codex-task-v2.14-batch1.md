# Codex Task: V2.14 Batch 1 — 自动批量导入（5 品类 309 文件）

## 目标

对 V2.13B 审阅通过的 5 个品类（投光灯 / 面板灯 / 线条灯 / 路灯 / 灯带）的 309 个 likely-importable 文件，自动检测文件结构并批量导入产品 + 报价。

**不修改源 Excel 文件。**

## 范围

| 品类 | 候选文件 | 工厂数 | 预估产品 |
|---|---:|---:|---:|
| 投光灯 | 75 | 6 | ~3,811 |
| 面板灯 | 107 | 24 | ~2,598 |
| 线条灯 | 73 | 11 | ~1,351 |
| 路灯 | 26 | 4 | ~1,163 |
| 灯带 | 28 | 6 | ~833 |
| **合计** | **309** | | **~9,756** |

数据来源：`docs/v2.13a-import-candidates.csv`，过滤条件：`classification == "likely-importable" AND category IN (投光灯, 面板灯, 线条灯, 路灯, 灯带)`。

## 背景

### 审阅决策（`docs/v2.13b-import-plan.md`）

- Batch 1 只做上述 5 个品类，其余 ⏸ Batch 2/3
- 每个工厂全部文件都导入，依靠 upsert 去重
- 图片提取包含在本次导入中
- `户外工厂-未判定` 和 `灯管/球泡` 不在本批

### 现有基础设施

| 模块 | 路径 | 复用方式 |
|---|---|---|
| V2.7 批量导入脚本 | `scripts/batch-import-v2.7.ts` | 参考结构：file record → build rows → import → images |
| V2.13A 自动检测逻辑 | `scripts/source-inventory.ts` | 复用：`findHeaderRows`、`isRmbPriceHeader`、`isLikelyModelValue`、`priceHintFromText` 等函数 |
| V2.10 upsert 逻辑 | `src/lib/supplier-offer-upsert.ts` | 直接调用 `upsertSupplierOffer(tx, input)` |
| 价格解析 | `src/lib/excel-import.ts` | 复用 `parsePriceValue`、`readSheetRows` |
| 图片提取 | `src/lib/image-extractor.ts` | 复用 `extractImagesFromExcel`、`storeExtractedImage` |

### 当前 DB 状态

| 指标 | 值 |
|---|---:|
| products | 2,140（26 品类） |
| supplier_offers | 2,230（2,029 有 source_file_id） |
| files (My Passport) | 477 |
| product_params | 2,755 |
| product_images | 1,119（52%） |
| 投光灯 products | 16 |
| 面板灯 products | 69 |
| 线条灯 products | 38 |
| 路灯 products | 15 |
| 灯带 products | 21 |

---

## 脚本架构

新建 `scripts/batch-import-v2.14.ts`。

### 运行模式

```bash
npx tsx scripts/batch-import-v2.14.ts              # dry-run（默认）
npx tsx scripts/batch-import-v2.14.ts --apply       # 写入 DB
npx tsx scripts/batch-import-v2.14.ts --apply --skip-images  # 写入但跳过图片
```

### 输入

从 `docs/v2.13a-import-candidates.csv` 读取文件列表，过滤：
- `classification == "likely-importable"`
- `category IN ("投光灯", "面板灯", "线条灯", "路灯", "灯带")`

每行已有：`path`（相对于 ROOT 的路径）、`category`、`factory`。

### 自动检测流程（每个文件）

```
读取 Excel → 遍历每个 sheet → analyzeSheet()
  ↓
选择可导入 sheet：有 headerRows + rmbPriceColumns + modelColumns
  ↓
对每个可导入 sheet：
  - headerRowIndex = headerRows[0]（1-indexed）
  - modelColumnIndex = modelColumns[0].index（按 count 降序，取第一个）
  - priceColumnIndex = rmbPriceColumns[0].index（按 count 降序，取第一个）
  - descriptionColumns = V2.7 的 detectOptionalMapping 逻辑
  ↓
提取数据行：从 headerRowIndex 开始
  - modelNo = row[modelColumnIndex]，跳过空值
  - purchasePrice = parsePriceValue(row[priceColumnIndex])，跳过空/非正数
  - description = 合并 description columns
  - CTN/MOQ = auto-detect optional columns
  ↓
构建 ImportRow[]
```

### 关键检测规则

1. **Header row**：复用 `findHeaderRows()`——扫描前 10 行，找含 `型号|model|单价|price|报价|rmb` 等关键词且非空列 ≥2 的行。取第一个。
2. **Price column**：优先 `rmbPriceColumns`（header 含 `rmb|人民币|含税|不含税|单价|价格|报价|工厂价|成本|采购|cny`），排除 `usd|fob|美金|$` 的列。如果 `rmbPriceColumns` 为空但 `priceColumns` 非空且文件名有 RMB hint → 用 `priceColumns[0]`。
3. **Model column**：`modelColumns[0]`——data 行中含字母+数字混合值最多的列。
4. **Price hint from filename**：文件名含 `核价|rmb|含税|采购` → RMB；含 `fob|usd|美金` → USD（这类文件已被 V2.13A 过滤为 enrichment-only，不应出现在 likely-importable 中，但做二次防护）。
5. **Sheet 选择**：一个文件可能有多个可导入 sheet，全部处理。但跳过行数 <3 的 sheet。

### Import 逻辑

复用 V2.10 的 `upsertSupplierOffer()`：

1. **Product 查找/创建**：
   - 先查 `product.findFirst({ where: { modelNo } })`
   - 已存在 → 复用 product（即使品类不同——同型号产品不重复创建）
   - 不存在 → 创建 product（category 从 CSV，productName = modelNo）
2. **Offer upsert**：
   - 调用 `upsertSupplierOffer(tx, { productId, factoryName, purchasePrice, currency: "RMB", ... })`
   - 已存在且价格相同 → skip
   - 已存在但价格不同 → update + 写 price_history
   - 已存在但 CTN/MOQ 为空而新数据有 → supplement
   - 不存在 → create
3. **File record**：
   - 复用 V2.7 的 `ensureFileRecord()` 逻辑
   - volume_name = "My Passport"
   - relative_path = CSV 中的 path 列
   - 如果 file 已在 DB → 复用

### 图片提取

复用 V2.7 的 `attachImages()` 逻辑：
- `extractImagesFromExcel(filePath)` 提取文件中所有图片
- 按 row 位置匹配到产品（rowRadius = 3，V2.12 标准）
- `storeExtractedImage()` 存到 `data/images/`，更新 `products.image_path`
- 只给无图片的产品补图（有图的不覆盖）

### 事务策略

- **每个文件一个事务**（不是每个 sheet，不是全局一个）
- 文件 A 失败不影响文件 B
- dry-run 模式不开事务，不写 DB

### 文件处理顺序

按品类分组，品类内按工厂分组，工厂内按修改日期升序（旧→新）。这样 upsert 会用最新文件的价格覆盖旧价格。

---

## 输出

### 报告文件

`docs/v2.14-batch1-report.md`，结构：

```markdown
# V2.14 Batch 1 — 批量导入报告

Generated: {timestamp}
Mode: dry-run / apply
Backup: {backup path, apply mode only}

## 总览

| 指标 | 值 |
|---|---:|
| 输入文件 | 309 |
| 成功处理 | X |
| 跳过（无可导入 sheet） | Y |
| 读取失败 | Z |
| 新建产品 | A |
| 复用产品 | B |
| 新建 offers | C |
| 更新 offers（价格变动） | D |
| 补充 offers（CTN/MOQ） | E |
| 跳过 offers（无变化） | F |
| 图片新提取 | G |
| price_history 新增 | H |

## 品类汇总

| 品类 | 文件 | 成功 | 新产品 | 复用 | 新 offers | 更新 | 图片 |
|---|---:|---:|---:|---:|---:|---:|---:|

## 跳过/失败文件

| 文件 | 品类 | 工厂 | 原因 |
|---|---|---|---|

## 自动检测命中统计

| 品类 | 文件 | header 检测到 | model 检测到 | RMB price 检测到 | fallback price | 无法检测 |
|---|---:|---:|---:|---:|---:|---:|

## 每文件明细（前 50 个）

| 文件 | 品类 | 工厂 | Sheets | 数据行 | 新产品 | 复用 | 新 offers | 更新 | 图片 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|

## 验证（apply mode only）

| 检查项 | 操作前 | 操作后 | 变化 |
|---|---:|---:|---:|
| products | 2,140 | ? | +? |
| supplier_offers | 2,230 | ? | +? |
| files (My Passport) | 477 | ? | +? |
| 投光灯 products | 16 | ? | +? |
| 面板灯 products | 69 | ? | +? |
| 线条灯 products | 38 | ? | +? |
| 路灯 products | 15 | ? | +? |
| 灯带 products | 21 | ? | +? |
| products with images | 1,119 | ? | +? |
| price_history | 0 | ? | +? |
| product_params | 2,755 | 2,755 | 0 |
| 悬空 offer refs | 0 | 0 | 0 |
```

---

## 执行步骤

### Step 1: 验证前置条件

- 确认 `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/` 可访问
- 确认 `docs/v2.13a-import-candidates.csv` 存在
- 读取 CSV，过滤 Batch 1 范围，验证得到 309 个文件
- 验证每个文件在硬盘上存在
- 如有文件不可访问 → 记录到报告，继续处理其余文件

### Step 2: 备份

```bash
cp prisma/dev.db backups/dev-before-v2.14-batch1-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 3: 实现脚本

新建 `scripts/batch-import-v2.14.ts`。

核心结构：

```typescript
// 1. 从 CSV 读取 Batch 1 文件列表
// 2. 对每个文件：
//    a. 读取 Excel（SheetJS）
//    b. 对每个 sheet 做 analyzeSheet()
//    c. 选择可导入的 sheets（有 header + RMB price + model）
//    d. 对每个可导入 sheet：
//       - 自动检测列映射
//       - 提取数据行
//       - 构建 ImportRow[]
//    e. 如果是 apply 模式：
//       - 注册 file record
//       - 在事务中 upsert products + offers
//       - 提取图片（除非 --skip-images）
//    f. 记录结果到报告
// 3. 写入报告文件
```

**关键实现要求：**

- 从 `scripts/source-inventory.ts` 提取并复用检测函数（`findHeaderRows`、`isRmbPriceHeader`、`isLikelyModelValue`、`priceHintFromText`、`parsePositivePrice` 等）。可以：
  - 方案 A：提取到独立的 `src/lib/sheet-detection.ts` 供两个脚本共用
  - 方案 B：在 V2.14 脚本中直接复制这些函数
  - **推荐方案 A**，避免代码重复
- 从 `scripts/batch-import-v2.7.ts` 复用：`ensureFileRecord()`、`attachImages()`、`detectOptionalMapping()`（改为接受自动检测的 header/model/price 参数而非手动字母）
- 直接 import `upsertSupplierOffer` from `src/lib/supplier-offer-upsert.ts`
- 直接 import `parsePriceValue` from `src/lib/excel-import.ts`

### Step 4: Dry-run

```bash
npx tsx scripts/batch-import-v2.14.ts
```

- 不写 DB
- 处理全部 309 个文件
- 输出 `docs/v2.14-batch1-report.md`（dry-run 版）
- 有进度输出（每处理 10 个文件打一次进度）

### Step 5: Apply

```bash
npx tsx scripts/batch-import-v2.14.ts --apply
```

- 先自动备份（Step 2）
- 处理全部 309 个文件
- 写入 DB
- 输出 `docs/v2.14-batch1-report.md`（覆盖 dry-run 版，标注为 apply）
- 运行验证查询，追加到报告

### Step 6: 验证 + 提交

```sql
-- 行数验证
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM supplier_offers;
SELECT COUNT(*) FROM files WHERE volume_name = 'My Passport';
SELECT COUNT(*) FROM price_history;

-- 品类维度
SELECT category, COUNT(*) FROM products GROUP BY category ORDER BY COUNT(*) DESC;

-- 悬空引用检查
SELECT COUNT(*) FROM supplier_offers so
WHERE so.source_file_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id = so.source_file_id);
-- 期望: 0

-- product_params 不变
SELECT COUNT(*) FROM product_params;
-- 期望: 2,755
```

- 结果追加到报告
- `npm run build` 通过（或 `npx tsc --noEmit`）
- git commit

---

## 边界情况处理

### Sub-header 行

很多工厂文件在数据区中间有分类行（如"— 一体三色 —"）。判断规则：
- 如果一行只有 1 个非空列 → 跳过（sub-header）
- 如果 model 列为空 → 跳过
- 如果 price 列非有效正数 → 跳过

### 合并单元格 / Fill-down

有些文件的 model 列使用合并单元格或 fill-down 模式（上方单元格有值，下方为空但属于同一型号）。SheetJS 读取合并单元格时，只有左上角有值。

**V2.14 默认启用 fill-down**：对 model 列，如果当前行 model 为空但 price 列有值 → 继承上一行的 model。

### 多 sheet 文件

一个文件可能有多个可导入的 sheet。例如凯晟德的投光灯文件可能有"10W"、"20W"、"50W"等 sheet。全部处理，但：
- 跳过 sheet 名含 `目录|index|cover|封面` 的
- 跳过数据行 <3 的

### 文件名中的品类关键词

对于灯带品类的文件，factory 字段可能是子目录名（如"虹宇"、"广交会最终核价"）。"广交会最终核价"不是工厂名，但包含有效数据。factory_name 使用 CSV 的 factory 列原值，不做特殊处理。

### 价格数值范围

合理的 RMB 单价范围：0.01 ~ 100,000。超出此范围的值跳过并记录。

---

## 不做的事

- 不处理 `户外工厂-未判定` 的 16 个文件
- 不处理 `灯管/球泡` 的 27 个文件（需先拆品类）
- 不导入 enrichment-only / needs-review / likely-skip 文件
- 不修改 product_params
- 不修改源 Excel 文件
- 不改 UI / 导出模板 / API
- 不做品类合并或重命名

## 注意事项

- 源 Excel 文件绝不修改
- SheetJS 读文件如果报错，记录错误但继续下一个文件
- 单个文件的事务失败不阻塞其他文件
- 预计处理 309 个文件，耗时可能 10-30 分钟，脚本必须有进度输出
- 图片提取可能额外增加 10-20 分钟
- Schema 变更用 raw SQL + sqlite3（Prisma schema-engine 在此机器有 empty error bug）
- 报告文件路径：`docs/v2.14-batch1-report.md`
- 外接硬盘如果未挂载，Step 1 直接停止
