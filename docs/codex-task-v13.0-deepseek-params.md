# V13.0 — DeepSeek AI 参数批量推断

确定性提取策略全部用尽。剩余 ~17,000 条缺失必要参数需要 AI 推断。

**必须在 V12.4 commit 之后执行。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.0
```

## 新建文件：`scripts/v13.0-deepseek-params.ts`

```bash
npx tsx scripts/v13.0-deepseek-params.ts              # dry-run（不调 API，只统计缺口）
npx tsx scripts/v13.0-deepseek-params.ts --infer       # 调 API 推断，写 JSON 缓存
npx tsx scripts/v13.0-deepseek-params.ts --apply       # 从缓存写入 DB
```

三步模式：dry-run 统计 → --infer 调 API 写缓存 → --apply 写 DB。缓存在 `data/deepseek-cache/` 目录。

---

## Part 0 — 脏数据清理

先清理残留的非法 voltage 值。

```typescript
const DIRTY_VOLTAGE_VALUES = [
  'Aluminum', 'double ended', 'Single End', 'Voltage\n（V）',
  '黑+黑', '白+白', 'Connect power up', 'Voltage'
];
// DELETE FROM product_params WHERE param_key = 'voltage' AND normalized_value IN (...)
// 预计删除 ~25 条
```

---

## Part 1 — 缺口统计

读 `docs/category-required-params.md` 中的品类必要参数定义，生成缺口清单。

```typescript
// 品类必要参数映射（硬编码，从 category-required-params.md 抄）
const CATEGORY_REQUIRED_PARAMS: Record<string, string[]> = {
  '筒灯':       ['watts', 'voltage', 'cct', 'cri', 'pf', 'driver_type', 'size_display'],
  '面板灯':     ['watts', 'voltage', 'cct', 'cri', 'pf', 'driver_type', 'size_display', 'material'],
  '磁吸灯':     ['watts', 'voltage', 'cct', 'cri', 'size_display'],
  '吸顶灯':     ['watts', 'voltage', 'cct', 'cri', 'pf', 'driver_type', 'size_display'],
  '灯丝灯':     ['watts', 'voltage', 'cct', 'cri', 'pf', 'base'],
  '风扇灯':     ['watts', 'voltage', 'cct', 'cri', 'size_display'],
  '球泡':       ['watts', 'voltage', 'cct', 'cri', 'pf', 'base'],
  '壁灯':       ['watts', 'voltage', 'cct', 'cri', 'driver_type', 'material'],
  '净化灯':     ['watts', 'voltage', 'cct', 'cri', 'pf', 'driver_type', 'size_display'],
  '橱柜灯':     ['watts', 'voltage', 'cct', 'cri', 'size_display'],
  '镜前灯':     ['watts', 'voltage', 'cct', 'cri', 'driver_type'],
  '轨道灯':     ['watts', 'voltage', 'cct', 'cri', 'pf', 'beam_angle'],
  '防潮灯':     ['watts', 'voltage', 'cct', 'cri', 'ip', 'pf', 'driver_type'],
  '台灯':       ['watts', 'voltage', 'cct', 'cri'],
  'G4G9':       ['watts', 'voltage', 'cct', 'cri', 'base'],
  '灯管':       ['watts', 'voltage', 'cct', 'cri', 'pf', 'size_display'],
  '线条灯':     ['watts', 'voltage', 'cct', 'cri', 'ip', 'size_display'],
  '投光灯':     ['watts', 'voltage', 'cct', 'cri', 'ip', 'pf', 'beam_angle', 'material'],
  '三防灯':     ['watts', 'voltage', 'cct', 'cri', 'ip', 'pf', 'size_display'],
  '太阳能壁灯': ['watts', 'cct', 'ip', 'material'],
  '太阳能':     ['watts', 'cct', 'ip', 'material'],
  '路灯':       ['watts', 'voltage', 'cct', 'cri', 'ip', 'pf', 'beam_angle'],
  '地埋灯/地插灯': ['watts', 'voltage', 'cct', 'cri', 'ip', 'beam_angle'],
  '工作灯':     ['watts', 'voltage', 'cct', 'cri', 'ip'],
  '庭院灯':     ['watts', 'voltage', 'cct', 'ip', 'material'],
  'Highbay':    ['watts', 'voltage', 'cct', 'cri', 'ip', 'pf', 'beam_angle', 'luminous_efficacy'],
  '充电灯':     ['watts', 'cct', 'ip', 'material'],
  '应急灯':     ['watts', 'voltage', 'cct'],
  '灯带':       ['watts', 'voltage', 'cct', 'cri', 'ip'],
  '皮线灯':     ['watts', 'voltage', 'ip'],
};

