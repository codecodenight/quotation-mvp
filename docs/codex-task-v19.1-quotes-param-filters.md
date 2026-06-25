# V19.1: Quotes 页面参数筛选扩展

## Goal

给报价中心 `/quotes` 页面添加更多参数筛选器（driver_type、cri、pf、beam_angle、光效范围），让 UI 搜索能力与 V19.0 的 Chat 工具对齐。

## Context

- 当前 Quotes UI 筛选器：search, category, factory, watts range, ip, cct, voltage, material, sort — 共 9 个
- 本次新增 6 个：driver_type, cri, pf, beam_angle (下拉), min/max efficacy (范围输入)
- V19.0 已在 Chat 侧实现了 `getParamRangeProductIds` 通用函数，本任务复用
- 现有模式：`product-filters.ts` 提供 `getParamOptions()` → `page.tsx` 调用 → `quotes-client.tsx` 渲染下拉
- 筛选器已经占两行，再加一行会拥挤。新筛选器放在可折叠的"更多筛选"区域

## Changes

### A. `src/lib/product-filters.ts` — 新增 option 查询函数

新增 4 个函数，全部调用已有的 `getParamOptions()` 私有函数：

```typescript
export async function getDriverTypeOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("driver_type");
}

export async function getCriOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("cri");
}

export async function getPfOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("pf");
}

export async function getBeamAngleOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("beam_angle");
}
```

新增光效范围查询。如果 V19.0 已在 `chat-tools.ts` 中写了 `getParamRangeProductIds`，把它移到 `product-filters.ts` 导出（chat-tools.ts 和 page.tsx 都 import 它）。如果 V19.0 没有抽出来，在 `product-filters.ts` 新增：

```typescript
export async function getProductIdsByParamRange(
  paramKey: string,
  minValue: string,
  maxValue: string,
): Promise<string[] | null> {
  const min = parseOptionalNonNegativeDecimal(minValue);
  const max = parseOptionalNonNegativeDecimal(maxValue);
  if (min === null && max === null) return null;

  let sql = `SELECT DISTINCT product_id FROM product_params WHERE param_key = ?`;
  const params: (string | number)[] = [paramKey];
  if (min !== null) {
    sql += " AND CAST(normalized_value AS REAL) >= ?";
    params.push(min);
  }
  if (max !== null) {
    sql += " AND CAST(normalized_value AS REAL) <= ?";
    params.push(max);
  }

  const rows = await prisma.$queryRawUnsafe<{ product_id: string }[]>(sql, ...params);
  return rows.map((row) => row.product_id);
}
```

### B. `src/app/(admin)/quotes/page.tsx` — 扩展服务端逻辑

1. **searchParams** 类型新增：`driverType`, `cri`, `pf`, `beamAngle`, `minEfficacy`, `maxEfficacy`

2. **filters** 对象新增对应字段（读取 + trim）

3. **shouldLoadProducts** 条件数组追加新字段

4. **并行查询** 新增 `getDriverTypeOptions()`, `getCriOptions()`, `getPfOptions()`, `getBeamAngleOptions()`, `getProductIdsByParamRange("luminous_efficacy", ...)` 到现有 `Promise.all`

5. **buildProductWhere** 新增参数过滤：
   - `driverType`, `cri`, `pf`, `beamAngle` → 调用 `buildParamFilter(paramKey, value)`
   - efficacy product IDs → 和 watts product IDs 取交集（两者都有时用 `Set` intersection，只有一个时直接用那个）

6. 新的 option 数组传给 `QuotesClient`

### C. `src/app/(admin)/quotes/quotes-client.tsx` — 扩展客户端 UI

1. **QuoteFilters** 类型新增：`driverType`, `cri`, `pf`, `beamAngle`, `minEfficacy`, `maxEfficacy`

2. **QuotesClientProps** 新增 option 数组 props：`driverTypeOptions`, `criOptions`, `pfOptions`, `beamAngleOptions`

3. **筛选器 UI**：在现有两行筛选器下方，新增一个可折叠区域：

```tsx
{/* 在第二行 grid 下方、</form> 上方 */}
<details className="mt-2">
  <summary className="cursor-pointer text-sm text-muted hover:text-ink">
    更多筛选
  </summary>
  <div className="mt-2 grid gap-3 md:grid-cols-4 xl:grid-cols-6">
    <Field label="驱动类型">
      <select name="driverType" defaultValue={filters.driverType} className={selectClass}>
        <option value="">不限</option>
        {driverTypeOptions.map(...)}
      </select>
    </Field>
    <Field label="显色指数">
      <select name="cri" defaultValue={filters.cri} className={selectClass}>
        <option value="">不限</option>
        {criOptions.map(...)}
      </select>
    </Field>
    <Field label="功率因数">
      <select name="pf" defaultValue={filters.pf} className={selectClass}>
        <option value="">不限</option>
        {pfOptions.map(...)}
      </select>
    </Field>
    <Field label="光束角">
      <select name="beamAngle" defaultValue={filters.beamAngle} className={selectClass}>
        <option value="">不限</option>
        {beamAngleOptions.map(...)}
      </select>
    </Field>
    <Field label="最小光效">
      <input name="minEfficacy" defaultValue={filters.minEfficacy} placeholder="90" className={inputClass} />
    </Field>
    <Field label="最大光效">
      <input name="maxEfficacy" defaultValue={filters.maxEfficacy} placeholder="150" className={inputClass} />
    </Field>
  </div>
</details>
```

当任何"更多筛选"字段有值时，`<details>` 应默认展开（加 `open` attribute）。

### D. 验证

1. `npx tsc --noEmit` — 0 errors
2. `npx vitest run` — all pass
3. 启动 dev server，测试 `/quotes` 页面：
   - 选择 driver_type=DOB → 确认结果筛选正确
   - 选择 cri=80 → 确认结果包含 CRI=80 产品 + 无 CRI 记录的产品
   - 输入 minEfficacy=90 → 确认结果正确
   - 同时设置多个新筛选器 → 确认 AND 交集逻辑正确
   - 不设置任何新筛选器 → 确认现有行为不受影响
4. 确认"更多筛选"折叠/展开正常，有值时默认展开

### E. 写报告

写到 `docs/v19.1-quotes-param-filters-report.md`：
- 新增了哪些筛选器
- 各筛选器 option 数量
- tsc / vitest 结果
- 截图或 HTML 描述展示 UI 布局
