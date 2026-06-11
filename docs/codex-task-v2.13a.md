# Codex Task: V2.13A — 源文件全量盘点（新目录结构）

## 目标

对硬盘 `各家工厂最新报价汇总/` 的全部 Excel 文件做只读扫描，按四档分类，产出结构化报告 + V2.14 导入候选清单。

**不导入、不改 DB、不改源文件。**

## 背景

用户已将硬盘文件从扁平目录整理为四大类 → 品类 → 工厂的三级结构。旧版 V2.13A 的 9 个优先目录已失效，本版改为全量扫描。

### 当前 DB 状态（stale files 已清理）

| 指标 | 值 |
|---|---:|
| products | 2,140（26 品类） |
| supplier_offers | 2,230 |
| files (My Passport) | 477（全部路径有效） |
| files 有关联 offers | 80 |
| product_params | 2,755 |
| product_images | 1,119（52%） |

### 硬盘新目录结构

```
各家工厂最新报价汇总/
├── 室内照明/
│   ├── 筒灯/          (79 Excel, DB 110 产品, CTN 5)
│   ├── 台灯/          (12 Excel, DB 23 产品)
│   ├── 轨道灯/        (6 Excel, DB 155 产品, CTN 0)
│   ├── 镜前灯/        (23 Excel, DB 63 产品, CTN 0)
│   ├── 磁吸灯/        (56 Excel, DB 148 产品)
│   ├── 应急灯/        (7 Excel, DB 70 产品)
│   ├── 吸顶灯/        (136 Excel, DB 49 产品)
│   ├── 大面板/        (34 Excel, DB 95 面板灯含大小)
│   ├── 风扇灯/        (29 Excel, DB 0 — 全新品类)
│   ├── 铝型材/        (6 Excel, DB 0 — 全新品类)
│   ├── 小面板灯/      (94 Excel, DB 95 面板灯含大小)
│   ├── 线条灯办公灯/  (105 Excel, DB 39 产品)
│   ├── LED橱柜灯/     (6 Excel, DB 134 产品, CTN 0)
│   ├── T5/            (2 Excel, DB 0)
│   └── 支架/          (2 Excel, DB 0)
├── 光源/
│   ├── 灯丝灯/        (6 Excel, DB 477 产品)
│   ├── 球泡灯管/      (50 Excel, DB 161+8 产品)
│   ├── 灯头灯座/      (0 Excel)
│   ├── G4G9/          (7 Excel, DB 0 — 全新品类)
│   └── LED模组/       (2 Excel, DB 0)
├── 灯带/
│   ├── 虹宇/          (17 Excel, DB 23 灯带产品)
│   ├── 迪闻/          (7 Excel)
│   ├── 尼奥/          (5 Excel)
│   ├── 亮而彩/        (4 Excel)
│   ├── 跨境产品/      (5 Excel)
│   ├── 皮线灯 伊特/   (4 Excel, DB 3 产品)
│   ├── 灯带连接器/    (1 Excel)
│   ├── 灯带控制器 镁联/ (2 Excel)
│   ├── 广交会最终核价/ (6 Excel)
│   ├── 双安/          (0 Excel)
│   └── 1988/          (0 Excel)
└── 户外照明 工业照明/
    ├── 净化灯/        (40 Excel, DB 80 产品)
    ├── 三防灯/        (46 Excel, DB 96 产品)
    ├── 工作灯/        (31 Excel, DB 0 — 全新品类)
    ├── 防潮灯/        (22 Excel, DB 11 产品, CTN 0)
    ├── 市电壁灯/      (13 Excel, DB 27 产品, 0 图)
    ├── 户外工厂/      (283 Excel, DB 庭院灯74+投光灯16+路灯15+Highbay6)
    ├── 太阳能壁灯草坪灯地插灯/ (57 Excel, DB 太阳能202+太阳能壁灯87)
    └── LED 地埋灯地插灯/ (11 Excel, DB 58 产品, CTN 0)
```

### 参考文档

- `docs/drive-db-diff-report.md` — 硬盘 vs DB 比对报告
- `docs/drive-db-diff-details.csv` — 逐文件比对明细
- `AGENTS.md` — 项目规则、已完成版本

---

## 扫描逻辑

### 对每个 Excel 文件（.xlsx / .xls）：

1. **基础信息**：文件名、完整路径、大小（bytes）、修改时间、所在品类目录、所在工厂子目录
2. **是否已导入**：
   - 查 `files` 表匹配 `file_name`（完全匹配）
   - 如匹配到，检查该 file 是否有关联 `supplier_offers`（`source_file_id`）
   - 有 offers → `已导入`
   - 在 files 表但无 offers → `已扫描未导入`
   - 不在 files 表 → `未知`
3. **Sheet 结构预览**：用 SheetJS 读每个 sheet
   - sheet 名
   - 总行数
   - 前 10 行采样：识别疑似表头行（含"型号"/"Model"/"单价"/"Price"/"价格"/"报价"等关键词的行）
   - 疑似价格列：至少 5 行含正数的列（排除年份 >2000 的整数列）
   - 疑似型号列：至少 5 行含字母+数字混合值的列
