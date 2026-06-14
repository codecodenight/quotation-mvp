# V5.3 Spike：历史报价未匹配行匹配策略调研

## 背景

V5.0C/V5.0E 自动匹配了 2,902 / 6,139 行（47%）。剩余 3,237 行中：
- ~2,050 行无 raw_model（空款号），无法匹配
- ~1,187 行有 raw_model 但产品库无对应 model_no

V6.2B 已完成产品身份清理（+187 产品拆分），产品库 model_no 集合已更新。本 Spike 评估是否存在新的匹配机会。

**本次为只读调研，不改库。**

## 要求

写 `scripts/v5.3-spike.ts`，输出报告到 `docs/v5.3-spike.md`。

### Step 0：当前匹配状态快照

统计 `customer_quote_rows` 的匹配现状：
- 总行数
- matched_product_id IS NOT NULL 的行数（已匹配）
- raw_model IS NOT NULL AND matched_product_id IS NULL 的行数（有款号但未匹配）
- raw_model IS NULL AND matched_product_id IS NULL 的行数（无款号未匹配）

### Step 1：V6.2B 后再匹配尝试

对"有款号但未匹配"的行，用 V5.0C 的匹配策略重试：
1. 精确匹配：`raw_model = products.model_no`
2. 归一化匹配：去掉空格、连字符、斜杠后比较

统计新增匹配数量。列出前 20 个新增匹配的 raw_model → product.model_no + category。

### Step 2：抽样 50 条未匹配行

从"有 raw_model 但仍未匹配"的行中随机抽样 50 条，对每条：

1. 列出 raw_model、raw_description、raw_price_usd、source file_name
2. 在产品库中搜索候选产品：
   - 精确 model_no 匹配（已知不会命中）
   - 归一化 model_no 匹配（已知不会命中）
   - 前缀匹配：`products.model_no LIKE '{raw_model的前N字符}%'`，取前缀长度 ≥ 3 的候选
   - 数字部分匹配：提取 raw_model 中的数字序列，在 model_no 中搜索
   - 品类 + 瓦数匹配：从 raw_model 或 raw_description 提取瓦数，结合 customer_quote_rows 所在文件的品类推断，搜索同品类同瓦数产品
3. 分类该行：
   - `match-possible`：找到至少 1 个高置信度候选（前缀匹配 ≥ 5 字符 OR 数字+品类匹配）
   - `weak-candidates`：有候选但置信度低（前缀 3-4 字符 OR 只有瓦数匹配）
   - `no-candidates`：无任何候选

### Step 3：汇总分析

1. 50 条抽样中 match-possible / weak-candidates / no-candidates 各多少
2. match-possible 中最常见的匹配策略是什么（前缀/数字/品类+瓦数）
3. no-candidates 中 raw_model 的常见模式（是否是客户自编码、组合型号、完全无规律）
4. 基于抽样结果，估算全量未匹配行中可匹配比例
5. 推荐：是否值得做 V5.3 全量匹配，如果值得，推荐哪种策略

### 输出格式

`docs/v5.3-spike.md` 包含：

1. **当前匹配状态**
   - 总行数、已匹配、有款号未匹配、无款号未匹配

2. **V6.2B 后再匹配结果**
   - 新增匹配数量
   - 前 20 个新增匹配详情

3. **50 条抽样详情表**
   每条列出：
   - raw_model、raw_description（截取前 50 字符）
   - raw_price_usd
   - source file_name
   - 候选产品数量 + 最佳候选的 model_no / category
   - 分类结果（match-possible / weak-candidates / no-candidates）
   - 匹配策略描述

4. **汇总分析**
   - 分类统计
   - 策略分析
   - 推荐结论

## 验证

- `npx tsc --noEmit --pretty false` 通过
- 脚本运行不修改 DB
- 报告已生成

## 不做

- 不改库
- 不更新 matched_product_id
- 不做全量匹配
- 不实现新的匹配算法（只评估可行性）
