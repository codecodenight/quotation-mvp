# Codex Task: V3.0B — Batch 1 品类参数提取

## 目标

对 V2.14 Batch 1 导入的 5 个品类（投光灯 / 面板灯 / 线条灯 / 路灯 / 灯带）做结构化参数提取，写入 `product_params` 表。

**只从 DB 字段提取（product_name, model_no, remark, size, material + offer remark）。不读源 Excel。不改其他表。**

## 范围

| 品类 | products | 现有 params | 目标 |
|---|---:|---:|---|
| 线条灯 | 1,119 | 0 | 新增 |
| 面板灯 | 886 | 0 | 新增 |
| 投光灯 | 444 | 0 | 新增 |
| 灯带 | 383 | 78 | 补充（V3.0A 已提取原始 21 产品，新增 362 产品需提取） |
| 路灯 | 197 | 0 | 新增 |
| **合计** | **3,029** | **78** | |

## 实现方式

**扩展现有 `scripts/extract-params.ts`**，不新建脚本。

### 需要做的改动

1. `TARGET_CATEGORIES` 增加 5 个品类
2. `extractProductParams()` 的 switch 增加 5 个 case
3. 新增 5 个品类提取函数
4. 报告路径改为 `--report` 参数（已支持）

### 不需要改的

- 框架逻辑（dry-run/apply 模式、dedupeParams、confidence 排序、报告生成）
- 通用提取函数（extractWatts、extractIp、extractVoltage、extractCri、extractBeamAngles）
- upsert 逻辑（已有 product_id + param_key 去重）

---

## 各品类提取规则

### 投光灯 Floodlight（444 产品）

