# V10.0 — 源文件参数审计（纯读取，不改数据）

## 目标

遍历所有已入库的 Excel 源文件，提取每个文件的表头列名，汇总所有出现过的列名，对比当前 `product_params` 的覆盖情况。产出一份完整的审计报告到 `docs/v10.0-audit-report.md`。

**不修改任何数据库记录，不改任何现有代码。**

## 背景

当前导入管线只抽了固定几列（产品名、型号、价格、尺寸、备注），Excel 里的其他列（光效、流明、CRI、Driver、Flicker 等）从未入库。`extract-params.ts` 用正则从已入库文本里提取参数，天花板受限于入库内容。

需要先搞清楚：
1. 源 Excel 里到底有哪些列？
2. 哪些列已有对应 param_key，哪些完全没有？
3. 每个文件有多少数据行？通过 `supplier_offers.source_file_id` 关联到多少 Product？

## 实现

### 脚本：`scripts/v10.0-source-audit.ts`

用 `tsx` 运行。读取 DB + 源 Excel 文件，生成 markdown 报告。

### 步骤

#### 1. 从 DB 获取文件清单

```sql
SELECT id, file_name, relative_path, folder_name
FROM files
WHERE file_type = 'excel';
```

共约 688 个文件。

#### 2. 定位文件物理路径

文件 `relative_path` 有三种前缀：
- `data/source-archive/...`（676 个）— 物理路径 = 项目根 + relative_path
- `sample data/...`（5 个）— 物理路径 = 项目根 + relative_path
- `sample-data/...`（7 个）— 物理路径 = 项目根 + relative_path

先检查文件是否存在（`fs.existsSync`）。不存在的跳过并记录。

#### 3. 读取每个 Excel 的表头

用 SheetJS（项目已有依赖）读取：

```typescript
const XLSX = require("xlsx");
const wb = XLSX.readFile(filePath);
```

对每个 sheet：
- 读取前 10 行（`sheet_to_json({ header: 1, range: { s: {r:0,c:0}, e: {r:9,c:range.e.c} } })`）
- **检测表头行**：遍历前 10 行，找到非空单元格最多的那一行作为表头行（跳过公司名、地址等装饰行）
- 额外条件：表头行至少有 5 个非空单元格
- 提取该行所有非空单元格的值作为列名
- 记录 sheet 总数据行数 = `range.e.r - headerRowIndex`

#### 4. 列名归一化

对提取到的原始列名做清洗：
- `trim()`
- 去掉换行符 `\n` `\r`，替换为空格
- 转小写
- 去掉 `±10%`、`(mm)`、`(cm)`、`(USD)` 等括号内容及常见后缀
- 合并空格

#### 5. 列名分类

把归一化后的列名归入以下类别：

**A. 产品标识列**（不需要存参数）：
- 匹配 `item no` `model` `型号` `产品名` `product name` `photo` `picture` `图片` `序号`

**B. 商务/包装列**（已在 SupplierOffer 里）：
- 匹配 `price` `fob` `moq` `ctn` `carton` `package` `packing` `g.w` `n.w`

**C. 参数列**（应该存入 product_params 的）——这是重点：
- 建一个映射表，把常见列名映射到标准 param_key：