// 只推断 AI 能做的参数，不推断 watts/size_display/ip（这些需要精确数据）
const AI_INFERABLE_PARAMS = ['voltage', 'cct', 'cri', 'pf', 'driver_type', 'material', 'beam_angle', 'base'] as const;
```

对每个产品，计算 `CATEGORY_REQUIRED_PARAMS[category] ∩ AI_INFERABLE_PARAMS` 中缺失的参数。
跳过 watts/size_display/ip/luminous_efficacy——这些不适合 AI 推断（需要具体测量值）。

---

## Part 2 — AI 推断

### API 调用

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
  timeout: 60_000,
});

const MODEL = "deepseek-v4-flash";
```

### 批处理策略

按品类分批，每批 30 个产品（控制 token 量）。

```typescript
for each category:
  collect products with missing AI-inferable required params
  split into batches of 30
  for each batch:
    build prompt with product context
    call DeepSeek
    parse response → save to cache file
    sleep 500ms between calls (rate limit)
```

### Prompt 设计

```typescript
function buildPrompt(category: string, products: ProductWithContext[]): string {
  return `你是照明行业规格参数专家。下面是 ${products.length} 个"${category}"产品，每个产品有型号、名称和已有参数。
请为每个产品推断缺失的参数值。

规则：
1. 只填你有把握的值。不确定就写 null。
2. voltage 格式：纯数字或范围，如 "220-240"、"100-240"、"48"、"12"。不带 V/AC 前缀。
3. cct 格式：纯数字或范围，如 "3000"、"6500"、"3000-6500"、"2700-6500"。不带 K 后缀。
4. cri 格式：纯数字，如 "80"、"90"。
5. pf 格式：小数，如 "0.5"、"0.9"。
6. driver_type 格式：中文，如 "隔离"、"非隔离"、"DOB"、"LC"、"恒流IC"。
7. material 格式：中文材料名，如 "铝+PC"、"铝压铸"、"玻璃"、"ABS"。
8. beam_angle 格式：纯数字（度），如 "120"、"60"、"15-60"。
9. base 格式：标准灯头型号，如 "E27"、"E14"、"GU10"、"G4"、"G9"。

${category} 品类背景：${getCategoryContext(category)}

产品列表（JSON）：
${JSON.stringify(products.map(p => ({
  id: p.id,
  model: p.model_no,
  name: p.product_name,
  existing: p.existingParams, // { voltage: "220-240", cri: "80", ... }
  missing: p.missingParams,   // ["cct", "driver_type"]
})), null, 2)}

请返回 JSON 数组，格式：
[
  { "id": "产品ID", "params": { "cct": "3000-6500", "driver_type": "非隔离" } },
  ...
]
只返回 JSON，不要解释。`;
}
```

### 品类背景知识

