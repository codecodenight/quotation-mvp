# V52 — 报价时客户历史价提示

> **补录说明**：由 Claude Fable 5 于 2026-07-07 执行完成。

## 背景
V5.4 已有"历史售价参考"折叠面板（所有客户混排）。增量：**当前正在报价的客户**如果给同产品报过价，不用点开面板，直接高亮提示。

## 完成内容
- `quotes-client.tsx` 新增 `CustomerHistoryHint` 组件：客户名（≥2 字符）与产品历史报价记录的 customerName 双向模糊匹配（trim + lowercase + includes），命中则在已选产品行渲染紫色高亮条：**"上次给 {客户} 报过 $X.XX (日期)"**
- `customerName` 从 QuoteParameterPanel 状态透传到 SelectedProductsTable
- 数据源复用现有 `product.historicalQuotes`（getHistoricalQuotesByProductIds），零新查询

## 边界
- 名字匹配不经过 Customer 实体 aliases（客户端无实体数据）；后续可升级为服务端按实体聚合匹配
