# Codex Task: V3.0A — 从现有 DB 字段提取结构化参数

## 目标

从 `products` 和 `supplier_offers` 的现有字段中提取结构化参数，写入新表 `product_params`。

**只处理 5 个高提取率品类，只写 high/medium confidence。不依赖外接硬盘、不依赖源 Excel 文件。**

## 背景

V2.15 定义了 26 品类的字段模板。V2.15 extraction spike 验证了 5 个品类从现有 DB 字段就能提取大部分参数：

| 品类 | 产品数 | watts 提取率 | 特点 |
|---|---:|---|---|
| 球泡 | 151 | 100% | model_no 含 base+watts，remark 含 dimmable/voltage/cri |
| 太阳能 | 174 | 67% | product_name 就是完整规格书（panel/battery/lumens/cct/ip/sensor） |
| 灯带 | 21 | — | model_no 就是完整规格（led_type/leds_per_meter/voltage/color） |
| 净化灯 | 80 | 100% | product_name 含 material/led_bars/watts/size |
| 吸顶灯 | 49 | 100% | model_no 含 watts，size 含 diameter |

合计约 475 个产品。

### 参考文档

- `docs/v2.15-category-field-templates.md` — 品类字段模板（**必读**）
- `docs/v2.15-extraction-spike.md` — 提取可行性验证

## 前置条件

- V2.16 已完成（表头误导入产品已清理）
- 当前 DB：2,140 products / 2,230 offers

---

## Step 1: 建表 + 备份

### 1.1 备份 DB

```bash
cp prisma/dev.db backups/dev-before-v3.0a-param-extraction-$(date +%Y%m%d-%H%M%S).sqlite
```

### 1.2 用 raw SQL 建 product_params 表

```sql
CREATE TABLE IF NOT EXISTS product_params (
  id               TEXT NOT NULL PRIMARY KEY,
  product_id       TEXT NOT NULL,
  param_key        TEXT NOT NULL,
  raw_value        TEXT NOT NULL,
  normalized_value TEXT,
  unit             TEXT,
  source_field     TEXT NOT NULL,
  confidence       TEXT NOT NULL DEFAULT 'medium',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_params_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX product_params_product_id_idx ON product_params(product_id);
CREATE INDEX product_params_param_key_idx ON product_params(param_key);
CREATE INDEX product_params_key_value_idx ON product_params(param_key, normalized_value);
```

### 1.3 更新 Prisma schema

在 `prisma/schema.prisma` 中加 `ProductParam` model，与 `Product` 关联。注意 `@@map("product_params")`，字段用 `@map` 映射 snake_case。

### 1.4 运行 `npx prisma generate`

只生成 client，不跑 migrate（schema-engine 在此机器有 bug）。

---

## Step 2: 写提取脚本

创建 `scripts/extract-params.ts`。

### 2.1 架构

```
主流程：
1. 读取目标品类的所有 products（含关联 supplier_offers）
2. 对每个 product，按品类调用对应的提取函数
3. 提取函数返回 ExtractedParam[] 
4. 批量写入 product_params（先清除该 product 的旧 params，再插入新的）

类型：
interface ExtractedParam {
  paramKey: string
  rawValue: string
  normalizedValue: string | null
  unit: string | null
  sourceField: 'model_no' | 'product_name' | 'remark' | 'size' | 'material' | 'offer_remark'
  confidence: 'high' | 'medium' | 'low'
}
```

### 2.2 提取来源优先级

对每个 product，按以下顺序读字段：
1. `products.remark`
2. `products.size`
3. `products.material`
4. `products.model_no`
5. `products.product_name`
6. `supplier_offers.remark`（取第一条 offer 的 remark）

同一个 param_key 如果在多个字段中都能提取到，取 confidence 最高的那条。如果 confidence 相同，取优先级靠前的来源。

### 2.3 各品类提取规则

#### 球泡（category = '球泡'）

| param_key | 提取规则 | confidence |
|---|---|---|
| base | 正则匹配 `(E27\|E14\|E26\|GU10\|GU5\.3\|MR16\|MR11\|GX53\|B22\|B15)` from model_no / product_name | high |
| watts | 正则 `(\d+\.?\d*)\s*W(?!\w)` from model_no / product_name / remark。纯数字不算 | high |
| shape | 正则 `(A\d+\|C3[57]\w?\|G\d+\|PAR\d+\|R\d+\|T\d+\|BR\d+\|ED\d+)` from model_no | high |
| dimmable | remark 含"可调光" / "Dimmable" → yes；含"不可调光" / "Non-dim" → no | high |
| voltage | 正则 `(\d+-?\d*V)` 或 `(AC\d+V?\|DC\d+V?)` from remark | high |
| cri | 正则 `[≥>]?\s*(\d+)\s*显指` 或 `Ra\s*(\d+)` 或 `CRI\s*[≥>]?\s*(\d+)` from remark | high |
| beam_angle | 正则 `(\d+)\s*°` from model_no / remark | high |

