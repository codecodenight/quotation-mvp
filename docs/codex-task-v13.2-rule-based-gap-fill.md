# V13.2 — 规则填充：IP / base / voltage 缺口

V13.0 DeepSeek 推断后仍有大量缺口。本任务用**确定性规则**（源文件路径、电压推断、品类属性）填充 IP、base 等参数，不调用 AI。

**依赖：V13.0 已完成，V13.1 可先/后/并行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.2
```

## 新建文件：`scripts/v13.2-rule-based-gap-fill.ts`

```bash
npx tsx scripts/v13.2-rule-based-gap-fill.ts              # dry-run
npx tsx scripts/v13.2-rule-based-gap-fill.ts --apply       # 写入
```

---

## Part A — 线条灯 IP 从源文件路径推断

线条灯缺 IP 共 ~1,083 个产品。源文件路径包含室内/户外信号。

### 数据验证

现有 60 个线条灯有 IP 值：IP20=45(75%), IP65=14, IP54=1。源文件路径分布：

- 室内照明/ → 1,059 个产品（IP20）
- 户外/ → 2 个产品（IP65）
- 其他路径（瑞鑫 LLS-A、乐道 LLS-D、核价线条灯、五面办公灯）→ 31 个产品，均为室内产品 → IP20

### 逻辑

```typescript
// 查询: 线条灯 + 缺 IP 的产品，JOIN supplier_offers → files 取 relative_path
// 路径包含 '户外' → IP65
// 其他所有路径 → IP20（线条灯源文件全部来自室内照明或品牌核价文件）
// source_field: "path_inference"
// confidence: "medium"
```

预计：~1,061 × IP20 + ~2 × IP65 = **~1,063 条**

---

## Part B — 灯带 IP 从电压推断

灯带缺 IP 共 ~313 个产品。其中有电压数据的可用电压推断 IP。

### 数据验证

现有灯带 voltage→IP 相关性：
- 220V → IP65 = 20, IP44 = 2 → **91% IP65**
- 24V → IP20 = 32, IP65 = 1 → **97% IP20**
- 12V → IP65 = 7 → 样本太少(7)，不做默认

缺 IP 且有电压的灯带：
- 220V: 115 个 → 填 IP65
- 24V: 62 个 → 填 IP20
- 12V: 54 个 → **跳过**（样本不足）
- 5V: 8 个 → **跳过**（样本不足）
- 其他: 少量 → **跳过**

### 逻辑

```typescript
// 查询: 灯带 + 缺 IP + 有 voltage 的产品
// normalized_value 以 '220' 开头（包括 '220', '220-240'）→ IP65
// normalized_value = '24' → IP20
// 其他跳过
// source_field: "voltage_inference"
// confidence: "medium"
```

预计：115 + 62 = **~177 条**

---

## Part C — 太阳能 IP65 品类默认

太阳能品类缺 IP 共 ~104 个产品。

### 数据验证

现有太阳能 IP 分布：IP65=183(89%), IP54=10, IP44=13 → **89% ≥85% 阈值**

### 逻辑

```typescript
// 品类 = '太阳能' + 缺 IP → 填 IP65
// source_field: "category_default"
// confidence: "low"
```

预计：**~104 条**

---

## Part D — 灯丝灯 base E27 默认

灯丝灯缺 base 共 ~170 个产品（还有球泡和 G4G9 的 base 缺口但分布不够集中，不处理）。

### 数据验证

灯丝灯已有 base 分布：
- E27 = 463 (82.8%)
- E14 = 47 (8.4%)
- "E27  E40" = 34 (6.1%)
- "E14 E27" = 13 (2.3%)
- "E14/E27" = 6
- "E27 E40" = 5

单一 E27 占 82.8%。如果把包含 E27 的所有值算进去（"E27 E40"、"E14 E27" 都含 E27），比例更高。

**但 82.8% < 85% 阈值。** 需要用更精准的方法：

```typescript
// 对每个缺 base 的灯丝灯产品：
// 1. 取同工厂同品类的 base 分布
// 2. 如果 E27 ≥85% → 填 E27
// 3. 如果 E14 ≥85% → 填 E14
// 4. 否则跳过
// source_field: "factory_category_default"
// confidence: "low"
```

如果按工厂分组后仍不够 85%，作为兜底：

```typescript
// 兜底：对 product_name 或 model_no 包含 "E27" 的 → 填 E27
//       对 product_name 或 model_no 包含 "E14" 的 → 填 E14
//       (不区分大小写)
// source_field: "name_extraction"
// confidence: "medium"
```

预计：**~100-170 条**

---

## Part E — 皮线灯 voltage 从工厂分组推断

皮线灯缺 voltage 共 79 个产品，缺 IP 共 171 个。皮线灯核心参数只有 voltage + IP。

### 数据验证

皮线灯电压分布：220V=50, 5V=27, 85-265V=12, 110-240V=3 → 没有 ≥85% 主导值，太散。

### 逻辑

```typescript
// 对每个缺 voltage 的皮线灯产品：
// 1. 取同工厂同品类的 voltage 分布
// 2. 如果某值 ≥85% → 填该值
// 3. 否则跳过
// source_field: "factory_category_default"
// confidence: "low"
```

预计：根据工厂分组能填多少取决于分组结果，**估 30-50 条**。

---

## Part F — 覆盖率快照

所有填充完成后，按 `docs/category-required-params.md` 的核心参数定义输出最终覆盖率到报告。

---

## 报告：`docs/v13.2-rule-based-gap-fill-report.md`

```markdown
# V13.2 规则填充报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.2

