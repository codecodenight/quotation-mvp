# Codex Task: V2.7 — 第二目录批量导入

## 目标

从 `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总` 批量导入工厂报价文件，扩大产品库覆盖。

## 背景

V2.1 已扫描该目录（见 `docs/v2.1-second-dir-scan-report.md` 和 `docs/v2.1-combined-scan-report.md`），识别出 79 个导入候选文件 / 95 个可导入 sheet。V2.1 Part B 从中导入了 8 个文件（13 个 sheet 条目），剩余约 71 个候选文件未导入。

当前数据库状态（V2.6 后）：Products 1,280 / Supplier offers 1,901。

## 价格语义规则（关键约束）

`supplier_offers.purchase_price` 只能存 **工厂采购价 / 成本价**。

- 可导入：价格列为 RMB / CNY / 含税 / 未税 / 出厂价 / 工厂价
- 不可导入：价格列为 FOB USD / 客户价 / quote price / sale price
- 价格语义不明：标记 review，不导入

违反此规则会导致报价公式 `purchase_price / exchange_rate × (1 + margin)` 重复计算利润，系统性报价偏高。

## V2.1 已导入文件（排除清单）

以下文件已在 V2.1 Part B 导入，V2.7 必须跳过：

1. `稣赐-壁灯广交会款询价单 20230406.xls` → 壁灯
2. `天启智能2024产品目录报价24.5.13.xlsx1.xlsx` → 橱柜灯（3 sheets）
3. `ERP F级&E级 T8 TUBE 更新 -2025.3.25.xlsx` → 灯管
4. `伊凡格灵LED灯丝灯泡报价2025.xls` → 灯丝灯
5. `荣耀庭院灯AX-FB-TYD garden light 20240316.xls` → 庭院灯
6. `三越三千高端产品报价标20240423.xls` → 应急灯
7. `NEW太阳能报价单2024 0719.xls` → 地插灯/太阳能壁灯（2 sheets）
8. `3.Kyqee Track light（CNY).xls` → 轨道灯（3 sheets）

## 版本去重规则

同一工厂、同一产品线如果有多个日期版本，只导入最新版本。

例：艾轩庭院灯有 2023年2月、2023年6月、2023年9月、2024年3月、2024年10月 多个版本 → 只导入 2024年10月版本。

## 导入路径

使用核价导入路径（直接写入 `products` + `supplier_offers`，跳过 `raw_products`）。参考 V2.1 的实现方式。

品类从文件夹路径推导（如 `户外照明 工业照明/防潮灯/恒百利` → 防潮灯）。

## 步骤

### Step 0: Checkpoint（必须先完成，报告后等待确认）

1. 验证外部硬盘已挂载：`ls "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总"` 
2. 报告当前 DB 状态：products 数、supplier_offers 数、已有品类列表
3. 从 V2.1 扫描报告的 79 个候选中，排除上面 8 个已导入文件，列出剩余候选清单
4. 对每个剩余候选，标注：文件路径、推导品类、推导工厂、文件大小、sheet 数
5. 将清单写入 `docs/v2.7-step0-candidates.md`
6. **STOP，等待用户确认再继续**

### Step 1: 深度分析 + 过滤

对 Step 0 确认的候选文件：

1. 逐个打开，读取表头行，识别价格列
2. 验证价格语义：列名含 RMB/含税/未税/出厂价/单价/工厂价 → pass；含 FOB/USD/客户价 → reject
3. 同工厂同产品线多版本 → 保留最新，标记旧版本为 skip
4. 对 pass 的文件，确定列映射：model 列、price 列、factory 来源
5. 输出过滤后的导入计划表（每个文件/sheet 一行：文件、sheet、品类、工厂、表头行、model 列、price 列、预估行数、价格语义判断依据）
6. 将导入计划写入 `docs/v2.7-step1-import-plan.md`
7. **STOP，等待用户确认再继续**

### Step 2: Dry Run

1. 备份数据库：`cp prisma/dev.db backups/dev-before-v2.7-$(date +%Y%m%d).sqlite`
2. 以 dry-run 模式执行导入计划
3. 输出预期结果：新增产品数、新增 supplier_offers 数、复用已有产品数、跳过行数
4. 检查是否有异常（如某个文件 0 行导入、价格全为 0、款号全为空等）
5. 将 dry-run 结果写入 `docs/v2.7-step2-dryrun.md`
6. **STOP，等待用户确认再继续**

### Step 3: Apply

1. 确认备份存在
2. 执行导入（apply 模式）
3. 分批执行：每批 15-20 个文件，每批后报告新增数
4. 如某个文件导入失败，跳过并记录，不中断整批

### Step 4: 质量审计

导入完成后，生成审计报告 `docs/v2.7-import-audit.md`：

1. 总计：新增产品数、新增 supplier_offers 数、新增品类（如有）
2. 按品类汇总产品数
3. 价格异常检查：purchase_price = 0 / NULL / > 10000 RMB 的记录
4. 款号异常检查：model_no 为空 / 纯数字 / 过短（<3 字符）的记录
5. 重复款号检查：与已有产品 model_no 冲突的记录
6. 图片提取结果（V2.6 已接入导入流程，报告图片提取成功数）

## 参考文件

- `AGENTS.md` — 项目规则和约束
- `docs/v2.1-second-dir-scan-report.md` — V2.1 第二目录扫描报告（79 候选）
- `docs/v2.1-combined-scan-report.md` — V2.1 综合扫描报告
- `docs/v2.1-batch-import-result.md` — V2.1 导入结果（含 Part B 已导入清单）
- `docs/v2.1-batch-import-dry-run.md` — V2.1 导入 dry-run 参考

## 注意事项

- 源 Excel 文件绝不修改、移动、重命名、删除
- Schema 变更用 raw SQL + sqlite3（Prisma schema-engine 在这台 Mac 有 bug）
- 导入使用核价导入路径，参考现有 hejia-import 实现
- 文件路径可能含中文，注意编码
- .xls 文件用 SheetJS 读取（已安装 CDN 版本）
