# 户外工厂-未判定 导入计划

> 状态：**已确认** — 2026-06-13

## 1. 范围

| 分类 | 文件数 | 说明 |
|---|---:|---|
| 导入 (likely-importable) | 15 | 有 RMB 工厂价，品类可判定 |
| 导入 (needs-review) | 4 | 有价格迹象但语义不够明确，纳入 dry-run 验证 |
| 跳过 (_lenovo 冲突) | 4 | 与原件重复 |
| 跳过 (enrichment-only) | 23 | 无 RMB 价格，本轮不碰 |
| **合计在范围** | **19** | **预估 ~549 行** |

新品类：需创建 **充电灯**（绿晟 R 系列充电灯）。

## 2. 文件清单与品类映射

### 凯晟德（3 文件，~199 行）

| # | 文件 | 判定 | 目标品类 | ~行数 |
|---|---|---|---|---:|
| 1 | `凯晟德/2024年4月/…/TR-ES Qoutation  20240521.xlsx` | likely | 路灯 (medium) | 63 |
| 2 | `凯晟德/202504报价/KCD-TB qoutation20250527.xlsx` | likely | 太阳能壁灯 | 70 |
| 3 | `凯晟德/202511香港展更新/LS model Light 100W qoutation251118.xlsx` | likely | 路灯 | 66 |

> **#1 TR-ES**：已确认暂归 **路灯**（同系列有 TR-ES02 Solar streetlight All in one）。dry-run 标 confidence=medium，如果样本行出现 flood light/投光/TG/TB 再改。

### 绿晟（11 文件，~163 行）

| # | 文件 | 判定 | 目标品类 | ~行数 |
|---|---|---|---|---:|
| 4 | `绿晟/202311/绿晟--F15系列泛光灯报价单不足瓦LS202311.xls` | likely | 投光灯 | 22 |
| 5 | `绿晟/202311/绿晟--F15系列泛光灯报价单LS202311.xls` | likely | 投光灯 | 22 |
| 6 | `绿晟/202410/绿晟--F15系列泛光灯报价单LS202410.xls` | likely | 投光灯 | 22 |
| 7 | `绿晟/202510/绿晟--F15系列泛光灯报价单LS202512.xls` | likely | 投光灯 | 22 |
| 8 | `绿晟/…充电灯DC/绿晟-R02三面折叠款充电灯报价单LS202403.xls` | likely | **充电灯** | 11 |
| 9 | `绿晟/…充电灯DC/绿晟-R07R08R09充电灯报价单LS202403.xls` | likely | **充电灯** | 12 |
| 10 | `绿晟/…工作灯AC/绿晟-W12F款工作灯报价单LS202403.xls` | likely | 工作灯 | 20 |
| 11 | `绿晟/…充电灯DC/绿晟--R03充电灯报价单LS202403.xls` | review | **充电灯** | 9 |
| 12 | `绿晟/…充电灯DC/绿晟-R01充电灯报价单LS202403.xls` | review | **充电灯** | 11 |
| 13 | `绿晟/…充电灯DC/绿晟-R06充电灯报价单LS202403.xls` | review | **充电灯** | 11 |
| 14 | `绿晟/…工作灯AC/绿晟-W12F款工作灯报价单20W50W.xls` | review | 工作灯 | 10 |

> **F15 ×4 版本**：同产品线不同日期（2023.11, 2024.10, 2025.12）+ 不足瓦变体。upsert 逻辑：同型号同供应商 → 新 offer + price_history。
> **needs-review ×4**：纳入 dry-run，价格列检测失败则自动跳过，不会污染数据。

### 伊特（2 文件，~130 行）

| # | 文件 | 判定 | 目标品类 | ~行数 |
|---|---|---|---|---:|
| 15 | `伊特/2023/0731 TG111波兰产品报价…202308.xlsx` | likely | 投光灯 | 15 |
| 16 | `伊特/2026/4.25 产品报价-含税.xlsx` | likely | **分析模式** | 115 |

> **#16 产品报价-含税**：115 行综合报价单，用户确认内容未知，不能一刀切归品类。
> dry-run 对此文件输出完整分析（每 sheet 名、前 10-20 行 model/description 样本、检测关键词、建议品类）。
> apply 时跳过此文件，等人工分配 sheet 级品类后再处理。
> 规则：同 sheet 基本同品类 → 按 sheet 导入；同 sheet 混品类 → 暂停，不导入。

