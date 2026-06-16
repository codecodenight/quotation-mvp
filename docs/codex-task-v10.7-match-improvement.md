# V10.7 — 回填产品匹配改进 + 重跑管线

## 目标

当前回填脚本 `scripts/v10.1-param-backfill.ts` 的产品匹配率只有 64.7%（5,914/9,138），3,224 行匹配失败。主要原因：

1. **多产品同分跳过**（如灯丝灯 C35/G45/A60 都匹配 "灯丝灯"）→ 无品类过滤
2. **搜索范围太窄** → 只搜文件关联产品，不搜全 DB 同品类产品
3. **短型号无法区分** → "C35" 匹配多个产品，但如果行里有 watts 列能帮忙缩窄

V10.7 改进这三个方面。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v10.7
```

**必须在 V10.6 之后运行**（V10.6 先补全 HEADER_TO_PARAM 映射）。

---

## 修改文件：`scripts/v10.1-param-backfill.ts`

### 改动 1：品类推断

新增函数 `inferCategoryFromFile()`，根据文件路径/文件夹名推断品类：

```typescript
function inferCategoryFromFile(filePath: string, fileName: string): string | null {
  const combined = `${filePath} ${fileName}`;
  // 从路径中提取品类关键词
  const categoryKeywords: Record<string, string> = {
    "面板灯": "面板灯",
    "筒灯": "筒灯",
    "投光灯": "投光灯",
    "线条灯": "线条灯",
    "三防灯": "三防灯",
    "灯丝灯": "灯丝灯",
    "灯带": "灯带",
    "轨道灯": "轨道灯",
    "磁吸灯": "磁吸灯",
    "净化灯": "净化灯",
    "天花灯": "天花灯",
    "工矿灯": "工矿灯",
    "球泡": "球泡灯",
    "蜡烛灯": "蜡烛灯",
    "灯管": "灯管",
    "皮线灯": "皮线灯",
    "太阳能": "太阳能灯",
    "路灯": "路灯",
    "庭院灯": "庭院灯",
    "壁灯": "壁灯",
  };
  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (combined.includes(keyword)) return category;
  }
  return null;
}
```

### 改动 2：品类过滤 tiebreaker

修改 `chooseLongestUnique()` 或 `matchProduct()`：当多个产品同分时，用品类过滤缩窄：

```typescript
// 在 matchProduct 中，当 candidates.length > 1 且有品类信息时
const fileCategory = inferCategoryFromFile(file.relativePath, file.fileName);
if (fileCategory && candidates.length > 1) {
  const sameCat = candidates.filter(p => p.category === fileCategory);
  if (sameCat.length === 1) return sameCat[0];
  if (sameCat.length > 1) candidates = sameCat; // 缩窄后继续其他 tiebreaker
}
```

### 改动 3：放宽搜索——全 DB 同品类回退

修改 `loadSourceFiles()`：对每个文件，除了加载关联产品，额外加载同品类的所有产品作为回退池。

```typescript
// 在 loadSourceFiles 中，为每个文件增加 fallbackProducts
// 当文件关联产品中找不到匹配时，尝试从 fallbackProducts 中找

// 新增查询：加载该品类下所有产品（不限于文件关联）
const fileCategory = inferCategoryFromFile(file.relativePath, file.fileName);
if (fileCategory) {
  const categoryProducts = await prisma.$queryRaw<...>`
    SELECT id, model_no, product_name, category
    FROM products
    WHERE category = ${fileCategory}
  `;
  file.fallbackProducts = categoryProducts;
}
```

在 `processSheet()` 的产品匹配逻辑中：

```typescript
let product = matchProduct(modelValue, file.products);
if (!product && file.fallbackProducts) {
  product = matchProduct(modelValue, file.fallbackProducts);
}
```

### 改动 4：短型号 + watts 联合匹配

当 model 值很短（≤ 4 字符，如 "C35", "G45", "A60"）且有多个候选时，检查同行的 watts 列值辅助消歧：

```typescript
// 在 matchProduct 失败或多匹配时
if (modelValue.length <= 4 && candidates.length > 1) {
  // 从当前行提取 watts（如果有 watts 列）
  const rowWatts = extractWattsFromRow(row, headerParams);
  if (rowWatts) {
    // 查找 product_name 中包含该 watts 值的候选
    const withWatts = candidates.filter(p =>
      p.product_name.includes(`${rowWatts}W`) || p.model_no?.includes(`${rowWatts}W`)
    );
    if (withWatts.length === 1) return withWatts[0];
  }
}
```

### 改动 5：matchParamKey 2字符修复

当前 `matchParamKey()` 对长度 ≤ 2 的 HEADER_TO_PARAM key 跳过子串匹配。修复：

```typescript
// 原代码（约 line 1130）：
// if (label.length <= 2) continue;  // 跳过太短的 key

// 改为：对所有 key 都尝试子串匹配，但要求短 key 是完整词匹配
// 即 "显指" 必须完整出现在 label 中（不能只匹配 "显"）
if (key.length <= 2) {
  // 短 key：要求精确出现（不是更长词的一部分）
  if (label === key) return paramKey;
  continue;
}
```

---

## 报告：`docs/v10.7-match-improvement-report.md`

```markdown
# V10.7 回填匹配改进报告

模式: dry-run / apply
时间: ...

## 匹配率变化

| 指标 | 改进前 | 改进后 | 变化 |
|---|---:|---:|---:|
| 总数据行 | 9,138 | X | |
| 匹配成功 | 5,914 | X | +X |
| 匹配率 | 64.7% | X% | +X% |
| 多产品同分跳过 | X | X | -X |
| 无匹配 | X | X | -X |

## 新增参数

| 指标 | 数值 |
|---|---:|
| 新增参数 | X |
| 跳过（已存在） | X |
| product_params 变化 | 前 → 后 |

## 按改进来源统计

| 改进手段 | 新增匹配行 | 新增参数 |
|---|---:|---:|
| 品类过滤消歧 | X | X |
| 全 DB 回退匹配 | X | X |
| 短型号+watts 联合 | X | X |
| 2字符 key 修复 | X | X |

## 按品类统计

| 品类 | 改进前匹配 | 改进后匹配 | 新增参数 |

## 仍无法匹配的前 50 行采样

| 文件 | Sheet | 行号 | 模型值 | 失败原因 |
```

---

## 重跑管线

```bash
npx tsx scripts/v10.1-param-backfill.ts --apply
npx tsx scripts/v10.4-derive-params.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

---

## Commit

```
V10.7: improve backfill product matching with category filtering and DB-wide fallback

- Category-aware tiebreaker for multiple-match disambiguation
- DB-wide same-category fallback when file-linked products miss
- Short model + watts combination matching for codes like C35/G45/A60
- Fix 2-char key skip in matchParamKey substring matching
- Re-run backfill, derive, and audit
```

## 不做什么

- 不新建脚本（只改 v10.1-param-backfill.ts）
- 不改 Prisma schema
- 不改前端
- 不删除现有产品或参数
- 不改 V10.3 导入脚本
- 不改 V10.6 列头提取脚本