#### 太阳能（category = '太阳能' OR '太阳能壁灯'）

从 product_name（长文本规格书）提取：

| param_key | 提取规则 | confidence |
|---|---|---|
| watts | 正则 `(\d+)\s*W` from model_no（如 SL-FF-50W） | high |
| panel_watts | 正则 `(?:Solar [Pp]anel\|Panel)[:\s]*(\d+\.?\d*)\s*W` 或 `Panel data[:\s]*(\d+\.?\d*)\s*W` | high |
| panel_type | 含 "mono" → monocrystalline；含 "poly" → polycrystalline；含 "amorphous" → amorphous | high |
| battery_spec | 正则 `(?:Battery\|Battry)[:\s]*(.+?)(?=LED\|Solar\|Material\|Luminous\|$)` 粗提取 | medium |
| led_count | 正则 `(\d+)\s*PCS` | high |
| lumens | 正则 `(\d+)\s*[Ll][Mm]` 或 `Luminous [Ff]lux[:\s]*(\d+)` | high |
| cct | 正则 `(\d{4,5})\s*K` 或 `Color [Tt]emp[:\s]*(\d{4,5})` 或 `(\d{4,5})-(\d{4,5})K`（范围） | high |
| ip | 正则 `IP(\d{2})` | high |
| sensor | 含 "PIR" → PIR；含 "microwave" → microwave；含 "radar" → radar | high |
| charging_time | 正则 `[Cc]harg(?:ing\|e)\s*[Tt]ime[:\s]*[>]?\s*(\d+-?\d*)\s*[Hh]` | medium |
| working_modes | 正则 `(\d+)\s*[Ww]orking [Mm]odes` 或计数 "Mode" 出现次数 | medium |
| material | 正则 `[Mm]aterial[:\s]*([A-Za-z+\s]+?)(?=[\s,，]?(?:Solar\|Color\|Panel\|IP\|LED\|$))` | medium |

#### 灯带（category = '灯带'）

从 model_no（如 `LST-220V-NW-2835-120P-10`）和 product_name 提取：

| param_key | 提取规则 | confidence |
|---|---|---|
| led_type | 正则 `((?:SMD\s*)?(?:2835\|5050\|3528\|5730)\|COB)` from product_name / model_no | high |
| leds_per_meter | 正则 `(\d+)P` from product_name / model_no | high |
| lines | 正则 `(\d+)\s*[Ll]ines?` from product_name；或 model_no 含 `-2-` → 2，`-3-` → 3 | medium |
| voltage | model_no 含 `220V` → AC220V；含 `12V` → DC12V；含 `24V` → DC24V | high |
| color | model_no 含 `RGB` → RGB；`NW` → NW；`WW` → WW；`CW` → CW | high |
| width_mm | 从 products.size 提取第一个数字 | medium |

#### 净化灯（category = '净化灯'）

从 product_name（如 `经济款彩涂板LED净化灯HS-GT5023F单支灯条`）提取：

| param_key | 提取规则 | confidence |
|---|---|---|
| body_material | 含"彩涂板"/"彩钢板" → 彩涂板；"喷白铁" → 喷白铁材；"铝材"/"铝" → 铝材 | high |
| led_bars | 含"单支" → 1；"双支" → 2；"三支" → 3；"4支" → 4；"6支" → 6 | high |
| watts | 正则 `(\d+)W` from product_name 末尾 | high |
| length_mm | 正则 `(\d{3,4})(?:\*\|×\|x)` from products.size，取第一个 ≥300 的值 | medium |
| width_mm | 从 products.size 取第二个数字 | medium |
| height_mm | 从 products.size 取第三个数字 | medium |
| power_tier | 含"高功率" → high；"低功率"/"经济" → low | high |
| shape | 含"方形" / "F系列" → 方形；"椭圆" / "T系列" → 椭圆 | high |

#### 吸顶灯（category = '吸顶灯'）