### 中屹（3 文件，~28 行）

| # | 文件 | 判定 | 目标品类 | ~行数 |
|---|---|---|---|---:|
| 17 | `中屹/202406/24-6-20无边框报价（含 包装尺寸）.xlsx` | likely | 面板灯 | 20 |
| 18 | `中屹/…报价 20230626/UFO-01HX90%230420.xlsx` | likely | Highbay | 3 |
| 19 | `中屹/…报价 20230626/ZY-SL-02金钻price230420.xlsx` | likely | 路灯 | 5 |

## 3. 已确认决策

| 编号 | 问题 | 决策 |
|---|---|---|
| Q1 | 凯晟德 TR-ES 品类 | 暂归路灯，dry-run 标 medium，样本验证 |
| Q2 | 伊特 4.25 产品报价-含税 品类 | dry-run 输出 sheet 级样本，apply 跳过，人工分配后单独处理 |
| Q3 | needs-review 4 文件 | 纳入 dry-run，检测失败则静默跳过并记录 |

## 4. 技术方案

### 脚本结构

新建 `scripts/outdoor-unclassified-import.ts`，结构参考 `tube-bulb-split-apply.ts`：

1. **硬编码文件清单**：19 条记录，每条含 `relativePath` + `targetCategory` + `factory`
2. **复用 V2.17F 价格列检测**：`isNonPriceHeader()` / `isPriceHeader()` / `isRmbPriceHeader()` / `sortSignal()` / model==price 同列排除
3. **读取逻辑**：SheetJS 读 .xls/.xlsx → 逐 sheet 检测表头 → 找型号列 + 价格列 → 提取行
4. **写入逻辑**：upsert product（by model_no + supplier）→ upsert offer → insert price_history
5. **新品类创建**：脚本开头检查 `充电灯` 品类是否存在，不存在则 `INSERT INTO categories`（或直接靠 product.category 字段）
6. **dry-run 模式**：`--report` 输出 sheet 级别汇总 + 前 3 行样本（含型号、产品名、价格、remark 截断），不写 DB
7. **apply 模式**：`--apply` 写 DB，输出统计

### 与现有导入脚本的关系

| 脚本 | 用途 | 复用 |
|---|---|---|
| `batch-import.ts` | V2.x 主导入（按品类目录） | 不复用，那个按品类目录结构走 |
| `tube-bulb-split-dryrun.ts` | 灯管/球泡拆分 dry-run | 复用价格列检测函数 |
| `tube-bulb-split-apply.ts` | 灯管/球泡拆分 apply | 复用价格列检测 + upsert 逻辑 |
| **本脚本** | 户外未判定导入 | 新建，参考 tube-bulb-split 结构 |

### DB 变更

无 schema 变更。`充电灯` 作为 `products.category` 值直接写入即可（category 不是外键）。

## 5. 执行步骤

### Phase 1: 确认（Claude + 用户）

1. 用户确认 Q1-Q3
2. Claude 写 Codex task file `docs/codex-task-v2.18.md`

### Phase 2: Dry-run（Codex）

1. 备份 DB
2. 新建脚本 `scripts/outdoor-unclassified-import.ts`
3. 运行 dry-run → 生成 `docs/v2.18-dryrun-report.md`
4. 报告含：每文件 sheet 数 / 可导入行数 / 价格列检测结果 / 前 3 行样本

### Phase 3: 审核 + Apply（Claude 审核 → Codex apply）

1. Claude 审核 dry-run 报告
2. 确认无误后 Codex 运行 apply → 生成 `docs/v2.18-apply-report.md`
3. 验证 DB 增量

### Phase 4: 参数提取（V3.0G）

导入完成后对新品类运行 `extract-params.ts`。充电灯需新增 extractor。

## 6. 不做的事

- 不导入 enrichment-only 文件
- 不导入 _lenovo 冲突文件
- 不修改源 Excel 文件
- 不改 UI
- 不做参数提取（V3.0G 单独做）
- 不改现有品类的产品/报价
