# Codex Task: V2.12 Image Backfill Round 2 — 扩大锚点搜索范围

## 目标

通过放宽行锚点搜索半径 + 对 generated model 做组件匹配，为更多产品匹配到图片。

## 背景

V2.6/V2.8 第一轮 backfill：从 84 个源文件提取 3,020 张图，匹配 601 个产品（486 → 1,087 有图）。剩余 1,057 个产品无图。

第一轮未匹配的主要原因（见 `docs/image-backfill-result.md` "Files With Extracted Images But No Matches"）：
1. **锚点偏移 >1 行**：`findProductsNearImage()` 默认 `rowRadius=1`，很多 Excel 文件的图片锚点与产品行偏差 2-3 行
2. **Generated model 无法在单元格中找到**：如 `（猎鹰二代）-太阳能草坪灯 - 一拖二 - 90LM` 是由多列拼接生成的，Excel 里没有完整匹配的单元格

无图产品分类：native model 1,010 个，generated model 47 个。

## 设计

### 策略 A：放宽 rowRadius（主要收益来源）

将 `findProductsNearImage()` 的 `rowRadius` 从 1 改为 3。

理由：
- 第一轮报告中 30+ 个文件标注"需要检查行锚点与 model_no 距离"
- 这些文件总共有 600+ 张未匹配图片
- Excel 图片锚点偏移 2-3 行很常见（合并单元格、表头行、空行等）
- `rowRadius=3` 覆盖锚点上下 3 行（共 7 行窗口），足以覆盖绝大多数偏移

风险控制：
- `chooseBestHit()` 已有优先级排序（距离近 > modelKey 长 > rowIndex 小）
- 短 model（≤3 字符）仍要求 exact match，不会误匹配
- 已有图的产品自动跳过

### 策略 B：Generated model 组件匹配

对 generated model（model_no 包含中文描述 + 多个 ` - ` 分隔符），提取最后一个可识别的原始型号组件进行匹配。

例如：
- `下洗墙灯 - ZQ-XXQD-001 - 23lm - 3CCT` → 提取 `ZQ-XXQD-001` 尝试匹配
- `（猎鹰二代）-太阳能草坪灯 - 一拖二 - 90LM` → 无原始型号组件（全是描述性文字），跳过

实现方式：在 `buildCandidateGroups()` 中，当 model_no 包含 ` - ` 且长度 > 20 时，额外提取看起来像型号的组件（包含字母+数字，如 `ZQ-XXQD-001`）作为备选 modelKey。一个产品可以同时用完整 key 和组件 key 参与匹配。

## 执行步骤

### Step 1: 审计 + 预分析

- 统计当前无图产品数量和来源文件分布
- 用 `rowRadius=3` 做全量 dry-run（不写 DB），统计新增匹配数
- 与 `rowRadius=1` 对比，确认新增匹配合理
- 抽查 5 个新增匹配样本：验证图片锚点行和产品行的实际距离
- 结果写入 `docs/v2.12-image-backfill-result.md`

### Step 2: 实现 + 测试

- 修改 `src/lib/image-backfill.ts`：
  - `DEFAULT_ROW_RADIUS` 改为 3
  - `buildCandidateGroups()` 增加 generated model 组件 key 逻辑
- 单元测试覆盖：
  1. `rowRadius=3` 能匹配到偏移 2-3 行的图片
  2. generated model 组件提取 + 匹配
  3. 原有 `rowRadius=1` 的测试仍通过（显式传参）

### Step 3: Apply

- 备份 DB
- 执行 backfill apply（与第一轮相同脚本，已有图的产品自动跳过）
- 统计新增有图产品数
- 结果追加到 `docs/v2.12-image-backfill-result.md`

### Step 4: 验证 + 提交

- 随机抽查 10 个新匹配产品的缩略图文件是否存在且可读
- `npm test` / `npm run lint` / `npm run build` 全通过
- 结果追加到 `docs/v2.12-image-backfill-result.md`
- git commit

## 注意事项

- 源 Excel 文件绝不修改
- 备份 DB 后再 apply
- 已有图片的产品不覆盖
- 第一轮 backfill 脚本 `scripts/image-backfill.ts` 可复用
- Schema 不变