```typescript
const HEADER_TO_PARAM: Record<string, string> = {
  // 已有 param_key
  "power": "watts",
  "watt": "watts",
  "功率": "watts",
  "w": "watts",
  "cct": "cct",
  "色温": "cct",
  "cri": "cri",
  "ra": "cri",
  "显指": "cri",
  "pf": "pf",
  "power factor": "pf",
  "lm/w": "luminous_efficacy",
  "efficiency": "luminous_efficacy",
  "光效": "luminous_efficacy",
  "luminous flux": "luminous_efficacy",
  "lumens": "lumens",
  "lumen": "lumens",
  "光通量": "lumens",
  "beam angle": "beam_angle",
  "光束角": "beam_angle",
  "ip": "ip",
  "ip class": "ip",
  "ip grade": "ip",
  "防护等级": "ip",
  "voltage": "voltage",
  "input voltage": "voltage",
  "input": "voltage",
  "电压": "voltage",
  "material": "material",
  "材质": "material",
  "size": "size_display",
  "dimension": "size_display",
  "尺寸": "size_display",
  "product size": "size_display",
  "body size": "size_display",
  "led type": "led_type",
  "chip type": "led_type",
  "chip": "led_type",
  "base": "base",
  "灯头": "base",
  "warranty": "warranty",
  "质保": "warranty",
  "guarantee": "warranty",
  "certificate": "certification",
  "认证": "certification",
  "shape": "shape",
  "形状": "shape",
  "cut size": "cutout_mm",
  "hole size": "cutout_mm",
  "开孔": "cutout_mm",
  "led qty": "led_count",
  "led no": "led_count",
  "chips qty": "led_count",
  "led quantity": "led_count",
  
  // 新 param_key（当前 DB 里完全没有）
  "driver": "driver_type",
  "driver brand": "driver_brand",
  "驱动": "driver_type",
  "flicker": "flicker",
  "flickery": "flicker",
  "频闪": "flicker",
  "sdcm": "sdcm",
  "色容差": "sdcm",
  "spd": "spd",
  "surge": "spd",
  "ambient temperature": "ambient_temp",
  "环境温度": "ambient_temp",
  "height": "height_mm",
  "cut size": "cutout_mm",
  "maximum linkable power": "max_linkable_power",
  "accessories": "accessories",
  "note": "note",
  "remark": "note",
  "备注": "note",
};
```

列名匹配逻辑：对归一化后的列名，按 `includes` 做模糊匹配（先尝试全匹配，再尝试 includes）。

**D. 未识别列**：不属于 A/B/C 的，单独记录。

#### 6. 关联产品覆盖率

对每个 source file：
```sql
SELECT COUNT(DISTINCT product_id) as product_count
FROM supplier_offers
WHERE source_file_id = ?;
```

对比 Excel 数据行数 vs 关联的 Product 数。

#### 7. 参数覆盖率交叉

对每个已识别的 param_key，查当前 DB 覆盖率：
```sql
SELECT param_key, COUNT(DISTINCT product_id) as covered
FROM product_params
WHERE param_key = ?
GROUP BY param_key;
```

以及总 Product 数（10,222）。

### 报告格式：`docs/v10.0-audit-report.md`

```markdown
# V10.0 源文件参数审计报告

生成时间: ...
扫描文件数: X / 688
不可访问文件: Y (列表)

## 一、源文件列名汇总

按出现频次排序，显示：
| 原始列名（采样） | 归一化 | 映射 param_key | 出现文件数 | 类别(标识/商务/参数/未识别) |

## 二、参数覆盖率对比

| param_key | Excel 出现文件数 | DB 已有记录数 | DB 覆盖产品数 | 总产品数 | 覆盖率 | 状态 |

状态：✓ >50% / ⚠️ 10-50% / ❌ <10% / 🆕 DB 里完全没有

## 三、品类 × 参数覆盖率矩阵

行=品类，列=关键参数（watts/lumens/efficacy/cri/cct/pf/ip/beam_angle/driver_type）
单元格=该品类该参数的覆盖率百分比

## 四、数据完整性

| 文件名 | Excel 数据行 | 关联 Product 数 | 差异 | 差异率 |

重点标出差异率 > 30% 的文件。

## 五、未识别列名

列出所有未归类的列名 + 出现次数，供人工判断。

## 六、品类细分建议

基于面板灯的 panel_size 数据：
- 大面板（600系）: N 个
- 小面板（圆形/嵌入式）: N 个
建议拆分为独立 category。
```

## 运行

```bash
npx tsx scripts/v10.0-source-audit.ts
```

无参数，无 `--apply` 模式。运行后检查 `docs/v10.0-audit-report.md`。

## 验证

1. 报告文件生成且内容非空
2. 扫描文件数接近 688
3. 列名汇总至少包含 Power/CCT/CRI/PF/lm/W 等已知列
4. 参数覆盖率与之前手查的一致（watts ~47%, lumens ~11%, efficacy ~4%）
5. 数据完整性部分列出了所有文件的行数对比
6. 脚本运行不修改 DB（运行前后 `SELECT COUNT(*) FROM product_params` 不变）

## Commit

`V10.0: source file parameter audit — header extraction and coverage report`