**remark 格式**：`"Watt: 10W\nPF: 0.9\nVoltage: AC220-240V\nLM/W: 80-90LM/W\nCCT: 6000-6500K\nBeam Angle: 110°\nIP: 65"`
→ 高度结构化，Key: Value 格式。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Watt: XXW`) / model_no | extractWatts | high |
| ip | remark (`IP: 65`) / model_no | extractIp | high |
| beam_angle | remark (`Beam Angle: 110°`) | extractBeamAngles | high |
| voltage | remark (`Voltage: AC220-240V`) | extractVoltage | high |
| cct | remark (`CCT: 6000-6500K`) | 新增 extractCct | medium |
| pf | remark (`PF: 0.9`) | 新增 extractPf | medium |
| luminous_efficacy | remark (`LM/W: 80-90LM/W`) | 新增 extractLmW | medium |
| material | remark (`Material: Die-cast Aluminum`) | 直接取 | medium |

### 面板灯 Panel Light（886 产品）

**remark 格式**：稀疏，多为尺寸或空。主要提取来源是 model_no 和 size。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no / remark | extractWatts | high |
| panel_size | size (`300×300`, `600×600`, `300×1200`, `Ø300`) | 解析 size 字段 | high |
| shape | size（含 Ø/圆/round → 圆，含 × → 方） | 从 panel_size 推断 | medium |
| mount_type | remark / model_no（嵌入/明装/吊装/recessed/surface） | 关键词匹配 | medium |
| backlit | remark / model_no（backlit/edge-lit/直下/侧发光） | 关键词匹配 | medium |

### 线条灯 Linear（1,119 产品）

**remark 格式**：大多只有 "PC" 或空。model_no 是主要来源。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | model_no / remark | extractWatts | high |
| length_mm | size / model_no（含 600/1200/1500 等数字） | extractCommonSizeParams 改进 | high |
| material | remark / model_no（PC/铝/aluminum） | 直接取 | medium |
| ip | remark / model_no | extractIp | high |
| series | model_no（提取首段字母+数字组合，如 LDF-G, LWF-5040） | 正则提取 | medium |

### 路灯 Street Light（197 产品）

**remark 格式**：`"Power(±10%): 50W\nPF: PF>0.9\nMaterial: Aluminum+Plastic\nRa: 80\nBeam Angle: 85*140°\nLumen: 90-100lm/w"`
→ 结构化，类似投光灯。

| param_key | 提取源 | 提取方式 | confidence |
|---|---|---|---|
| watts | remark (`Power: XXW`) / model_no | extractWatts | high |
| ip | remark / model_no | extractIp | high |
| beam_angle | remark (`Beam Angle: 85*140°`) | extractBeamAngles | high |
| voltage | remark | extractVoltage | high |
| material | remark (`Material: Aluminum+Plastic`) | 直接取 | medium |
| cri | remark (`Ra: 80`) | extractCri | high |
| luminous_efficacy | remark (`Lumen: 90-100lm/w`) | extractLmW | medium |
| pf | remark (`PF: >0.9`) | extractPf | medium |

### 灯带 LED Strip（383 产品，78 已有 params）

V3.0A 已有 `extractStripParams()`。新增产品的 remark 格式不同：
`"Description: Item：5M LED RGB Strip Light LED Type：RGB5050 LED Qtys： 30D/M，150D Adaptor：24V 0.75A，18W Control： 24keys IR Control DC Cable：1.5m Waterproof：PU Coating， IP20 Product Size：L5000m*10mm"`

现有 extractStripParams 可能无法解析这种格式。需增强：

| param_key | 提取源 | 新增提取规则 | confidence |
|---|---|---|---|
| led_type | remark (`LED Type：RGB5050`) | `LED Type[：:]\s*(\S+)` | high |
| voltage | remark (`Adaptor：24V`) / model_no | extractVoltage + `Adaptor[：:]\s*(\d+V)` | high |
| ip | remark (`IP20`) | extractIp | high |
| leds_per_meter | remark (`30D/M`) | `(\d+)D/M` | high |
| width_mm | remark (`Product Size：...×10mm`) | 从 Product Size 末段取 | medium |
| color | remark (`RGB`, `WW`, `CW`) / model_no | 关键词匹配 | medium |

---

## 需新增的通用提取函数

### extractCct

```
匹配：CCT: 6000-6500K, 3000K, 4000K/6500K, 2700-6500K
正则：(\d{3,5})\s*[-/~]\s*(\d{3,5})\s*K 或 (\d{3,5})\s*K
输出：rawValue = "6000-6500K", normalizedValue = "6000-6500", unit = "K"
```

### extractPf

```
匹配：PF: 0.9, PF>0.9, PF: ≥0.95
正则：PF\s*[:：>≥]?\s*([\d.]+)
输出：rawValue = "0.9", normalizedValue = "0.9", unit = null
```

### extractLmW（光效）

```
匹配：LM/W: 80-90LM/W, Lumen: 90-100lm/w, 光效: 120lm/w
正则：(\d+)\s*[-~]\s*(\d+)\s*(?:lm/w|LM/W) 或 (\d+)\s*(?:lm/w|LM/W)
输出：rawValue = "80-90LM/W", normalizedValue = "80-90", unit = "lm/W"
```

---

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v3.0b-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 扩展脚本

修改 `scripts/extract-params.ts`：
- 增加 `TARGET_CATEGORIES`
- 增加品类提取函数
- 增加通用提取函数（extractCct, extractPf, extractLmW）
- 确保灯带增强逻辑不破坏已有提取

### Step 3: Dry-run

```bash
npx tsx scripts/extract-params.ts --report docs/v3.0b-dry-run-report.md
```

- 只跑新增 5 个品类（已有 V3.0A 品类跳过——它们的 params 已存在）
- 统计每品类每 key 的覆盖率
- 输出样本

### Step 4: Apply

```bash
npx tsx scripts/extract-params.ts --apply --report docs/v3.0b-report.md
```

### Step 5: 验证 + 提交

```sql
SELECT p.category, COUNT(DISTINCT pp.id) as params, COUNT(DISTINCT pp.product_id) as products_with_params
FROM product_params pp
JOIN products p ON pp.product_id = p.id
GROUP BY p.category
ORDER BY params DESC;
```

- product_params 总数应从 2,755 显著增加
- 投光灯/路灯覆盖率应最高（remark 高度结构化）
- products / supplier_offers / files 数量不变
- git commit

---

## 关于已有灯带 params

V3.0A 已为 21 个灯带产品提取了 78 条 params。脚本的 `dedupeParams` 逻辑会处理同一 product_id + param_key 的去重（保留 confidence 最高的）。对新增的 362 个灯带产品，直接提取即可。

## 不做的事

- 不读源 Excel 文件
- 不改 products / supplier_offers / files / price_history
- 不新建品类
- 不改 UI
- 只提 high/medium confidence，不提 low