| param_key | 提取规则 | confidence |
|---|---|---|
| watts | 正则 `(\d+)W` from model_no（如 LC-F-50W） | high |
| shape | model_no 含 R → 圆；含 S → 方 | medium |
| diameter_mm | 正则 `[φΦøØ]\s*(\d+)` from products.size | medium |
| height_mm | 正则 `[×xX*]\s*(\d+)\s*(?:mm)?$` from products.size | medium |

### 2.4 通用 size 解析器

所有品类共用。输入 `products.size`，输出维度参数：

```
输入格式            → 输出
"Φ50*55"           → diameter_mm=50, height_mm=55
"φ500x42"          → diameter_mm=500, height_mm=42
"Dia73*26"         → diameter_mm=73, height_mm=26
"1200*105*69.5"    → length_mm=1200, width_mm=105, height_mm=69.5
"85*85*40mm"       → length_mm=85, width_mm=85, height_mm=40
"L1000*W26*H53 mm" → length_mm=1000, width_mm=26, height_mm=53
"600"              → length_mm=600
"0.6M"             → length_mm=600 (convert m to mm)
"14.6*8*8cm"       → length_mm=146, width_mm=80, height_mm=80 (convert cm to mm)
```

注意：
- 含 Φ/φ/Ø/ø/Dia 的是直径，第一个数字 → diameter_mm
- 含 L/W/H 前缀的，按前缀分配
- 无前缀的，根据品类判断：吸顶灯/筒灯等圆形灯 → 第一个是 diameter；线性灯（三防灯/净化灯/线条灯）→ 第一个是 length
- cm 和 M 单位要换算成 mm
- size_display：生成标准化显示文本，如 `Φ50×55mm` 或 `1200×105×69.5mm`
- confidence = medium（size 字段的数字没有明确标注是什么维度）

---

## Step 3: dry-run 模式

脚本支持 `--dry-run` 参数：

```bash
npx tsx scripts/extract-params.ts --dry-run
```

dry-run 模式下：
- 不写入 DB
- 输出每个品类的提取统计：

```
=== 球泡 (151 products) ===
  watts:      148 extracted (98%), 148 high, 0 medium
  base:       149 extracted (99%), 149 high, 0 medium
  shape:      140 extracted (93%), 140 high, 0 medium
  dimmable:    45 extracted (30%), 45 high, 0 medium
  ...
  Total params: 850
  Skipped (low confidence): 12

=== 太阳能 (174 products) ===
  ...
```

- 输出 5 条示例产品的完整提取结果（每品类各 1 条）
- 输出 confidence=low 的完整列表（这些不会写入 DB）
- 将 dry-run 报告写入 `docs/v3.0a-dry-run-report.md`

---

## Step 4: 等用户确认

**重要：dry-run 完成后停止。** 等用户审阅 `docs/v3.0a-dry-run-report.md` 后再执行 apply。

这是本任务唯一的停止点。

---

## Step 5: apply 模式

用户确认后执行：

```bash
npx tsx scripts/extract-params.ts --apply
```

- 对每个 product：先 `DELETE FROM product_params WHERE product_id = ?`，再批量 `INSERT`
- 只写入 confidence = high 或 medium 的参数
- confidence = low 的参数写入 dry-run 报告但不写入 DB
- 事务保护：每个品类一个事务，失败回滚该品类

---

## Step 6: 验证 + 提交

- 统计 product_params 总行数
- 按 param_key 统计分布
- 按 confidence 统计分布
- 按品类统计覆盖率
- 抽查 3 个产品的完整参数（人工可读格式）
- `npm test` / `npm run lint` / `npm run build` 通过
- 结果写入 `docs/v3.0a-param-extraction-result.md`
- git commit

---

## 不做的事

- 不处理球泡/太阳能/灯带/净化灯/吸顶灯以外的品类
- 不读取源 Excel 文件（不依赖外接硬盘）
- 不修改 products / supplier_offers 的任何现有字段
- 不改导出模板（Product Details 列格式不变）
- 不写入 confidence=low 的参数到 DB
- 不做 UI 改动

## 注意事项

- Schema 变更用 raw SQL + sqlite3（Prisma schema-engine 在此机器有 empty error bug）
- UUID 生成用 `crypto.randomUUID()`
- `updated_at` 用 `new Date().toISOString()`
- 提取正则要防止贪婪匹配，尤其太阳能的长文本
- 太阳能 product_name 中数字很多（panel watts / battery voltage / battery capacity / led count / lumens / charging hours），正则要有上下文锚点，不能只匹配裸数字