```typescript
function getCategoryContext(category: string): string {
  const contexts: Record<string, string> = {
    '筒灯': '嵌入式天花灯，常用于商业/家用。宽压 100-240V 或窄压 220-240V，CRI 通常 80，PF 0.5。驱动有隔离/非隔离/Lifud 等品牌驱动。',
    '面板灯': '方形/圆形平板灯，侧发光或直下式。宽压 165-265V 或 85-265V 为主。CRI 70-80，PF 0.5-0.9，驱动非隔离/DOB/恒流IC。材料常为铝+PMMA/PS。',
    '磁吸灯': '磁吸轨道灯系统，多为 48V 或 24V 低压 DC。CRI 90 为主。',
    '吸顶灯': '表面安装天花灯，家用为主。宽压 165-265V，CRI 80，PF 0.5。驱动非隔离为主。',
    '灯丝灯': '仿传统灯泡形态，LED 灯丝。220-240V，CRI 80，PF 0.5，驱动 LC。灯头 E27/E14 为主。',
    '风扇灯': '风扇+灯一体。宽压 110-265V，CRI 80。',
    '球泡': 'LED 球泡灯。宽压 100-240V 或窄压 220-240V。CRI 80，PF 0.5。灯头 E27/E14/B22。',
    '壁灯': '壁面安装装饰灯。220-240V 或 100-240V。CRI 80。驱动非隔离为主。材料铝/铁/亚克力。',
    '净化灯': '洁净室用平板灯。宽压 165-265V，CRI 70-80，PF 0.5。驱动非隔离/DOB。',
    '橱柜灯': '橱柜/衣柜内小型灯。12V 或 220-240V。CRI 80。',
    '镜前灯': '浴室镜子上方照明。220-240V，CRI 80。驱动隔离为主。',
    '轨道灯': '导轨射灯，商业照明。220-240V，CRI 80-90，PF 0.5。窄光束角 15-60°。',
    '防潮灯': '防水等级 IP65+，浴室/户外通道。220-240V，CRI 80，PF 0.5-0.9。驱动隔离为主。',
    '台灯': '桌面台灯。220-240V 或 USB 5V。CRI 80-90。',
    'G4G9': 'G4/G9 灯珠替换光源。220-240V 或 12V。CRI 80。灯头 G4/G9。',
    '灯管': 'T5/T8 灯管。220-240V，CRI 80，PF 0.5。',
    '线条灯': '长条形铝槽灯，嵌入/吊装/明装。220-240V 或 170-265V，CRI 80。',
    '投光灯': '泛光灯/射灯，户外照明。宽压 85-265V 或 220-240V。CRI 70-80，PF 0.9。材料铝压铸。光束角 120°为主。',
    '三防灯': '防水防尘防腐。220-240V 或 170-265V。CRI 80，PF 0.5-0.9。',
    '太阳能壁灯': '太阳能供电壁灯。无需市电 voltage。CCT 多为 6500 冷白。材料 ABS/PC。',
    '太阳能': '太阳能灯（路灯/庭院灯等）。无需市电 voltage。CCT 多为 6500。材料 ABS/铝。',
    '路灯': '道路照明。宽压 85-265V 或 100-240V。CRI 80，PF 0.9。光束角 60°-150°。',
    '地埋灯/地插灯': '地面嵌入式。12V 或 220-240V。CRI 80。窄光束角 15-60°。',
    '工作灯': '便携/临时照明。220-240V 或充电式。CRI 80。',
    '庭院灯': '庭院/花园装饰灯。220-240V 或太阳能。材料铝/不锈钢。',
    'Highbay': '工矿灯/高棚灯。宽压 100-277V 或 85-265V。CRI 80，PF 0.95+。光束角 60°/90°/120°。',
    '充电灯': '充电式便携灯。无需市电 voltage。材料 ABS/PC。',
    '应急灯': '应急照明。220-240V（带电池）。CRI 要求低。',
    '灯带': 'LED 灯条。12V 或 24V DC 为主。CRI 80。',
    '皮线灯': '装饰类灯串。220V 或 24V。',
  };
  return contexts[category] ?? '照明灯具。';
}
```

### 缓存机制

```typescript
// 缓存目录：data/deepseek-cache/
// 文件名：{category}-batch-{n}.json
// 内容：{ products: [...], response: [...], timestamp: "..." }
// --infer 模式跳过已有缓存文件（可重跑失败的批次）
```

