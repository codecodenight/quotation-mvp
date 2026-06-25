# V19.0: Chat 搜索工具参数扩展

## Goal

让 Chat 的 `search_products` 和 `compare_factories` 工具能按 product_params 里的结构化参数检索产品。当前只有 query/category/watts/factory 四个维度，用户说"帮我找 220V DOB 的 IP65 投光灯"时无法精确匹配。

## Context

- `product_params` 表有 95,475 条记录，覆盖 47 种 param_key
- 高频参数覆盖率：cct 10,883 / cri 9,835 / voltage 9,503 / pf 6,829 / ip 5,972 / material 4,678 / driver_type 4,340 / beam_angle 1,955 / luminous_efficacy 2,757
- `normalizedValue` 字段已标准化（voltage 去 AC/DC/V，CRI 去 Ra，IP 去前缀）
- Quotes 页面已有 `buildParamFilter()` 使用 OR 逻辑：匹配值 OR 缺失该参数的产品（避免数据不完整时丢产品）

## Changes

### A. 扩展 `search_products` 工具定义

文件：`src/lib/chat-tools.ts`

在 `CHAT_TOOL_DEFINITIONS` 的 `search_products` function parameters.properties 中新增：

```typescript
voltage: { type: "string", description: "电压，例如 220、110、12、24" },
cct: { type: "string", description: "色温，例如 3000、4000、6500" },
ip: { type: "string", description: "防护等级，例如 20、44、65、67" },
material: { type: "string", description: "材质，例如 铝、铁、PC、ABS" },
driver_type: { type: "string", description: "驱动类型，例如 DOB、Linear、隔离、非隔离" },
cri: { type: "string", description: "显色指数，例如 80、90" },
pf: { type: "string", description: "功率因数，例如 0.5、0.9" },
beam_angle: { type: "string", description: "光束角，例如 120、60" },
min_efficacy: { type: "number", description: "光效下限 lm/W" },
max_efficacy: { type: "number", description: "光效上限 lm/W" },
```

### B. 实现 `searchProducts` 参数过滤

文件：`src/lib/chat-tools.ts`

在 `searchProducts()` 函数中：

1. 读取新参数：
```typescript
const voltage = normalizeToolText(args.voltage);
const cct = normalizeToolText(args.cct);
const ip = normalizeToolText(args.ip);
const material = normalizeToolText(args.material);
const driverType = normalizeToolText(args.driver_type);
const cri = normalizeToolText(args.cri);
const pf = normalizeToolText(args.pf);
const beamAngle = normalizeToolText(args.beam_angle);
const minEfficacy = parseToolNumber(args.min_efficacy);
const maxEfficacy = parseToolNumber(args.max_efficacy);
```

2. 查询 efficacy 的 product IDs（复用 `getWattsProductIds` 的模式）：
```typescript
const efficacyProductIds = await getParamRangeProductIds("luminous_efficacy", minEfficacy, maxEfficacy);
```

新增一个通用 `getParamRangeProductIds(paramKey, min, max)` 函数，逻辑同现有 `getWattsProductIds` 但 paramKey 参数化。然后把 `getWattsProductIds` 改为调用它。

3. 把精确匹配参数传入 `buildProductWhere`：
```typescript
const paramFilters = { voltage, cct, ip, material, driver_type: driverType, cri, pf, beam_angle: beamAngle };
```

### C. 扩展 `buildProductWhere`

文件：`src/lib/chat-tools.ts`

给 `buildProductWhere` 的参数对象加上 `paramFilters` 和 `extraProductIds`（efficacy 筛选后的 IDs）。

对每个非空 paramFilter，加一个 AND 条件，使用 OR 逻辑（同 quotes 页面的 `buildParamFilter`）：

```typescript
// 对每个 paramFilter entry：
{
  OR: [
    { params: { some: { paramKey, normalizedValue: filterValue } } },
    { params: { none: { paramKey, normalizedValue: { not: null } } } },
  ]
}
```

对 `extraProductIds`（efficacy）：如果不为 null，加 `{ id: { in: extraProductIds } }`。注意和 watts 的 productIds 要取交集（两者都不为 null 时取共同的 IDs）。

### D. 扩展 `compare_factories` 工具定义和实现

文件：`src/lib/chat-tools.ts`

给 `compare_factories` 加参数：`voltage`, `ip`, `driver_type`, `material`（够用了，不需要全部）。

在 `compareFactories()` 函数中读取这些参数并传给 `buildProductWhere`。

### E. 验证

1. `npx tsc --noEmit` — 0 errors
2. `npx vitest run` — all pass
3. 启动 dev server，在 Chat 中测试：
   - "帮我找 220V DOB 的投光灯" → 应返回有 voltage=220 + driver_type=DOB 的投光灯
   - "IP65 50W 路灯" → 应返回匹配产品
   - "90lm/W 以上的工矿灯" → 应用 min_efficacy=90 + category=Highbay
4. 确认现有搜索不受影响（不传新参数时行为不变）

### F. 写报告

写到 `docs/v19.0-chat-param-search-report.md`：
- 新增了哪些工具参数
- 搜索测试结果（至少 3 个 Chat 对话截取）
- tsc / vitest 结果
