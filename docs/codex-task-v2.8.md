# Codex Task: V2.8 — 数据质量审计 + Importer 增强 + Review 文件补导

## 目标

清理 V2.7 后的已知数据质量问题，增强 importer 处理合并单元格等格式，补导 V2.7 Step 1 标记为 review 的可导入文件。

## 背景

V2.7 导入 471 个新产品后，产品库 1,751 products / 2,392 offers / 29 categories。审计发现 4 类问题需要处理。同时 V2.7 Step 1 有 20+ 文件因格式问题未能导入，其中部分可以通过 importer 增强来解决。

## Part A: 数据清洗（纯数据库操作，不涉及代码改动）

### A1: 脏款号修正

磁吸灯品类有一条 `model_no = "/"` 的记录。

操作：
1. 查询该记录的完整信息（product_id, remark, source file）
2. 如果 remark 或源文件能推导出正确款号 → 更新 model_no
3. 如果无法推导 → 标记为 `model_no = "UNKNOWN-磁吸灯-{id前6位}"` 并在报告中标注需人工确认
4. 将处理结果写入 `docs/v2.8-a1-model-fix.md`

### A2: 品类合并

"地插灯/太阳能壁灯"（5 条）和"太阳能壁灯"（82 条）语义重叠。

操作：
1. 将 category = "地插灯/太阳能壁灯" 的 5 个 products 更新为 "太阳能壁灯"
2. 检查是否有其他品类重叠（如 "sheet1"、"LED Bulb" 等非标品类名），列出所有 products 数 ≤ 5 的品类，评估是否可以合并到已有大品类
3. 将合并方案写入 `docs/v2.8-a2-category-merge.md`
4. **STOP，等用户确认合并方案后再执行**

### A3: 重复 Offer 清理

同 model_no + 同 factory_name 出现多条 supplier_offers 的记录（V2.7 audit 显示最多 7 条）。

操作：
1. 查询所有 model_no + factory_name 出现 ≥ 3 次的 offer 组
2. 对每组：按 price_updated_at 排序，保留最新一条，其余标记为待删除
3. 如果同组内价格差异 > 30%，不自动删除，标记为需人工确认（可能是不同规格被错误归到同一 model_no）
4. 将清理方案写入 `docs/v2.8-a3-duplicate-offers.md`（含保留/删除/待确认三类清单）
5. **STOP，等用户确认后再执行删除**

## Part B: Importer 增强（代码改动）

### B1: 合并单元格 / Fill-Down 支持

V2.7 review 文件中最常见的阻塞原因是：model 列使用合并单元格或 fill-down 风格（一个款号覆盖多行变体，下方行的 model 列为空）。

当前行为：model 列为空 → 该行被跳过。
期望行为：新增可选参数 `fillDownModelColumn: boolean`，当 model 列为空时，继承上一个非空行的 model 值。

改动范围：
- `src/lib/hejia-import.ts`：`buildHejiaRows()` 函数增加 fill-down 逻辑
- `HejiaImportMapping` 类型增加 `fillDownModelColumn?: boolean` 字段
- 脚本 / API 调用时按文件决定是否启用

验收：
1. 单元测试：构造一组 rows，model 列为 `["A", "", "", "B", "", "C"]`，price 列全部有值。启用 fill-down 后应产出 6 行（3 行 A、2 行 B、1 行 C）。不启用时只产出 3 行。
2. 用 #1（德雷普灯丝灯，271 行 / 91 行有 model）做 dry-run，启用 fill-down 后 valid rows 应 > 200
3. 将测试结果写入 `docs/v2.8-b1-filldown-test.md`

### B2: 多阶梯价格处理

恒百利三防灯（#28-30）有多个数量阶梯价格列（如 1-99pcs / 100-499pcs / 500+pcs）。

改动：`HejiaImportMapping` 已支持 `factoryPriceColumn` 指定单一价格列。不需要改 importer 逻辑，只需在导入计划中为这些文件选定一个价格列（建议选最低 MOQ 阶梯）。

如果表头能明确区分阶梯，在导入计划里注明选哪列即可，不改代码。

## Part C: Review 文件补导

V2.7 Step 1 标记 review 的文件中，以下在 Part B 增强后可以导入：

| 原候选# | 文件 | 阻塞原因 | 增强后状态 |
|---:|---|---|---|
| 1 | 德雷普灯丝灯 202210.xls | 合并单元格 | B1 fill-down 解决 |
| 15 | 优泽 GX53 sheet | 合并单元格 | B1 fill-down 解决 |
| 28-30 | 恒百利三防灯 3 文件 | 多阶梯价 | B2 选定价格列即可 |
| 27 | 一群狼净化灯 | 无 model 列 | 评估：能否从 spec 列构造 model？如不能则跳过 |
| 26 | 中千太阳能庭院灯 | 多表拼接 | 评估：能否拆成多个 import 条目？ |

操作：
1. Part B 增强完成后，对上述文件逐个分析，确定列映射
2. 对无法解决的文件（如 #27 无 model 列），给出跳过理由
3. 将可导入文件的 import plan 写入 `docs/v2.8-c-import-plan.md`
4. **STOP，等用户确认后执行**
5. 备份 DB → dry-run → apply → 审计

以下文件不导入（V2.7 Step 1 已确认的有效跳过理由）：
- #3 合力比较工作簿（#4 的副本）
- #7 合力旧版 T8（已有更新版本）
- #34-35 博登旧版（#36 已导入）
- #40, 42 羽成（无清晰映射，#41 已导入）
- #50 新概念（已选 #49）
- #53, 55, 56 汇盈聚旧版
- #69 天启旧版
- #70 路佳无 RMB 价格

## 执行顺序

```
Part A1 脏款号 → Part A2 品类合并（STOP）→ Part A3 重复 offer（STOP）
→ Part B1 fill-down 代码 → Part B2 多阶梯价确认
→ Part C 补导（STOP）→ 最终审计
```

每个 STOP 点输出报告到 docs/，等用户确认后继续。

## 最终审计

全部完成后，生成 `docs/v2.8-final-audit.md`：
1. Products / supplier_offers / categories 最终数
2. 重复 offer 清理数
3. 品类合并数
4. 补导新增数
5. 与 V2.7 结束时的对比

## 注意事项

- 所有数据操作前确认备份存在
- 重复 offer 删除操作不可用 CASCADE — 必须确认 quote_items 没有引用被删 offer
- 源 Excel 文件绝不修改
- 代码改动需有对应测试
- git commit 每个 Part 完成后提交一次

## 参考文件

- `AGENTS.md` — 项目规则（含 Known Data Quality Issues 章节）
- `docs/v2.7-import-audit.md` — V2.7 审计报告（重复 offer 清单）
- `docs/v2.7-step1-import-plan.md` — V2.7 review 文件清单（Part C 来源）
- `src/lib/hejia-import.ts` — 核价导入逻辑（Part B 改动目标）
- `src/lib/excel-import.ts` — 通用导入逻辑