4. **分类打标**（四档）：
   - `likely-importable`：有表头行 + 有疑似 RMB 价格列 + 有疑似型号列 + 未导入
   - `enrichment-only`：无可靠 RMB 工厂价格列，但含有用的产品图片、规格描述、参数列（CTN / size / material / power / lumen / CCT / IP 等）。典型：客户报价（FOB USD）、画册有规格但无 RMB 价、图片丰富但无价格列
   - `needs-review`：有价格或型号迹象但语义不确定（如价格列可能是 USD 也可能是 RMB、有型号但无价格、结构不明确），需人工判断
   - `likely-skip`：已导入 / 空文件 / 纯模板无数据 / 旧版本重复（同组有更新版本）/ 文件名含"知识""样册""说明书""画册""catalog" / 无有效产品信息 / PDF 画册被误存为 Excel
5. **多版本检测**：同一工厂子目录下文件名相似（去掉日期后缀后相同）的文件归为一组，标出最新版本
6. **价格语义判断**：
   - 文件名含"核价" → RMB 工厂价（likely-importable）
   - 文件名含"FOB" / "USD" → 客户价（enrichment-only，不导入价格）
   - 文件名含"含税" → RMB 含税价（likely-importable，注意含税/不含税标记）
   - 以上都不含 → 从表头列名判断（"单价" "RMB" "人民币" → RMB；"USD" "FOB" → 客户价）

### 不做的事

- 不解析具体的价格值或产品数据
- 不做 mapping 配置
- 不写入 DB
- 不修改源文件
- 不处理 PDF 文件（只统计数量）

---

## 输出格式

写入 `docs/v2.13a-source-inventory.md`，结构如下：

```markdown
# V2.13A — 源文件盘点报告

## 总览

| 大类 | 品类 | Excel 文件 | 已导入 | likely-importable | enrichment-only | needs-review | likely-skip | PDF |
|---|---|---:|---:|---:|---:|---:|---:|---:|

## 品类详情：{品类名}

### 摘要
- 路径：...
- Excel 文件数：X
- 工厂：A, B, C
- 已导入：Y / 可导入候选：Z

### 多版本分组
| 工厂 | 文件组 | 版本数 | 建议版本（最新） |

### 文件清单
| 文件名 | 工厂 | 大小 | 修改日期 | Sheets | 有价格列 | 有型号列 | 导入状态 | 分类 | 备注 |

（每个品类重复上面结构）

## V2.14 导入候选清单

| 序号 | 文件 | 品类 | 工厂 | 分类 | 理由 | 预估产品数 |

## 补充数据候选清单（enrichment-only）

| 序号 | 文件 | 品类 | 工厂 | 可补内容（图片/CTN/规格/参数） |

## 扫描统计
- 总文件数 / 总耗时 / 跳过文件数 / 读取失败文件数
```

---

## 执行步骤

### Step 1: 检查硬盘 + 备份

- 确认 `/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/` 可访问
- 如果不可访问 → 报告并停止
- 列出 4 个大类目录及其品类子目录的文件数
- 不需要备份 DB（本任务只读）

### Step 2: 加载已导入文件清单

- 从 DB 读取所有 `files` 表记录（file_name, file_size, id）
- 读取哪些 file.id 有关联 supplier_offers
- 构建查找表供后续匹配

### Step 3: 全量扫描

- 递归扫描 `各家工厂最新报价汇总/` 下所有 .xlsx / .xls 文件
- 对每个文件执行上述扫描逻辑
- 跳过 >100MB 的文件（标为 `needs-review`，记录大小）
- 对 .xls 文件：SheetJS 同样可读，正常处理
- 按品类（level-2 目录）分组输出

### Step 4: 生成报告

- 按上述输出格式写入 `docs/v2.13a-source-inventory.md`
- 额外输出 `docs/v2.13a-import-candidates.csv`（方便后续 V2.14 脚本读取）：
  ```
  path,category,factory,classification,reason,estimated_products
  ```

### Step 5: 提交

- git commit

---

## 特殊处理

### 户外工厂（混合品类目录）

`户外照明 工业照明/户外工厂/` 下按工厂名分子目录，但一个工厂可能包含多个品类（庭院灯、投光灯、路灯、太阳能路灯、工矿灯等）。对这个目录：
- 先按工厂子目录分组
- 再根据文件名/sheet 名中的品类关键词推断品类归属：
  - "庭院灯" / "garden" → 庭院灯
  - "投光灯" / "floodlight" → 投光灯
  - "路灯" / "street" → 路灯
  - "工矿灯" / "highbay" → Highbay
  - "太阳能" / "solar" → 太阳能
  - 无法判断 → 标为 needs-review

### 全新品类

风扇灯、工作灯、G4G9、铝型材、T5、支架、LED模组 在 DB 中无产品。对这些品类：
- 全部标为 `likely-importable`（如果有价格列+型号列）或 `needs-review`
- 在报告中单独标注"**全新品类**"
- 在 V2.14 候选清单中注明需要新建品类

### 发客户报价单汇总

不扫描。已知为客户报价（FOB USD），不是工厂 RMB 价格来源。

---

## 注意事项

- 源 Excel 文件绝不修改
- DB 不写入任何数据
- 外接硬盘如果未挂载，Step 1 直接停止
- SheetJS 读文件如果报错，记录错误但继续扫描下一个
- 扫描脚本写在 `scripts/source-inventory.ts`，可复用于后续增量扫描
- 预计扫描约 1,200 个 Excel 文件，耗时可能较长，脚本应有进度输出