## Part A — 线条灯 IP 路径推断

| 指标 | 数量 |
|---|---:|
| 线条灯缺 IP 总数 | X |
| 源文件路径 室内 | X |
| 源文件路径 户外 | X |
| 源文件路径 其他 | X |
| 填充 IP20 | X |
| 填充 IP65 | X |

## Part B — 灯带 IP 电压推断

| 指标 | 数量 |
|---|---:|
| 灯带缺 IP 总数 | X |
| 有 voltage 的 | X |
| 220V → IP65 | X |
| 24V → IP20 | X |
| 跳过（电压不明确） | X |

## Part C — 太阳能 IP65 品类默认

| 指标 | 数量 |
|---|---:|
| 太阳能缺 IP | X |
| 填充 IP65 | X |

## Part D — 灯丝灯 base 填充

| 指标 | 数量 |
|---|---:|
| 灯丝灯缺 base | X |
| 工厂分组填充 | X |
| 名称提取填充 | X |
| 跳过 | X |

## Part E — 皮线灯 voltage 工厂推断

| 指标 | 数量 |
|---|---:|
| 皮线灯缺 voltage | X |
| 工厂分组填充 | X |
| 跳过 | X |

## Part F — 覆盖率快照

### 逐参数覆盖率

| param_key | 已覆盖 | 需覆盖(品类要求) | 覆盖率 |
|---|---:|---:|---:|

### 品类完成率（核心参数全部有值）

| 品类 | 总产品 | 全部完成 | 完成率 |
|---|---:|---:|---:|

### 全局汇总

| 指标 | 数值 |
|---|---:|
| product_params 变化 | 前 → 后 |
| 本次新增 | X |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10,284 | 10,284 | 0 |
| product_params | X | X | X |
```

---

## 关键实现细节

### product_params 插入格式

```typescript
// INSERT INTO product_params (id, product_id, param_key, raw_value, normalized_value, source_field, confidence, created_at)
// id: 用 crypto.randomUUID()
// raw_value: 人类可读格式（如 "IP20", "IP65", "E27"）
// normalized_value: 标准化值（如 "20", "65", "E27"）
// created_at: new Date().toISOString()
```

### 去重检查

每次插入前检查 product_id + param_key 是否已有非空 normalized_value，已有则跳过。

### 源文件路径查询

```sql
SELECT DISTINCT p.id, f.relative_path
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
JOIN files f ON f.id = so.source_file_id
WHERE p.category = '线条灯'
AND p.id NOT IN (
  SELECT product_id FROM product_params
  WHERE param_key = 'ip'
  AND normalized_value IS NOT NULL AND TRIM(normalized_value) != ''
)
```

如果一个产品有多个 offers 来自不同路径，取第一个匹配的路径（室内/户外）。如果路径冲突（一个室内一个户外），跳过。

---

## Commit

```
V13.2: rule-based gap fill for IP (path/voltage inference), base defaults, and coverage snapshot
```

## 不做什么

- 不调用 DeepSeek API
- 不覆盖已有参数
- 不删产品/offers/参数
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不填 CCT（规则无法可靠推断色温）
