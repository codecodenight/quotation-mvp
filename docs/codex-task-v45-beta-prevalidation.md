# V45: Beta 技术预验收

## 背景

`docs/release-readiness-checklist.md` 定义了 Beta 验收脚本（10 步）。其中数据层和逻辑层的验证可以用代码完成，UI 层和业务判断层需要人工。

本任务是 **技术预验收**，用脚本覆盖能自动化的部分，产出一份报告供人工验收参考。

## 产出

一个脚本 `scripts/v45-beta-prevalidation.ts`，运行后输出报告到 `docs/v45-beta-prevalidation-report.md`。

报告结构按以下 8 个检查块组织，每块给出 PASS / FAIL / WARN + 具体数据。

## 检查块

### 1. 数据完整度快照

查询并报告：
- 产品总数、有 offer 的产品数、有图的产品数、有参数的产品数
- 按品类统计：产品数、offer 数、有图率、有参数率
- 高频品类（筒灯、面板灯、投光灯）是否每个都有 ≥50 个有效 offer（price > 0 且无 price_flag）

判定：高频品类有效 offer ≥ 50 → PASS，否则 WARN。

### 2. 搜索覆盖验证

用 3 组真实搜索条件调用 `searchProducts`（从 `src/lib/chat-tools.ts` 导入）：
- `{ category: "筒灯", watts_min: 5, watts_max: 15 }`
- `{ category: "面板灯", watts_min: 18, watts_max: 48 }`
- `{ category: "投光灯", watts_min: 50, watts_max: 200 }`

每组记录：返回产品数、有 offer 的数量、有图的数量。

判定：每组返回 ≥ 5 个有 offer 的产品 → PASS，否则 FAIL。

### 3. 价格公式验证

用 `calculateSalePrice`（从 `src/lib/quote-export.ts` 导入）验证 4 个场景：
- RMB 采购 10.00，汇率 7.2，利润率 20% → 期望 USD ≈ 1.67
- RMB 采购 50.00，汇率 7.2，利润率 15% → 期望 USD ≈ 7.99
- USD 采购 5.00，汇率 1，利润率 20% → 期望 USD = 6.00
- RMB 采购 0.50，汇率 7.2，利润率 20% → 期望 USD ≈ 0.08

公式：`purchasePrice / exchangeRate * (1 + profitMargin)`，结果保留 2 位小数。

判定：4 个结果全部在 ±0.01 范围内 → PASS，否则 FAIL。

### 4. 报价导出一致性

用 `buildQuoteTableModel`（从 `src/lib/quote-table-model.ts` 导入）和 `writeQuoteWorkbook`（从 `src/lib/quote-export.ts` 导入）做一次端到端验证：

1. 从 DB 取一条现有 quote（有 ≥ 3 个 items 的），连同其 quote_items + 关联 product + offer
2. 用 `buildQuoteTableModel` 生成预览模型
3. 用 `writeQuoteWorkbook` 导出到临时文件
4. 用 exceljs 读回导出文件，逐行对比：产品名、型号、售价是否与预览模型一致

判定：所有行匹配 → PASS，任一行不匹配 → FAIL（报告具体差异）。

### 5. 价格异常分布

查询 `price_flag` 分布：
- `suspicious_low` 数量和占比
- `suspicious_high` 数量和占比
- `outlier_high` 数量和占比
- 无 flag 的数量和占比

各类 flag 分别取 3 个样例（product.name, factory_name, purchase_price, currency）。

判定：仅报告，不做 PASS/FAIL（需业务判断）。标记为 INFO。

### 6. 备份恢复验证

1. 用 `sqlite3` 的 `.backup` 命令备份当前 `prisma/dev.db` 到临时目录
2. gzip 压缩
3. 解压到另一个临时路径
4. 对恢复后的 DB 运行 `SELECT COUNT(*) FROM products`，对比原 DB 数值
5. 清理临时文件

判定：数值一致 → PASS，不一致 → FAIL。

### 7. 导出文件完整性

对检查块 4 导出的 Excel 文件额外检查：
- 文件大小 > 0
- 有至少 1 个 worksheet
- 第一行是表头（包含"产品名称"或"Product"等关键词）
- 数据行数 = quote_items 数

判定：全部满足 → PASS，否则 FAIL。

### 8. 历史报价快照一致性

取一条现有 quote + 其 quote_items：
- 对比 `quote_items.purchase_price` 与关联 `supplier_offers.purchase_price`
- 如果 offer 价格已变化（有 price_history 记录），验证 quote_item 保存的是创建时的快照值，不是当前值

判定：
- 如果有变化的案例且快照正确 → PASS
- 如果没有变化的案例 → INFO（"无价格变动案例可验证"）
- 如果快照与当前值不一致且无 price_history 解释 → WARN

## 脚本要求

- 使用 `tsx` 运行（`npx tsx scripts/v45-beta-prevalidation.ts`）
- 直接用 `@prisma/client` 查询 DB
- 导入项目现有模块（chat-tools、quote-export、quote-table-model）
- 报告写入 `docs/v45-beta-prevalidation-report.md`，格式为 markdown 表格
- 报告末尾汇总：PASS / FAIL / WARN / INFO 各多少
- 脚本出错不中断，catch 后记录到报告中对应检查块
- 不修改任何数据——所有 DB 操作都是 SELECT
- 临时文件写到系统 tmpdir，用完即删

## 不做

- 不启动 dev server
- 不做 UI 操作
- 不修改数据库
- 不 commit（报告生成后由用户决定）
