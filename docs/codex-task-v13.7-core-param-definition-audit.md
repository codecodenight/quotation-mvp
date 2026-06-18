# V13.7 — 核心参数定义审计（只读）

目标：审计现有 `CATEGORY_CORE_PARAMS` 是否过严或不符合业务。此任务**只读**，不修改 DB、不修改前端、不修改核心参数定义。产出供用户确认的建议清单。

背景：V13.4-V13.6 会继续补数据，但完成率不能只靠填值。部分品类的核心参数可能定义不合理，例如：

- 某些低压/装饰灯是否必须 CRI/PF？
- 某些太阳能小品是否必须 material？
- 部分灯管/灯带是否应强制 IP？
- `driver_type` 是否所有品类都必须要求？

这些属于业务口径，不应自动 apply。

## 新建文件

`scripts/v13.7-core-param-definition-audit.ts`

```bash
npx tsx scripts/v13.7-core-param-definition-audit.ts
```

## 输入

使用当前 V4.4C / V13.x 的 `CATEGORY_CORE_PARAMS` 定义。

读取：

- `products`
- `product_params`
- `supplier_offers`
- `files`

## 审计维度

### 1. 长期低覆盖参数

对每个 `category + param_key` 计算：

- 产品数
- 覆盖数
- 覆盖率
- 是否经过多轮提取后仍低于 30%

低覆盖不等于应删除，但需要标记。

### 2. 缺口可解释性

对低覆盖参数抽样 20 个缺失产品，查看：

- product_name
- model_no
- remark
- size
- source file path

判断缺失是否因为：

- 源数据确实没有
- 参数对该品类不适用
- 仍可从源文件/remark 提取
- 应通过默认值填充

### 3. 对完成率影响

模拟“如果移除某个 category + param_key 要求”，完成率会提升多少。

输出：

| category | param_key | 当前缺口 | 当前完成率 | 移除后完成率 | 全局完成率提升 |

### 4. 风险分级

给每个建议一个风险等级：

- `safe-to-remove?`：很可能不应作为核心参数
- `needs-user-decision`：业务上可能重要，需要用户决定
- `keep-required`：应继续作为核心参数
- `data-gap-not-definition-gap`：定义合理，应该继续补数据

注意：脚本只给建议，不自动修改。

## 报告

写入 `docs/v13.7-core-param-definition-audit.md`

```markdown
# V13.7 核心参数定义审计

模式: read-only
时间: ...

## 当前全局完成率

| 指标 | 数值 |
|---|---:|
| 核心参数覆盖范围产品 | X |
| 全部完成产品 | X |
| 完成率 | X% |

## 低覆盖参数清单

| category | param_key | 产品数 | 覆盖数 | 覆盖率 | 缺口 | 初步判断 |
|---|---|---:|---:|---:|---:|---|

## 移除单项要求的模拟影响

| category | param_key | 当前完成产品 | 模拟完成产品 | 新增完成 | 全局完成率提升 |
|---|---|---:|---:|---:|---:|

## 建议清单

### safe-to-remove?

| category | param_key | 理由 | 影响 |
|---|---|---|---|

### needs-user-decision

| category | param_key | 需要用户判断的问题 | 影响 |
|---|---|---|---|

### data-gap-not-definition-gap

| category | param_key | 下一步补数据建议 |
|---|---|---|

## 缺失样本附录

### [category] / [param_key]

| model | product_name | remark sample | source file |
|---|---|---|---|
```

## 验证

```bash
npx tsc --noEmit --pretty false
```

## Commit

```bash
V13.7: read-only audit of core parameter definitions and completion-rate impact
```

## 不做什么

- 不备份 DB（只读任务）
- 不写 DB
- 不修改 `src/lib/data-quality.ts`
- 不修改任何 V4.4C / V13.x 核心参数定义
- 不修改源 Excel 文件
