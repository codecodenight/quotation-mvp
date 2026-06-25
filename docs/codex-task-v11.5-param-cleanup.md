# V11.5 — V11.1 反向匹配脏数据清理

## 背景

V11.1 反向匹配回填写入了 6,358 条参数，其中 169 条是脏数据（2.7%）。根因：某些 Excel 文件的"色温"/"光效"列头正确，但实际列内容是价格或颜色名，导致 `findParamColumns` 按列头映射后写入了错误值。

三类脏数据：

| 类别 | 条件 | 数量 |
|---|---|---:|
| 价格当参数 | raw_value 以 `￥` / `¥` / `US$` 开头 | 120 |
| 颜色名当 CCT | param_key='cct' 且 raw_value 是颜色 | 42 |
| 加价当 CCT | param_key='cct' 且 raw_value 以 `加` 开头含 `元` | 7 |

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v11.5
```

## 新建文件：`scripts/v11.5-param-cleanup.ts`

```bash
npx tsx scripts/v11.5-param-cleanup.ts              # dry-run
npx tsx scripts/v11.5-param-cleanup.ts --apply       # 删除
```

### 算法

#### 1. 识别脏数据

```typescript
async function findBadParams(): Promise<BadParam[]> {
  return prisma.$queryRaw<BadParam[]>`
    SELECT pp.id, pp.product_id, pp.param_key, pp.raw_value, pp.normalized_value,
           p.model_no, p.category
    FROM product_params pp
    JOIN products p ON p.id = pp.product_id
    WHERE pp.source_field = 'reverse_match'
    AND (
      -- 价格当参数：任何 param_key
      pp.raw_value LIKE '￥%'
      OR pp.raw_value LIKE '¥%'
      OR pp.raw_value LIKE 'US$%'
      OR pp.raw_value LIKE 'US $%'
      -- 颜色名当 CCT
      OR (pp.param_key = 'cct' AND pp.raw_value IN (
        'Red','Green','Bule','Blue','Flag Color','RGB+W/C','RGBW',
        'RGB','任意','单色','CCT','白光','暖光','冷光'
      ))
      -- 加价当 CCT
      OR (pp.param_key = 'cct' AND pp.raw_value LIKE '加%元')
      -- CCT 值不合理：normalized_value < 1000（排除正常 CCT range 格式）
      OR (pp.param_key = 'cct' 
          AND pp.normalized_value IS NOT NULL
          AND pp.normalized_value NOT LIKE '%-%'
          AND CAST(pp.normalized_value AS REAL) > 0
          AND CAST(pp.normalized_value AS REAL) < 1000)
    )
  `;
}
```

#### 2. 删除

```typescript
if (APPLY_MODE) {
  const ids = badParams.map(p => p.id);
  // 分批删除，每批 500
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await prisma.productParam.deleteMany({ where: { id: { in: chunk } } });
  }
}
```

### 报告：`docs/v11.5-param-cleanup-report.md`

```markdown
# V11.5 参数清理报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 检测到脏数据 | X |
| 删除 | X |
| product_params 变化 | 前 → 后 |

## 按脏数据类型

| 类型 | param_key | 数量 | 示例 raw_value |

## 删除采样（全部，≤200）

| param_key | raw_value | normalized_value | model_no | category |
```

## Commit

```
V11.5: clean 169 contaminated reverse_match params (prices/colors as CCT)
```

## 重跑管线

```bash
npx tsx scripts/v11.5-param-cleanup.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不改现有脚本
- 不删产品
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
