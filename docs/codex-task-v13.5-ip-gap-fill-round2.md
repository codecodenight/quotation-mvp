# V13.5 — IP 二轮规则补全

目标：V13.2 后 IP 覆盖已明显提升，但仍有约 1,358 个核心 IP 缺口。继续用保守规则补全 IP，优先处理只差 IP 即可完成的产品。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.5
```

## 新建文件

`scripts/v13.5-ip-gap-fill-round2.ts`

```bash
npx tsx scripts/v13.5-ip-gap-fill-round2.ts
npx tsx scripts/v13.5-ip-gap-fill-round2.ts --apply
```

## Part A — 太阳能壁灯 IP 默认

数据背景：太阳能壁灯是户外/太阳能类产品，核心参数要求包含 IP。V13.2 已对 `太阳能` 品类做 IP65 默认，但 `太阳能壁灯` 仍大量缺 IP。

规则：

- category = `太阳能壁灯`
- 当前没有非空 `ip`
- 填充 `IP65`
- source_field = `category_default`
- confidence = `low`

## Part B — 灯带 IP 二轮

V13.2 已用 voltage 推断：
- 220V → IP65
- 24V → IP20

本轮只做工厂+品类主导值传播：

- category = `灯带`
- 当前没有非空 `ip`
- 同工厂+品类已有 IP 样本数 `>= 10`
- 主导 IP 占比 `>= 90%`
- 主导值只允许 `20` / `44` / `65`
- source_field = `factory_category_default`
- confidence = `low`

## Part C — 三防灯 / 防潮灯 / 投光灯 / 路灯 IP 工厂传播

这些品类 IP 有明确业务意义，但不能直接全品类默认。只允许同工厂+品类传播：

适用品类：

```typescript
["三防灯", "防潮灯", "投光灯", "路灯", "工作灯", "庭院灯", "Highbay"]
```

规则：
- 当前没有非空 `ip`
- 同工厂+品类已有 IP 样本数 `>= 10`
- 主导 IP 占比 `>= 90%`
- 主导值范围：`20` / `44` / `54` / `65` / `66` / `67`
- source_field = `factory_category_default`
- confidence = `low`

## Part D — 皮线灯 IP 审计型填充

皮线灯 IP 缺口大，但业务上可能室内/户外混杂。只允许非常严格的工厂传播：

- category = `皮线灯`
- 当前没有非空 `ip`
- 同工厂+品类已有 IP 样本数 `>= 10`
- 主导 IP 占比 `>= 95%`
- source_field = `factory_category_default`
- confidence = `low`

## 报告

写入 `docs/v13.5-ip-gap-fill-round2-report.md`

```markdown
# V13.5 IP 二轮规则补全报告

模式: dry-run / apply
时间: ...
备份: prisma/dev.db.bak-v13.5

## 汇总

| Part | 规则 | 新增 |
|---|---|---:|
| A | 太阳能壁灯 IP65 默认 | X |
| B | 灯带工厂传播 | X |
| C | 户外/工业品类工厂传播 | X |
| D | 皮线灯严格工厂传播 | X |

## 规则明细

| part | category | factory | 主导 IP | 样本数 | 占比 | 新增 |
|---|---|---|---:|---:|---:|---:|

## 跳过原因

| reason | count |
|---|---:|
| 样本不足 | X |
| 主导占比不足 | X |
| IP 值不在允许范围 | X |

## 覆盖率变化

| 指标 | 变化前 | 变化后 |
|---|---:|---:|
| IP 覆盖率(需覆盖) | X% | X% |
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
V13.5: second-round IP gap fill with category defaults and factory propagation
```

## 不做什么

- 不覆盖已有 IP
- 不从型号随便猜 IP
- 不改核心参数定义
- 不修改源 Excel 文件
