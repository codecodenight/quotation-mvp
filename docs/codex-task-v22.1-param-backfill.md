# V22.1: 参数回填 — 从产品名提取缺失参数

## Goal

对 V22.0 审计发现的低覆盖率 品类×param_key 组合，从产品名（product_name）和备注中自动提取参数回填到 product_params。

## Context

- product_params 表：id, product_id, param_key, raw_value, normalized_value, unit, display_order
- 产品名通常包含功率、色温、电压等信息，如 "LED Panel Light 36W 600×600 AC220-240V 4000K Ra80 IP20"
- 只回填 product_params 中缺失的参数（该 product_id + param_key 组合不存在时才插入）
- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v22.1-param-backfill.ts`，用 `tsx` 执行。支持 `--dry-run`（默认）和 `--apply` 两种模式。

### 目标参数及提取规则

只回填以下参数（按优先级排序）：

1. **watts** — `/(\d+(?:\.\d+)?)\s*[Ww]\b/` → normalized_value = 数字, unit = "W"
2. **cct** — `/(\d{4})\s*[Kk]/` 或 `/\b(2700|3000|4000|5000|6000|6500)\b/` → unit = "K"
3. **voltage** — `/AC\s*(\d{2,3}(?:-\d{2,3})?)\s*[Vv]/i` 或 `/(\d{2,3}(?:-\d{2,3})?)\s*[Vv]\b/` → unit = "V"
4. **ip** — `/IP\s*(\d{2})/i` → normalized_value = 数字部分, unit = null
5. **cri** — `/Ra\s*(\d{2,3})/i` 或 `/CRI\s*(\d{2,3})/i` → unit = null
6. **beam_angle** — `/(\d+)\s*°/` 或 `/(\d+)\s*degree/i` → unit = "°"
7. **base** — `/(E27|E14|E26|B22|GU10|GU5\.3|MR16|G9|G4)/i` → unit = null
8. **material** — `/(aluminum|aluminium|plastic|iron|glass|acrylic|PC|ABS|steel|stainless)/i` → unit = null

### 流程

1. 备份 DB 到 `backups/dev-before-v22.1-YYYYMMDD-HHMMSS.sqlite`
2. 查询所有 品类×param_key 覆盖率 < 80% 的组合（只限上述 8 个参数）
3. 对每个组合：
   a. 查询缺失该参数的产品列表
   b. 对每个产品的 product_name 应用对应正则
   c. 如果匹配成功，准备 INSERT 语句
4. dry-run 模式只输出统计；apply 模式执行 INSERT

### 安全规则

- 只 INSERT 新的 product_params 行，不 UPDATE 或 DELETE 已有行
- raw_value = 匹配到的原始文本（如 "36W"）
- normalized_value = 提取的数值部分（如 "36"）
- display_order = 100（排在原始提取的参数后面）
- 每个 product_id + param_key 组合只插入一条，即使正则匹配到多个值（取第一个）
- 如果产品名中 watts 正则匹配到多个数字（如 "36W 600×600"），只取紧跟 W 的那个

### 报告

写到 `docs/v22.1-param-backfill-report.md`：

```markdown
# V22.1 参数回填报告

## 备份
路径: backups/dev-before-v22.1-YYYYMMDD-HHMMSS.sqlite

## 回填统计

| 品类 | param_key | 之前覆盖 | 回填数 | 之后覆盖 | 覆盖率变化 |
|------|-----------|----------|--------|----------|------------|
| 线条灯 | watts | 260/1135 | +150 | 410/1135 | 23%→36% |
| ... |

## 总计
- 检查产品: N
- 回填成功: N 条 product_params
- 无法提取: N 产品（产品名中没有匹配模式）

## 回填后数据
- product_params 总数: before → after

## tsc / vitest
- 不需要（纯数据操作）
```

### 约束

- 不修改 src/ 下的任何文件
- 只操作 product_params 表
- 必须先备份再操作
