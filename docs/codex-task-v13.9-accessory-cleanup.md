# V13.9 — 配件/非成品产品标记 + 完成率口径调整

数据库中混入了 plug、connector、controller、driver、end caps 等配件，以及误导入的标题行和包装规格行。这些记录天然缺少 CCT/voltage 等参数，拖低完成率且会误导 V14.0 的参数补全。

本任务不删数据，只添加 `product_role=accessory` 标记，并更新完成率统计排除这些产品。

**依赖：V13.8 已完成。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.9
```

## 新建文件：`scripts/v13.9-accessory-cleanup.ts`

```bash
npx tsx scripts/v13.9-accessory-cleanup.ts              # dry-run
npx tsx scripts/v13.9-accessory-cleanup.ts --apply       # 写入
```

---

## Part A — 规则匹配配件产品

用以下规则扫描 products 表，输出候选列表。每条规则独立执行，有优先级标记。

### 规则 1：关键词精确匹配（高置信度）

product_name 或 model_no **整体就是**以下配件名称（不区分大小写）：

```typescript
const EXACT_ACCESSORY_NAMES = [
  'plug', 'connector', 'controller', 'driver', 'led driver',
  'middle connector', 'end caps', 'power cord',
];
```

匹配条件：`LOWER(TRIM(product_name))` 在列表中，或 `LOWER(TRIM(model_no))` 在列表中。

### 规则 2：关键词前缀/包含匹配（高置信度）

product_name 满足以下模式之一：

```typescript
const PREFIX_PATTERNS = [
  /^plug\s*[-–—]/i,           // "plug - For 220V RGB..."
  /^plug\s+for\b/i,           // "plug For plug free..."
  /^power input plug/i,       // "Power input plug cable..."
  /^2 ends plug/i,            // "2 ends plug cable..."
  /^end caps/i,               // "end caps + fixation buckles"
  /^connector wire/i,         // "connector wire For plug free..."
  /^middle connector/i,       // "middle connector"
];
```

product_name 包含 "connector" 且长度 < 60 字符，且品类在 `['灯带','磁吸灯','线条灯','地埋灯/地插灯']`：

```typescript
// 匹配: "L Connector", "Straight Connector 20", "connector for Surface track"
// 排除: 长产品名里包含 connector 的完整灯带套装（如 "10mm 24V...bluetooth + infrared remote controller..."）
```

品类在 `['磁吸灯','线条灯']` 且 product_name 包含 "Plug" 且长度 < 40 字符：

```typescript
// 匹配: "S35 Plug", "R35-5 Plug"
// 排除: "Plug in" 类型的真产品
```

**必须排除**：product_name 包含 "Plug in" 或 "plug-in"（这些是插电式真产品）。

### 规则 3：Remote controller 独立配件（高置信度）

品类 = `'地埋灯/地插灯'` 且 product_name 包含 "Remote controller"。

### 规则 4：标题行/包装行误导入（高置信度）

```typescript
// remark 含 "Material: Material" 或 "CCT: CCT" — 标题行原样导入
// model_no 匹配 /^\d+pcs$/i 且品类在 ['灯带','面板灯'] — 包装数量行
// model_no = '43*75M' 且品类 = '面板灯' — 模具尺寸行
```

### 不标记的（显式排除）

```typescript
const EXCLUDE_IDS: string[] = [];  // 空，用于未来人工豁免

// 以下情况不标记为配件：
// - 太阳能壁灯 "Plug in" 感应小夜灯 — 真产品
// - 灯丝灯 "不配灯" 灯座 — 可售产品，有完整参数
// - 皮线灯 长度型号 (10M/20M) — 按长度销售的真产品
// - 太阳能 长度型号 (5M/25M) — 太阳能灯串
// - 防潮灯/净化灯 尺寸型号 (140mm/0.6M) — 按尺寸命名的真产品
// - 灯带 11mm (有 watts=12, 有详细 remark) — 真灯带产品
// - 灯带 长产品名含 "controller" 但 > 60 字符 — 灯带套装，不是独立配件
```

---

## Part B — 写入 product_role 标记

对 Part A 匹配到的产品，插入一条 product_params 记录：

```typescript
{
  id: randomUUID(),
  productId: product.id,
  paramKey: 'product_role',
  rawValue: 'accessory',
  normalizedValue: 'accessory',
  unit: null,
  sourceField: 'rule_classification',
  confidence: 'high',
}
```

去重：如果该 product 已有 `param_key='product_role'` 的记录则跳过。

预估：~34 条新记录。

---

## Part C — 更新 v11-shared.ts 共享覆盖率排除逻辑

在 `scripts/v11-shared.ts` 中新增导出函数：

```typescript
export async function loadAccessoryProductIds(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.productParam.findMany({
    where: { paramKey: 'product_role', normalizedValue: 'accessory' },
    select: { productId: true },
  });
  return new Set(rows.map(r => r.productId));
}
```

---

## Part D — 覆盖率重算

新建 `scripts/v13.9-coverage-recount.ts`，从 v11-shared 导入 `CATEGORY_CORE_PARAMS` 和 `loadAccessoryProductIds`，计算：

1. 排除 accessory 后的各品类产品数
2. 排除 accessory 后的核心参数完成数
3. 全局完成率
4. 对比 V13.8 数字

```bash
npx tsx scripts/v13.9-coverage-recount.ts
```

纯只读，不需 `--apply`。

---

## 报告：`docs/v13.9-accessory-cleanup-report.md`

```markdown
# V13.9 配件标记报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.9

## 匹配结果

| 规则 | 匹配数 |
|---|---:|
| 1: 关键词精确 | X |
| 2: 前缀/包含 | X |
| 3: Remote controller | X |
| 4: 标题/包装行 | X |
| 合计 | X |

## 标记明细

| category | model | product_name | 规则 |
|---|---|---|---|

## 覆盖率变化

| 指标 | V13.8 | V13.9(排除配件) |
|---|---:|---:|
| 核心参数覆盖范围产品 | 10276 | X |
| 全部完成产品 | 5624 | X |
| 全局完成率 | 54.7% | X% |
| 标记为配件 | 0 | X |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10284 | 10284 | 0 |
| product_params | 88591 | X | +X |
```

---

## Commit

```
V13.9: mark accessory/junk products and exclude from core completion rate
```

## 不做什么

- 不删除产品、offers 或 params
- 不改 category（配件仍保留原品类归属）
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不调用 DeepSeek API
- 不标记有争议的边界案例（灯带 size-only 型号、灯丝灯灯座等留待人工确认）
