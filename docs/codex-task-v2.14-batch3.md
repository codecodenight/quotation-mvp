# Codex Task: V2.14 Batch 3 — 剩余品类批量导入（115 文件）

## 目标

导入 V2.14 Batch 1/2 之后剩余的全部 likely-importable 文件：3 个新品类 + 13 个现有品类补导。

**不修改源 Excel 文件。**

## 范围

| 品类（DB 名） | CSV 品类名 | 候选文件 | DB 现有产品 | 类型 |
|---|---|---:|---:|---|
| 风扇灯 | 风扇灯 | 20 | 0 | 新品类 |
| 工作灯 | 工作灯 | 16 | 0 | 新品类 |
| G4G9 | G4G9 | 5 | 0 | 新品类 |
| 太阳能壁灯 | 太阳能壁灯 | 20 | 87 | 补导 |
| Highbay | Highbay | 11 | 6 | 补导 |
| 壁灯 | 市电壁灯 | 7 | 27 | 补导（映射） |
| 皮线灯 | 皮线灯 | 7 | 3 | 补导 |
| 应急灯 | 应急灯 | 6 | 70 | 补导 |
| 地埋灯/地插灯 | 地埋灯/地插灯 | 5 | 58 | 补导 |
| 太阳能 | 太阳能 | 5 | 174 | 补导 |
| 橱柜灯 | LED橱柜灯 | 3 | 134 | 补导（映射） |
| 灯丝灯 | 灯丝灯 | 3 | 471 | 补导 |
| 线条灯 | 支架 | 2 | 1,119 | 补导（映射） |
| 庭院灯 | 庭院灯 | 2 | 74 | 补导 |
| 台灯 | 台灯 | 2 | 23 | 补导 |
| 轨道灯 | 轨道灯 | 1 | 155 | 补导 |
| **合计** | | **115** | | **预估 ~4,213 新产品** |

### 品类名映射（3 个需要映射）

| CSV 品类名 | → DB 品类名 | 原因 |
|---|---|---|
| LED橱柜灯 | 橱柜灯 | V2.13B 决定：归入现有品类 |
| 市电壁灯 | 壁灯 | V2.13B 决定：归入现有品类 |
| 支架 | 线条灯 | V2.13B 决定：支架归入线条灯 |

---

## 实现方式

**扩展现有 `scripts/batch-import-v2.14.ts`**，增加 Batch 3 配置 + 品类映射功能。

### 需要改的

1. `BATCH_CONFIGS` 增加 `"3"` 条目
2. 新增 `CATEGORY_MAP: Record<string, string>` 常量（3 个映射）
3. CSV 过滤逻辑：`SCAN_CATEGORY_SET` 用 CSV 品类名；产品写入用映射后名称
4. 报告模板中的品类列表

### 不需要改的

- 自动检测逻辑（header / model / price / sheet 选择）
- upsert 逻辑
- 图片提取逻辑
- 事务策略（每文件一事务）
- fill-down / sub-header 跳过

---

## 改动细节

### 1. BATCH_CONFIGS 增加 Batch 3

```typescript
"3": {
  label: "Batch 3",
  reportPath: "docs/v2.14-batch3-report.md",
  backupPrefix: "dev-before-v2.14-batch3",
  expectedInputFiles: 115,
  categories: [
    "风扇灯", "工作灯", "G4G9",
    "太阳能壁灯", "Highbay", "市电壁灯", "皮线灯",
    "应急灯", "地埋灯/地插灯", "太阳能", "LED橱柜灯",
    "灯丝灯", "支架", "庭院灯", "台灯", "轨道灯",
  ],
},
```

注意：`categories` 数组用 **CSV 品类名**（和 CSV 文件中的 category 列匹配），不是 DB 品类名。

### 2. 品类映射

在 `BATCH_CONFIGS` 之后新增：

```typescript
const CATEGORY_MAP: Record<string, string> = {
  "LED橱柜灯": "橱柜灯",
  "市电壁灯": "壁灯",
  "支架": "线条灯",
};

function resolveCategory(csvCategory: string): string {
  return CATEGORY_MAP[csvCategory] ?? csvCategory;
}
```

### 3. 在产品创建时使用映射后品类

所有使用 `row.category` 创建 product 的地方，改为 `resolveCategory(row.category)`：

- dry-run 模式（约第 428 行）：`category: resolveCategory(row.category)`
- apply 模式（约第 532 行）：`category: resolveCategory(row.category)`

**不改 CSV 读取过滤逻辑**——过滤仍用 CSV 原始品类名，只在写产品时映射。

### 4. 报告中同时显示 CSV 品类名和 DB 品类名

在报告品类汇总表中，如果有映射，显示 `CSV品类名 → DB品类名`。

---

## 执行步骤

### Step 1: 验证前置条件

- 确认 `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/` 可访问
- 确认 CSV 过滤后得到 115 个文件
- 验证每个文件在硬盘上存在

### Step 2: 备份

```bash
cp prisma/dev.db backups/dev-before-v2.14-batch3-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 3: 修改脚本

修改 `scripts/batch-import-v2.14.ts`：增加 Batch 3 config + CATEGORY_MAP + resolveCategory。

### Step 4: Dry-run

```bash
npx tsx scripts/batch-import-v2.14.ts --batch=3
```

检查报告 `docs/v2.14-batch3-report.md`（dry-run）。

### Step 5: Apply

```bash
npx tsx scripts/batch-import-v2.14.ts --batch=3 --apply
```

### Step 6: 验证 + 提交

```sql
SELECT COUNT(*) FROM products;
-- 期望: ~13,492 (9,279 + ~4,213)

SELECT category, COUNT(*) FROM products GROUP BY category ORDER BY COUNT(*) DESC;
-- 期望: 风扇灯 / 工作灯 / G4G9 出现且有合理产品数

SELECT COUNT(*) FROM supplier_offers;
SELECT COUNT(*) FROM files WHERE volume_name = 'My Passport';
SELECT COUNT(*) FROM products WHERE image_path IS NOT NULL;
SELECT COUNT(*) FROM price_history;
SELECT COUNT(*) FROM product_params;
-- product_params 应不变: 31,923
```

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/batch-import-v2.14.ts docs/v2.14-batch3-report.md AGENTS.md docs/HANDOFF.md
git commit -m "V2.14 Batch 3: import remaining 115 files across 16 categories"
```

---

## 当前 DB 状态（操作前）

| 指标 | 值 |
|---|---:|
| products | 9,279（26 品类） |
| supplier_offers | 9,913 |
| files (My Passport) | 992 |
| product_params | 31,923 |
| products with images | 5,810（63%） |
| price_history | 7,246 |

---

## 不做的事

- 不处理 `户外工厂-未判定` 的 16 个文件（需人工分类后再导）
- 不处理 `灯管` 的 27 个文件（需按内容拆到球泡或灯管）
- 不导入 enrichment-only / needs-review / likely-skip 文件
- 不导入配件类（铝型材、灯带连接器、LED模组）
- 不修改 product_params
- 不修改源 Excel 文件
- 不改 UI
