# V51 — 报价单状态流转

> **补录说明**：由 Claude Fable 5 于 2026-07-07 执行完成。

## 背景
报价单导出即终点，无法回答成交率、报价-成交周期。加最小的生命周期状态。

## 完成内容
- **DB**：`quotes` 加 `status TEXT NOT NULL DEFAULT 'draft'`（sqlite3 直接 DDL，本库不用 prisma migrate；备份 `prisma/dev.db.bak-v51-pre-status`）；schema.prisma 同步 + prisma generate
- **状态集**：`draft 草稿 / sent 已发送 / won 成交 / lost 流失`（`QUOTE_STATUSES` in `quote-history.ts`，`parseQuoteStatus` 容错回落 draft）
- **Server action**：`updateQuoteStatus(quoteId, status)` in quotes/actions.ts（校验 + revalidate）
- **UI**：报价历史表新增"状态"列，内联彩色 select（草稿灰/已发送紫/成交绿/流失红），乐观更新失败回滚
- QuoteSearchResult/serializer 带 status；历史表 colSpan 8→9

## 后续可做
- 状态筛选器（搜索表单加 status 下拉）
- 概览页成交率统计卡