---

## Part 3 — 验证 + 写入

从缓存文件读取 AI 响应，逐条验证后写入 DB。

### 验证规则

```typescript
const VALIDATORS: Record<string, (value: string) => boolean> = {
  voltage: (v) => /^\d{1,3}(-\d{1,3})?$/.test(v) && !['0', '1', '2'].includes(v),
  cct: (v) => /^\d{4}(-\d{4})?$/.test(v),
  cri: (v) => /^\d{2,3}$/.test(v) && Number(v) >= 60 && Number(v) <= 100,
  pf: (v) => /^0\.\d+$/.test(v) && Number(v) >= 0.3 && Number(v) <= 1.0,
  driver_type: (v) => v.length >= 1 && v.length <= 30,
  material: (v) => v.length >= 1 && v.length <= 50,
  beam_angle: (v) => /^\d{1,3}(-\d{1,3})?$/.test(v) && Number(v.split('-')[0]) >= 5 && Number(v.split('-')[0]) <= 360,
  base: (v) => /^[A-Za-z]\d/.test(v) && v.length <= 10,
};
```

### 写入

```typescript
// 对每条通过验证的推断：
// - 检查 existingParamKeys（不覆盖已有值）
// - source_field: "deepseek_inference"
// - confidence: "inferred"
// - raw_value: 带格式的值（如 "3000-6500K"、"AC220-240V"）
// - normalized_value: 纯值（如 "3000-6500"、"220-240"）
// - unit: 对应单位（"V"/"K" 等），或 null
```

---

## 限流 + 错误处理

```typescript
// DeepSeek 限流：每次调用后 sleep 500ms
// 单次调用失败：重试 2 次（指数退避 1s → 3s）
// 3 次失败后跳过该批次，记录在报告中
// 每 10 个批次打印进度
// JSON 解析失败：尝试 regex 提取 JSON 数组，再失败则跳过
```

---

## 报告：`docs/v13.0-deepseek-params-report.md`

```markdown
# V13.0 DeepSeek AI 参数推断报告

模式: dry-run / infer / apply
时间: ...
备份: prisma/dev.db.bak-v13.0
API 模型: deepseek-v4-flash

## Part 0 — 脏数据清理

| 删除类型 | 数量 |
|---|---:|
| 非法 voltage 值 | X |

## 缺口统计

| param_key | 缺失产品 | 适用品类数 |
|---|---:|---:|

## API 调用统计

| 指标 | 数值 |
|---|---:|
| 品类数 | X |
| 总批次 | X |
| 成功批次 | X |
| 失败批次 | X |
| 总推断条目 | X |
| 通过验证 | X |
| 验证失败 | X |
| 跳过(已有值) | X |
| 实际写入 | X |

## 按品类×参数写入明细

| category | param_key | 推断数 | 通过验证 | 写入 |
|---|---|---:|---:|---:|

## 验证失败采样（前 30 条）

| category | product_id | param_key | AI 返回值 | 失败原因 |

## 覆盖率变化（COUNT DISTINCT product_id）

| param_key | 之前 | 之后 | 变化 | 覆盖率 |
|---|---:|---:|---:|---:|

## 汇总

| 指标 | 数值 |
|---|---:|
| 新增 params | X |
| product_params 变化 | 前 → 后 |
```

---

## 环境要求

- `.env.local` 中 `DEEPSEEK_API_KEY=<redacted>`
- `openai` 包已在 package.json
- 需要网络连接

## Commit

```
V13.0: DeepSeek AI batch inference for missing required params (voltage/cct/material/driver_type/beam_angle/base)
```

## 不做什么

- 不推断 watts/size_display/ip/luminous_efficacy（需要精确测量值）
- 不覆盖已有参数值
- 不删产品/offers
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不把 AI 推断标记为 high confidence（统一用 "inferred"）
- 不在 dry-run 模式调用 API
