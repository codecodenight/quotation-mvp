# V6.2A：跨品类碰撞批量拆分计划（只读）

## 背景

V6.1 审计发现 54 组疑似跨品类碰撞（纯瓦数 model_no 导致不同品类 offer 挂同一产品）。V6.2A 对这 54 组生成拆分计划，分类为 auto-safe / review-needed / skip，不写库。

参考：`docs/v6.1-collision-audit.md`、`scripts/v6.1-collision-audit.ts`（品类推断逻辑可复用）。

## 要求

写 `scripts/v6.2a-split-plan.ts`，输出报告到 `docs/v6.2a-split-plan.md`。

### Step 0：加载 54 组疑似跨品类碰撞

从 DB 直接查询（不解析 V6.1 markdown），复用 V6.1 的碰撞组识别逻辑 + 品类推断逻辑。只处理 V6.1 归类为"疑似跨品类"的组。

### Step 1：对每个 offer 做三重检查

对 54 组中的每个 offer：

1. **推断品类**：复用 V6.1 的 `inferCategory()` 逻辑（球泡灯管合并目录特殊处理、最深路径段优先）
2. **冲突检查**：扫描 offer 的 `relative_path` 所有路径段 + `file_name`，检查是否命中两个不同品类的关键词。如果是，标记为 `conflict`
3. **分类**：

| 分类 | 条件 |
|---|---|
| `auto-safe` | inferred_category 是明确品类（非"无法推断"非"球泡灯管(不确定)"）AND inferred_category ≠ product.category AND 无冲突（路径段没有同时命中两个不同品类） |
| `review-needed` | inferred_category ≠ product.category BUT 有冲突（目录和文件名命中不同品类）OR inferred_category 是"球泡灯管(不确定)" |
| `skip` | inferred_category 是"无法推断" OR inferred_category === product.category（已在正确品类） |

### Step 2：汇总拆分计划

对 auto-safe 的 offer，按 `model_no + inferred_category` 分组，计算：
- 将创建多少个新产品
- 将迁移多少个 offer
- 原产品将剩余多少个 offer

对 review-needed 的 offer，列出每条的详细信息供人工审核。

### Step 3：安全检查

对所有 54 组涉及的产品：
- 检查 `customer_quote_rows` matched_product_id 引用数
- 检查 `quote_items` product_id 引用数
- 有引用的产品标记警告（拆分会影响外键）

### 输出格式

`docs/v6.2a-split-plan.md` 包含：

1. **总览**
   - 54 组总共有多少 offer
   - auto-safe / review-needed / skip 各多少 offer
   - auto-safe 拆分后将新建多少产品、迁移多少 offer
   - 有 customer_quote_rows 或 quote_items 引用的产品数量

2. **auto-safe 拆分计划表**
   按 model_no 分组，每组列出：
   - model_no、当前 product.category
   - 将迁移的 offer 列表（factory_name、inferred_category、price、source path）
   - 当前产品迁移后剩余 offer 数

3. **review-needed 详情表**
   每条列出：
   - model_no、product.category、factory_name、inferred_category
   - 冲突原因（哪两个品类关键词冲突）
   - price、source path

4. **skip 摘要**
   只列 model_no + offer 数 + 原因

5. **外键引用警告**
   列出有 customer_quote_rows 或 quote_items 引用的产品

## 验证

- `npx tsc --noEmit --pretty false` 通过
- 脚本运行不修改 DB
- 报告已生成

## 不做

- 不改库
- 不创建产品
- 不迁移 offer
- 不处理 V6.1 归类为"正常"或"无法判断"的组
