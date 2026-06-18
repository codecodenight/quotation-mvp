# V13.4 — CCT 工厂/品类安全传播

目标：继续提升核心参数完成率。V13.3 后最大缺口是 CCT（约 4,566 个核心缺口），且大量产品只差 CCT 一个参数即可完成。用保守的同工厂 + 同品类主导值规则填充缺失 CCT。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.4
```

## 新建文件

`scripts/v13.4-cct-safe-propagation.ts`

```bash
npx tsx scripts/v13.4-cct-safe-propagation.ts
npx tsx scripts/v13.4-cct-safe-propagation.ts --apply
```

## 规则

只新增 `product_params`，不覆盖已有参数。

对每个缺 CCT 的产品：

1. 取产品的主工厂：
   - `supplier_offers` 按 `created_at ASC` 的第一条 `factory_name`
2. 找同 `factory_name + category` 下已有 CCT 参数的产品分布。
3. 满足以下全部条件才填充：
   - 样本产品数 `>= 10`
   - 主导 CCT 值占比 `>= 90%`
   - 主导 CCT 值必须是合法 CCT：
     - 单值：`2700` / `3000` / `4000` / `5000` / `6000` / `6500` 等，范围 1800-10000
     - 范围：`2700-6500` / `3000-6500` 等，首尾均在 1800-10000
   - 当前产品没有非空 CCT 参数

插入格式：

```typescript
{
  param_key: "cct",
  raw_value: dominantValue.includes("-") ? `${dominantValue}K` : `${dominantValue}K`,
  normalized_value: dominantValue,
  unit: "K",
  source_field: "factory_category_default",
  confidence: "low"
}
```

## Dry-run 报告

写入 `docs/v13.4-cct-safe-propagation-report.md`

报告包含：

```markdown
# V13.4 CCT 安全传播报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.4

## 汇总

| 指标 | 数量 |
|---|---:|
| 缺 CCT 产品 | X |
| 有工厂+品类参考分布 | X |
| 达到阈值可填充 | X |
| 跳过：样本不足 | X |
| 跳过：主导占比不足 | X |
| 跳过：值不合法 | X |
| 实际新增 | X |

## 填充规则明细

| category | factory | 主导 CCT | 样本数 | 占比 | 新增 |
|---|---|---:|---:|---:|---:|

## 按品类新增

| category | 新增 CCT |
|---|---:|

## 采样（前 30 条）

| category | factory | model | 填充值 | 依据 |
|---|---|---|---|---|

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| CCT 覆盖率(需覆盖) | X% | X% |
| 核心参数全部完成产品 | X | X |
| 全局完成率 | X% | X% |
| product_params | X | X |
```

## 验证

```bash
npx tsc --noEmit --pretty false
```

## Commit

```bash
V13.4: safe CCT propagation by factory/category dominant values
```

## 不做什么

- 不调用 DeepSeek/API
- 不覆盖已有 CCT
- 不删除产品/offers/params
- 不改 schema / 前端
- 不修改源 Excel 文件
