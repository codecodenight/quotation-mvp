# V32: 功率即型号产品降权

## 背景
数据库中约 352 个产品的 `model_no` 为纯功率值（如 `"10W"`, `"36W"`, `"0.5W"`），没有真正型号。这些产品信息量低，但在搜索结果中与正常产品混排，影响 Chat 搜索质量。

## 目标
Chat 搜索结果中，纯功率型号的产品排在正常型号产品之后。不隐藏，只降权。

## 判定规则
`model_no` 匹配以下模式的视为"纯功率型号"：
- 纯数字 + W，如 `"10W"`, `"36W"`, `"100W"`
- 允许小数，如 `"0.5W"`, `"6.5W"`
- 大小写不敏感：`"36w"` 也算
- 正则：`/^\d+(\.\d+)?[wW]$/`

## 实现

### 1. 在 `src/lib/chat-tools.ts` 中新增判定函数

```typescript
function isWattageOnlyModel(modelNo: string | null): boolean {
  if (!modelNo) return true;
  return /^\d+(\.\d+)?[wW]$/.test(modelNo.trim());
}
```

### 2. 修改 `searchProducts` 函数的结果排序

当前代码（约第 265 行）：
```typescript
return {
  total,
  products: products.map(serializeProductCard),
};
```

改为：先 map 再排序，把纯功率型号排到最后：
```typescript
const cards = products.map(serializeProductCard);
cards.sort((a, b) => {
  const aWattOnly = isWattageOnlyModel(a.model_no);
  const bWattOnly = isWattageOnlyModel(b.model_no);
  if (aWattOnly !== bWattOnly) return aWattOnly ? 1 : -1;
  return 0;
});
return { total, products: cards };
```

这是稳定排序，同组内保持 Prisma 原始排序。

### 3. `compareFactories` 也需要同样处理

找到 `compareFactories` 函数中构造 `sample_product` 的地方。如果 sample 选了纯功率型号的产品，应优先选一个有正常型号的产品作为 sample。

具体：在选 sample 时，优先取 `model_no` 不匹配纯功率模式的 offer 对应产品。如果全部都是纯功率型号，则保持现有逻辑。

### 4. 添加测试

在 `src/lib/chat-tools.test.ts`（如已有）或新建测试文件，添加：

```typescript
import { describe, it, expect } from "vitest";

// 如果 isWattageOnlyModel 是 export 的：
// import { isWattageOnlyModel } from "./chat-tools";
// 否则内联测试逻辑

describe("isWattageOnlyModel", () => {
  it("detects pure wattage models", () => {
    expect(isWattageOnlyModel("10W")).toBe(true);
    expect(isWattageOnlyModel("36w")).toBe(true);
    expect(isWattageOnlyModel("0.5W")).toBe(true);
    expect(isWattageOnlyModel("100W")).toBe(true);
    expect(isWattageOnlyModel(null)).toBe(true);
  });

  it("passes real model numbers", () => {
    expect(isWattageOnlyModel("JJL-T5210")).toBe(false);
    expect(isWattageOnlyModel("YB05-120-圆形")).toBe(false);
    expect(isWattageOnlyModel("W-JD01-10")).toBe(false);
    expect(isWattageOnlyModel("ON-SPDS10")).toBe(false);
    expect(isWattageOnlyModel("3W筒灯")).toBe(false);
  });
});
```

为了测试能 import，把 `isWattageOnlyModel` 加 `export`。

### 5. 验证

```bash
npx vitest run src/lib/chat-tools.test.ts
npx next build
```

两个都通过即可。

## 不做
- 不删除任何产品
- 不改 Prisma 查询的 WHERE 条件（不过滤，只排序）
- 不改 DeepSeek prompt
- 不改 UI
