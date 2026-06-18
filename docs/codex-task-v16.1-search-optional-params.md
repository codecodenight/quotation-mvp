# V16.1 — 搜索逻辑：缺失参数不排除产品

当前搜索逻辑：用户选了 CCT=4000K → 只返回 params 中有 cct=4000K 的产品。缺 CCT 的产品被完全排除。

改为：用户选了 CCT=4000K → 返回 cct=4000K 的产品 **+ 没有 CCT 记录的产品**。有 CCT 但值不匹配的产品仍然排除。

这样所有参数缺失的产品仍可被其他条件搜到，搜索覆盖率 = 100%。

**依赖：V15.0 已完成。可与 V16.0 并行。**

## 改动范围

只改两个文件：
1. `src/app/(admin)/quotes/page.tsx` — `buildProductWhere` 函数
2. `src/lib/product-filters.ts` — 新增 `getVoltageOptions` 函数（可选，如果要加 voltage 筛选器）

**不改** `quotes-client.tsx`（前端组件），不加新筛选器 UI，只改后端查询逻辑。

---

## Part A — 修改 buildProductWhere

文件：`src/app/(admin)/quotes/page.tsx`

当前 IP 和 CCT 筛选逻辑（约第 210-230 行）：

```typescript
// 当前：严格匹配，排除缺值产品
if (filters.ip) {
  and.push({
    params: {
      some: {
        paramKey: "ip",
        normalizedValue: filters.ip,
      },
    },
  });
}

if (filters.cct) {
  and.push({
    params: {
      some: {
        paramKey: "cct",
        normalizedValue: filters.cct,
      },
    },
  });
}
```

改为：

```typescript
// 新：匹配值 OR 缺失该参数的产品
if (filters.ip) {
  and.push({
    OR: [
      {
        params: {
          some: {
            paramKey: "ip",
            normalizedValue: filters.ip,
          },
        },
      },
      {
        params: {
          none: {
            paramKey: "ip",
            normalizedValue: { not: null },
          },
        },
      },
    ],
  });
}

if (filters.cct) {
  and.push({
    OR: [
      {
        params: {
          some: {
            paramKey: "cct",
            normalizedValue: filters.cct,
          },
        },
      },
      {
        params: {
          none: {
            paramKey: "cct",
            normalizedValue: { not: null },
          },
        },
      },
    ],
  });
}
```

逻辑说明：
- `some: { paramKey: "cct", normalizedValue: filters.cct }` → 有 CCT 且值匹配
- `none: { paramKey: "cct", normalizedValue: { not: null } }` → 没有任何有效 CCT 记录
- 两者 OR → 匹配的 + 缺失的都返回，只排除"有 CCT 但值不对"的

### 注意 `normalizedValue: { not: null }` 

这里不能用 `none: { paramKey: "cct" }`，因为可能存在 `normalizedValue = null` 或空字符串的无效记录。必须用 `normalizedValue: { not: null }` 来确保只算有效值的记录。

再加一层保护：排除空字符串。但 Prisma 的 `not: null` 已经排除 null，空字符串需要额外处理。

实际上看数据，normalizedValue 已经都是有效的（V13.x 系列都确保了）。用 `none: { paramKey: "cct", normalizedValue: { not: null } }` 足够。如果担心空字符串，可以改为：

```typescript
none: {
  paramKey: "cct",
  NOT: [
    { normalizedValue: null },
    { normalizedValue: "" },
  ],
},
```

但这可能过于复杂。**保持简单，用 `normalizedValue: { not: null }` 即可。**

---

## Part B — 提取公共函数

为避免 IP 和 CCT 的 OR 逻辑重复，提取一个辅助函数：

```typescript
function buildParamFilter(paramKey: string, filterValue: string): Prisma.ProductWhereInput {
  return {
    OR: [
      {
        params: {
          some: {
            paramKey,
            normalizedValue: filterValue,
          },
        },
      },
      {
        params: {
          none: {
            paramKey,
            normalizedValue: { not: null },
          },
        },
      },
    ],
  };
}
```

然后 buildProductWhere 中：

```typescript
if (filters.ip) {
  and.push(buildParamFilter("ip", filters.ip));
}
if (filters.cct) {
  and.push(buildParamFilter("cct", filters.cct));
}
```

---

## Commit

```
V16.1: search includes products with missing params instead of excluding them
```

## 不做什么

- 不改前端组件 / UI 布局
- 不加新的筛选器
- 不改 product-filters.ts（除非需要新的 option 函数）
- 不改数据库 / 脚本
- 不修改源 Excel 文件
