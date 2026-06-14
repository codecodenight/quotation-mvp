# Codex Task: V5.0C — 历史客户报价产品匹配

## 目标

为 `customer_quote_rows` 的 6,139 行填充 `matched_product_id`，将历史客户报价与现有产品库关联。

**只更新 `customer_quote_rows.matched_product_id`，不改 `products` / `supplier_offers` / `quote_items`。**

## 背景

V5.0B（commit `cff8ba4`）已导入 6,139 行历史客户报价到独立表，`matched_product_id` 全部为 NULL。本步骤用 `raw_model` 和品类信息做模糊匹配，把每行关联到 `products` 表中最可能的产品。

匹配不需要 100% 精确——这是参考数据，不是业务约束。宁可不匹配也不要错匹配。

## 依赖

sqlite3 CLI + Prisma client。无新依赖。

---

## 脚本：`scripts/customer-quote-match-v5.0c.ts`（新建）

### 命令行

```bash
# dry-run（只读，统计匹配率）
npx tsx scripts/customer-quote-match-v5.0c.ts --dry-run

# apply（写 matched_product_id）
npx tsx scripts/customer-quote-match-v5.0c.ts --apply
```

### 匹配策略

按优先级从高到低尝试：

1. **精确 model_no 匹配**：`customer_quote_rows.raw_model` = `products.model_no`（忽略大小写、去除前后空格）
2. **归一化匹配**：去除空格、连字符、斜杠差异后匹配。例如 `LPR1-3WR` vs `LPR1 3WR`
3. **品类限定**：从 `customer_quote_files.relative_path` 提取品类关键词（子目录名），优先匹配同品类产品。如果同 model_no 在多个品类出现，选同品类的
4. **唯一性要求**：如果归一化后仍有多个候选产品（不同品类），且无法从路径判断品类，则不匹配（留 NULL）

### 品类映射

从 `customer_quote_files.relative_path` 的第一级目录名映射到 `products.category`：

```
面板灯 → 面板灯
大面板灯 → 面板灯
吸顶灯 → 吸顶灯
球泡 → 球泡
灯带 → 灯带
太阳能 → 太阳能壁灯
三防灯 → 三防灯
线条灯 → 线条灯
筒灯 → 筒灯
地插灯 太阳能壁灯 → 太阳能壁灯
防潮灯 → 防潮灯
Highbay → Highbay
路灯 → 路灯
庭院灯 → 庭院灯
投光灯 → 投光灯
轨道灯 → 轨道灯
台灯 → 台灯
镜前灯 → 镜前灯
灯丝灯 → 灯丝灯
壁灯 → 壁灯
灯管 → 灯管
净化灯 → 净化灯
应急灯 → 应急灯
五面办公灯-溢利多+ 名威 → 五面办公灯
```

如果路径在根目录（汇总文件），则不限品类，仅靠 model_no 匹配。

### 输出

#### dry-run

输出到 stdout：

```
=== Customer Quote Match V5.0C (dry-run) ===

总行数: 6,139
可匹配行数（有 raw_model）: N
精确匹配: N (N%)
归一化匹配: N (N%)
未匹配: N (N%)

按品类统计:
| 品类 | 总行 | 匹配 | 匹配率 |
|---|---:|---:|---:|

未匹配样本（前 20 行）:
| raw_model | 品类 | sale_price_usd |
|---|---|---:|
```

#### apply

输出到 `docs/v5.0c-match-report.md`，格式同 dry-run 但更详细，包含匹配率分布和典型未匹配原因分析。

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v5.0c-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 创建脚本 + dry-run

```bash
npx tsx scripts/customer-quote-match-v5.0c.ts --dry-run
```

### Step 3: apply

```bash
npx tsx scripts/customer-quote-match-v5.0c.ts --apply
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows WHERE matched_product_id IS NOT NULL"
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM customer_quote_rows WHERE matched_product_id IS NULL"
```

### Step 5: 提交

```bash
git add scripts/customer-quote-match-v5.0c.ts docs/v5.0c-match-report.md
git commit -m "V5.0C: customer quote product matching — fill matched_product_id"
```

## 验收标准

1. 精确 + 归一化匹配率 ≥ 40%（保守预期，因为客户报价的 model_no 格式可能和产品库不一致）
2. 零错误匹配（宁可不匹配也不错匹配——不允许把面板灯的行匹配到球泡）
3. 不改 `products` / `supplier_offers` / `quote_items`
4. `tsc --noEmit` 通过
5. 报告包含未匹配原因分析

## 不做的事

- 不改 products / supplier_offers
- 不建新表
- 不做 UI
- 不改源文件
- 不做人工匹配界面
