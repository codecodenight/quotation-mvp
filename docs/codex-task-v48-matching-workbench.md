# V48 — 历史报价半自动匹配工作台（原 V5.5 计划）

> **补录说明**：本任务由 Claude Fable 5 于 2026-07-07 直接执行完成，此文档为事后补录的记录（非 Codex 执行指令）。

## 背景

customer_quote_rows 有大量未绑定产品的记录（rawModel 非空的未匹配行验证时为 1657 条），逐条手动搜索绑定太慢。做"候选推荐 + 一键确认"工作台。

## 完成内容

### 打分算法 `src/lib/customer-quote-matching.ts`（纯函数，11 个单测）
- `normalizeModel`：NFC + 大写 + 去除非字母数字（保留 CJK）
- 打分规则（阈值 40，取 Top 3）：
  | reason | 分数 | 条件 |
  | --- | --- | --- |
  | exact | 100 | 归一化后完全相等 |
  | contains | 70-90 | 一方包含另一方（≥4 字符），按长度占比加分 |
  | prefix | 40-69 | 公共前缀 ≥4 字符 |
  | watts | 40 | 瓦数一致 + 描述含品类词 |

### 页面 `/customer-quotes/matching`
- `matching/page.tsx`：全量产品（~9800）载入内存做打分；每批 30 行（扫描前 120 行取有候选的）
- `matching-client.tsx`：每行显示原始型号/描述/客户/价格 + Top 3 候选卡（缩略图、分数徽章、命中原因标签）；确认（复用 `bindCustomerQuoteRowToProduct`）/ 跳过 / 换一批；剩余计数
- `/customer-quotes` 头部加"半自动匹配"入口按钮

### 测试
`src/lib/customer-quote-matching.test.ts` — 11 passed

## 验证
生产构建后实测页面：显示"剩余 1657 条未匹配"，本批渲染 76 个候选。

## 后续
- 跑一轮实际匹配（人工确认候选）
- 低置信度（<40 分）的记录仍走手动模式
