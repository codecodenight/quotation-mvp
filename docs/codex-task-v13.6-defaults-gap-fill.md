# V13.6 — PF / driver_type / material 默认值补全

目标：继续提升核心参数完成率，处理 PF、driver_type、material 等可通过工厂/品类分布安全传播的缺口。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.6
```

## 新建文件

`scripts/v13.6-defaults-gap-fill.ts`

```bash
npx tsx scripts/v13.6-defaults-gap-fill.ts
npx tsx scripts/v13.6-defaults-gap-fill.ts --apply
```

## 通用传播规则

对目标参数：

- 当前产品没有该参数的非空 `normalized_value`
- 同 `factory_name + category` 下已有该参数样本数 `>= 10`
- 主导值占比 `>= 90%`
- 插入：
  - source_field = `factory_category_default`
  - confidence = `low`
- 不覆盖已有值

## Part A — PF 工厂/品类传播

目标参数：`pf`

适用品类：

```typescript
["面板灯", "三防灯", "防潮灯", "投光灯", "路灯", "筒灯", "吸顶灯", "净化灯", "轨道灯", "灯管", "球泡", "灯丝灯", "Highbay"]
```

合法值规则：

- `0.5`
- `0.6`
- `0.9`
- `0.95`
- `>=0.5` 归一为 `0.5`
- `>=0.9` 归一为 `0.9`
- `>=0.95` 归一为 `0.95`

## Part B — driver_type 工厂/品类传播

目标参数：`driver_type`

适用品类：

```typescript
["筒灯", "面板灯", "吸顶灯", "净化灯", "防潮灯", "壁灯", "镜前灯"]
```

合法值：

- `DOB`
- `非隔离`
- `隔离`
- `IC`
- `恒流`

如果主导值包含明显冲突（如同一工厂下 DOB 与 隔离 各占较大比例），跳过。

## Part C — material 工厂/品类传播

目标参数：`material`

适用品类：

```typescript
["面板灯", "壁灯", "太阳能", "太阳能壁灯", "庭院灯", "投光灯", "充电灯"]
```

合法值规则：

- 非空
- 长度 <= 80
- 不含价格、MOQ、CTN、尺寸、功率、色温等明显非材质信息
- 主导值占比 `>= 90%`

注意：material 比 PF/driver_type 更容易误填，报告里必须列出每个 factory/category 的主导材质样本。若 dry-run 显示异常，执行者应先修规则再 apply。

## 报告

写入 `docs/v13.6-defaults-gap-fill-report.md`

```markdown
# V13.6 PF / driver_type / material 默认值补全报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.6

## 汇总

| 参数 | 缺口 | 可填充 | 实际新增 |
|---|---:|---:|---:|
| pf | X | X | X |
| driver_type | X | X | X |
| material | X | X | X |

## 规则明细

| param | category | factory | 主导值 | 样本数 | 占比 | 新增 |
|---|---|---|---|---:|---:|---:|

## Material 样本复查

| category | factory | material | 新增 | 示例产品 |
|---|---|---|---:|---|

## 跳过原因

| param | reason | count |
|---|---|---:|

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| PF 覆盖率(需覆盖) | X% | X% |
| driver_type 覆盖率(需覆盖) | X% | X% |
| material 覆盖率(需覆盖) | X% | X% |
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
V13.6: factory/category defaults for PF, driver_type, and material gaps
```

## 不做什么

- 不覆盖已有参数
- 不改核心参数定义
- 不从产品名随便猜 material
- 不修改源 Excel 文件
