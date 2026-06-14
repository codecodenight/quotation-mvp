# Codex Task: V5.0E — 未匹配历史报价审计 + 补匹配

## 目标

1. 审计 `customer_quote_rows` 中 3,292 行 `matched_product_id IS NULL` 的原因分布
2. 对高置信度项自动补匹配（去空格/大小写/连字符归一化、品类交叉匹配）
3. 输出审计报告

**只更新 `customer_quote_rows.matched_product_id`，不改 `products` / `supplier_offers` / `quote_items`。**

## 背景

V5.0C 匹配了 2,847/6,139 行（46%）。未匹配 3,292 行的原因（V5.0C 报告）：
- 2,050 行无 `raw_model`（列未识别或值为空/"-"）
- 1,242 行有 `raw_model` 但产品库中无对应 `model_no`

本步骤要深入分析这两类未匹配，找出可以安全补匹配的子集。

## 依赖

sqlite3 CLI + SheetJS（如需回查源文件）。无新依赖。

---

## 脚本：`scripts/customer-quote-rematch-v5.0e.ts`（新建）

### 命令行

```bash
# Phase 1: 审计（只读）
npx tsx scripts/customer-quote-rematch-v5.0e.ts --audit

# Phase 2: 补匹配（写 DB）
npx tsx scripts/customer-quote-rematch-v5.0e.ts --apply
```

### Phase 1: 审计分析

对全部 3,292 行未匹配记录做分类统计：

#### A. 无 raw_model 的 2,050 行

按来源文件分组，统计：
- 哪些文件/sheet 的款号列未识别（V5.0B 导入时列映射失败）
- 是否有 `raw_row_json` 中包含疑似款号的列（如有值但未映射的列）
- 按品类统计分布

#### B. 有 raw_model 但未匹配的 1,242 行

1. **格式差异分析**：将 `raw_model` 与 `products.model_no` 做更激进的归一化对比：
   - 去除所有空格、连字符、斜杠、括号
   - 大小写统一
   - 去除常见前后缀（如 `WL-`、`-ECO`、`-PRO`）
   - 去除瓦数后缀差异（`48W` vs `48w` vs `48`）
2. **品类交叉**：V5.0C 只匹配同品类或根目录不限品类。检查是否有跨品类匹配机会（如 `大面板灯` 目录的产品实际在 `面板灯` 品类）
3. **序号型 model**：部分文件用序号（1, 2, 3...）作为 raw_model，这些不应匹配
4. **按 raw_model 频次排序**：高频未匹配的 raw_model 优先分析

### Phase 2: 补匹配

基于 Phase 1 的发现，对以下高置信度场景自动补匹配：

1. **激进归一化命中**：去空格/连字符/大小写后唯一命中一个产品
2. **品类映射扩展**：`大面板灯` → 也搜 `面板灯`；`地插灯 太阳能壁灯` → 也搜 `地插灯`
3. **前缀匹配**：`WL-TCYR` 类 Wellux 自有编号，如果产品库中有去掉 `WL-` 后的匹配

**不做的匹配**：
- 序号型 raw_model（纯数字 1-99）
- 纯瓦数 raw_model（如 `48W`、`100W`）— 已知 model_no 碰撞问题
- 模糊文本匹配（如描述相似度）

### 输出

`docs/v5.0e-rematch-report.md`：

```markdown
# V5.0E — 历史报价补匹配报告

Generated: {timestamp}
Mode: audit / apply

## 匹配率变化

| 指标 | V5.0C 后 | V5.0E 后 | 变化 |
|---|---:|---:|---:|
| 总行数 | 6,139 | 6,139 | — |
| 已匹配 | 2,847 | N | +N |
| 未匹配 | 3,292 | N | -N |
| 匹配率 | 46% | N% | +N% |

## 未匹配原因细分

### A. 无 raw_model (2,050 行)

| 来源文件 | Sheet | 行数 | 原因 |
|---|---|---:|---|

### B. 有 raw_model 但未匹配 (1,242 行)

| 归类 | 行数 | 说明 |
|---|---:|---|
| 序号型（1/2/3） | N | 不可匹配 |
| 纯瓦数（48W） | N | model_no 碰撞，不匹配 |
| Wellux 自有编号 | N | 产品库无对应 |
| 归一化可匹配 | N | 本次补匹配 |
| 品类交叉可匹配 | N | 本次补匹配 |
| 真正无候选 | N | 产品库未收录 |

## 补匹配详情

| raw_model | 匹配到 product.model_no | product.category | 匹配方式 |
|---|---|---|---|

## 仍然未匹配的 Top 20 raw_model

| raw_model | 出现次数 | 品类 | 原因 |
|---|---:|---|---|
```

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v5.0e-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 审计

```bash
npx tsx scripts/customer-quote-rematch-v5.0e.ts --audit
```

### Step 3: 补匹配

```bash
npx tsx scripts/customer-quote-rematch-v5.0e.ts --apply
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows WHERE matched_product_id IS NOT NULL"
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows WHERE matched_product_id IS NULL"
# 验证无悬空外键
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows WHERE matched_product_id IS NOT NULL AND matched_product_id NOT IN (SELECT id FROM products)"
```

### Step 5: 提交

```bash
git add scripts/customer-quote-rematch-v5.0e.ts docs/v5.0e-rematch-report.md
git commit -m "V5.0E: customer quote rematch — audit + high-confidence补匹配"
```

## 验收标准

1. 审计报告覆盖全部 3,292 行未匹配记录，每行有原因分类
2. 补匹配只做高置信度项（归一化唯一命中 + 品类交叉）
3. 不匹配序号型、纯瓦数型 raw_model
4. 匹配率 ≥ 50%（从 46% 提升至少 4 个百分点）
5. 外键悬空 = 0
6. 不改 `products` / `supplier_offers` / `quote_items`
7. `tsc --noEmit` 通过

## 不做的事

- 不改 products / supplier_offers
- 不建新表
- 不做模糊文本匹配
- 不做 UI
- 不改源文件
