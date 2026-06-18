# V13.8 — 核心参数定义调整 + 集中化

V13.7 审计后确认：4 项参数不应作为核心完成率硬门槛。同时 CATEGORY_CORE_PARAMS 在 7 个脚本中各自复制，存在口径漂移风险。本任务解决这两个问题。

**依赖：V13.7 已完成。**

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v13.8
```

## Part A — 集中化 CATEGORY_CORE_PARAMS

在 `scripts/v11-shared.ts` 末尾新增导出：

```typescript
export const CATEGORY_CORE_PARAMS: Record<string, string[]> = {
  筒灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  面板灯: ["voltage", "cct", "cri", "pf", "driver_type", "material"],
  磁吸灯: ["voltage", "cct", "cri"],
  吸顶灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  灯丝灯: ["voltage", "cct", "cri", "pf", "base"],
  风扇灯: ["voltage", "cct", "cri"],
  球泡: ["voltage", "cct", "cri", "pf", "base"],
  壁灯: ["voltage", "cct", "cri", "driver_type", "material"],
  净化灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  橱柜灯: ["voltage", "cct", "cri"],
  镜前灯: ["voltage", "cct", "cri", "driver_type"],
  轨道灯: ["voltage", "cct", "cri", "pf", "beam_angle"],
  防潮灯: ["voltage", "cct", "cri", "ip", "pf", "driver_type"],
  台灯: ["voltage", "cct", "cri"],
  G4G9: ["voltage", "cct", "cri", "base"],
  灯管: ["voltage", "cct", "cri", "pf"],
  线条灯: ["voltage", "cct", "cri", "ip"],
  投光灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle", "material"],
  三防灯: ["voltage", "cct", "cri", "ip", "pf"],
  太阳能壁灯: ["cct", "ip"],              // ← material 移除
  太阳能: ["cct", "ip"],                   // ← material 移除
  路灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  "地埋灯/地插灯": ["voltage", "cct", "cri", "ip", "beam_angle"],
  工作灯: ["voltage", "cct", "cri", "ip"],
  庭院灯: ["voltage", "cct", "ip", "material"],
  Highbay: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  充电灯: ["cct", "ip"],                   // ← material 移除
  应急灯: ["voltage", "cct"],
  灯带: ["voltage", "cct", "cri", "ip"],
  皮线灯: ["voltage"],                     // ← ip 移除
};
```

变更清单（相比之前 7 个脚本中的副本）：
- `太阳能壁灯`: `["cct", "ip", "material"]` → `["cct", "ip"]`
- `太阳能`: `["cct", "ip", "material"]` → `["cct", "ip"]`
- `充电灯`: `["cct", "ip", "material"]` → `["cct", "ip"]`
- `皮线灯`: `["voltage", "ip"]` → `["voltage"]`

## Part B — 更新所有脚本引用

以下 7 个脚本都有本地 `const CATEGORY_CORE_PARAMS` 副本，全部替换为从 `v11-shared` 导入：

1. `scripts/v13.1-post-inference.ts`
2. `scripts/v13.2-rule-based-gap-fill.ts`
3. `scripts/v13.3-remark-extraction.ts`
4. `scripts/v13.4-cct-safe-propagation.ts`
5. `scripts/v13.5-ip-gap-fill-round2.ts`
6. `scripts/v13.6-defaults-gap-fill.ts`
7. `scripts/v13.7-core-param-definition-audit.ts`

操作：
- 删除每个文件中 `const CATEGORY_CORE_PARAMS: Record<string, string[]> = { ... };` 整块（约 30 行）
- 在已有的 `import { ... } from "./v11-shared"` 行中加入 `CATEGORY_CORE_PARAMS`
- 如果该文件没有从 v11-shared 导入，新增 import 行

注意：只改 import 引用，不改文件的其他逻辑。

## Part C — 重跑覆盖率审计

新建脚本 `scripts/v13.8-coverage-audit.ts`：

功能与 V13.7 审计脚本的覆盖率计算部分相同，但更简洁——只做以下事情：

1. 从 `v11-shared` 导入 `CATEGORY_CORE_PARAMS`（新定义）
2. 对每个 category×param_key 计算覆盖数/需覆盖数
3. 对每个品类计算完成产品数
4. 输出全局完成率
5. 和 V13.6 报告中的旧数字做 diff 对比

```bash
npx tsx scripts/v13.8-coverage-audit.ts
```

不需要 `--apply` 模式，纯只读。

## 报告：`docs/v13.8-core-param-refactor-report.md`

```markdown
# V13.8 核心参数定义调整报告

时间: ...

## 定义变更

| 品类 | 移除参数 | 理由 |
|---|---|---|
| 太阳能壁灯 | material | 供应商不提供，无业务选型价值 |
| 太阳能 | material | 同上 |
| 充电灯 | material | 电池灯具，材质非采购决策因素 |
| 皮线灯 | ip | 装饰灯串，IP 非标准规格参数 |

## 集中化

| 文件 | 操作 |
|---|---|
| scripts/v11-shared.ts | 新增 CATEGORY_CORE_PARAMS 导出 |
| (7 个 V13.x 脚本) | 删除本地副本，改为 import |

## 覆盖率变化

| 指标 | 调整前(V13.6) | 调整后 |
|---|---:|---:|
| 核心参数覆盖范围产品 | 10276 | X |
| 全部完成产品 | 5272 | X |
| 全局完成率 | 51.3% | X% |

### 逐品类变化（仅受影响品类）

| 品类 | 旧完成 | 新完成 | 变化 |
|---|---:|---:|---:|

### 逐参数覆盖率

| param_key | 覆盖 | 需覆盖 | 覆盖率 |
|---|---:|---:|---:|

## DB 计数

| 表 | 数量 | 变化 |
|---|---:|---:|
| products | 10284 | 0 |
| product_params | 88591 | 0 |
```

## Commit

```
V13.8: centralize CATEGORY_CORE_PARAMS, remove 4 non-essential core param requirements
```

## 不做什么

- 不删除任何 product_params 记录（material/ip 数据保留，仅移出完成率计算）
- 不改 Prisma schema / 前端
- 不修改源 Excel 文件
- 不调用 DeepSeek API
- 不改旧脚本的业务逻辑（仅替换 import）
