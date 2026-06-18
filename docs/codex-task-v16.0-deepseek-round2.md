# V16.0 — DeepSeek 二轮推理补全剩余缺口

当前完成率 92.9%（9516/10244）。剩余 728 个产品缺 795 条核心参数，其中 549 个缺 CCT。

本任务将这些产品的文本数据（product_name + remark + 已有参数）发送给 DeepSeek 推理缺失的核心参数。

**依赖：V15.0 已完成。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v16.0
```

## 新建文件：`scripts/v16.0-deepseek-round2.ts`

```bash
npx tsx scripts/v16.0-deepseek-round2.ts                    # dry-run: 统计缺口，不调 API
npx tsx scripts/v16.0-deepseek-round2.ts --infer             # 调用 DeepSeek，写缓存
npx tsx scripts/v16.0-deepseek-round2.ts --apply             # 从缓存读取结果，写入 DB
```

三阶段模式同 V13.0。

---

## 整体结构

参照 `scripts/v13.0-deepseek-params.ts` 的架构，但只针对**仍缺核心参数的非 accessory 产品**。

### 数据加载

1. 所有 products（id, productName, modelNo, category, remark, size, material）
2. 所有 product_params（productId, paramKey, rawValue, normalizedValue, unit, sourceField）
3. accessoryIds（通过 `loadAccessoryProductIds`）
4. `CATEGORY_CORE_PARAMS` 定义

### 候选产品筛选

对每个非 accessory 产品，检查 `CATEGORY_CORE_PARAMS[category]` 中哪些参数缺失。只选有至少 1 个核心参数缺失的产品。

缺失参数限定为可被 AI 推理的参数集：`voltage, cct, cri, pf, driver_type, material, beam_angle, base`（与 V13.0 的 `AI_INFERABLE_PARAMS` 一致）。

如果一个产品的核心参数缺失项中有 `ip` 但 `ip` 不在 AI 可推理范围内 → 跳过 ip，不要求 DeepSeek 推理 ip。**但仍然要推理该产品的其他缺失核心参数。**

实际上 ip 应该可以推理。将 `ip` 加入可推理参数集：`voltage, cct, cri, pf, ip, driver_type, material, beam_angle, base`。

### Prompt 设计

复用 V13.0 的 prompt 格式，但做以下调整：

1. **包含已有参数**：把产品的所有已有参数（不仅是缺失的）传给 DeepSeek 作为上下文
2. **明确说明这是二轮推理**：prompt 中提及"这些产品之前未能通过规则和统计方法获取以下参数"
3. **增加 ip 参数格式说明**：`ip 格式：两位数字，如 "20"、"44"、"54"、"65"、"67"、"68"。`

```typescript
function buildPrompt(category: string, products: ProductWithContext[]): string {
  return `你是照明行业规格参数专家。下面是 ${products.length} 个"${category}"产品，每个产品有型号、名称、备注和已有参数。
这些产品的以下参数无法从报价表中直接获取，请根据产品型号、名称、备注和行业常识推断。

规则：
1. 只填你有把握的值。不确定就写 null。
2. voltage 格式：纯数字或范围，如 "220-240"、"100-240"、"48"、"12"。不带 V/AC 前缀。
3. cct 格式：纯数字或范围，如 "3000"、"6500"、"3000-6500"、"2700-6500"。不带 K 后缀。
4. cri 格式：纯数字，如 "80"、"90"。
5. pf 格式：小数，如 "0.5"、"0.9"。
6. ip 格式：两位数字，如 "20"、"44"、"54"、"65"、"67"、"68"。
7. driver_type 格式：中文，如 "隔离"、"非隔离"、"DOB"、"LC"、"恒流IC"。
8. material 格式：中文材料名，如 "铝+PC"、"铝压铸"、"玻璃"、"ABS"。
9. beam_angle 格式：纯数字（度），如 "120"、"60"、"15-60"。
10. base 格式：标准灯头型号，如 "E27"、"E14"、"GU10"、"G4"、"G9"。

${category} 品类背景：${getCategoryContext(category)}

产品列表（JSON）：
${JSON.stringify(products.map(p => ({
  id: p.id,
  model: p.model_no,
  name: p.product_name,
  remark: (p.remark ?? "").slice(0, 300),
  existing: p.existingParams,
  missing: p.missingParams,
})), null, 2)}

请返回 JSON 数组，每个元素格式：
{"id": "产品ID", "params": {"param_key": "value_or_null"}}
只返回 JSON，不要其他文字。`;
}
```

### getCategoryContext

复用 V13.0 中的 `getCategoryContext` 函数。如果 V13.0 中有此函数则直接照抄逻辑。如果没有，为每个品类写一句话行业背景（帮助 DeepSeek 理解上下文）。

### 批次

- 每批最多 30 个产品（同 V13.0）
- 按品类分组，每批同品类
- 缓存目录：`data/deepseek-cache-v16/`（不覆盖 V13.0 缓存）
- 缓存文件格式同 V13.0

### API 调用

- 模型：`deepseek-v4-flash`（与 V13.0 一致，使用 `.env.local` 中的 `DEEPSEEK_API_KEY`）
- temperature: 0.1
- 重试：3 次
- 每批间隔：500ms
- 使用 `openai` npm 包，baseURL: `https://api.deepseek.com/v1`

### 结果写入（--apply 模式）

1. 从缓存文件读取 DeepSeek 返回的参数
2. 验证每个值的格式合法性（同 V13.0 的验证逻辑）
3. 跳过已有值的参数（通过 `productParamKey` 去重）
4. 写入 product_params，source_field = `"deepseek_inference_v16"`，confidence = `"low"`

---

## 报告：`docs/v16.0-deepseek-round2-report.md`

```markdown
# V16.0 DeepSeek 二轮推理报告

模式: dry-run / infer / apply
时间: ...
备份: prisma/dev.db.bak-v16.0

## 缺口分析

| 品类 | 缺失产品数 | 有文本数据 | 批次数 |
|---|---:|---:|---:|

## 推理统计（仅 infer/apply 模式）

| 指标 | 数量 |
|---|---:|
| 总批次 | X |
| 已缓存 | X |
| API 调用 | X |
| 成功 | X |
| 失败 | X |
| 返回参数项 | X |

## 写入统计（仅 apply 模式）

| param_key | 有效 | 已有跳过 | 无效跳过 | 写入 |
|---|---:|---:|---:|---:|

## 覆盖率变化

| 指标 | V15.0 | V16.0 |
|---|---:|---:|
| 核心参数覆盖范围产品 | 10244 | X |
| 全部完成产品 | 9516 | X |
| 全局完成率 | 92.9% | X% |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | 10284 | 10284 | 0 |
| product_params | 95901 | X | +X |
```

---

## Commit

```
V16.0: DeepSeek round-2 inference for remaining parameter gaps
```

## 不做什么

- 不删除任何记录
- 不改 category / Prisma schema / 前端
- 不修改源 Excel 文件
- 不修改已有脚本
- 不覆盖 V13.0 缓存（用独立缓存目录）
- 不修改 CATEGORY_CORE_PARAMS
