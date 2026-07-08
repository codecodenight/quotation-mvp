# V53 — 客户网页版报价单

> **补录说明**：由 Claude Fable 5 于 2026-07-07 执行完成。原计划还含"品类完整度评分"，检查后发现 V4.4c 的 `CoreParamCompletion`（/data-quality）已覆盖该需求，未重复实现。

## 背景
报价单只有 Excel 附件形态。给客户一条能直接打开的链接/可打印 PDF 的网页版更体面（学 PandaDoc 的客户侧体验）。

## 完成内容
- **路由 `/quote/[id]`**（admin 布局外，无侧边栏）：QUOTATION 抬头 + Customer/Date/Valid Until(30天)/Quote No. + 产品表（Photo/Model/Details/Unit Price/MOQ/Qty/Amount/Remark）+ Total + FOB 条款 footer
- **客户视角**：不渲染采购价/工厂名（数据来自 `getQuoteDetail`，字段存在但不展示）
- Product Details 复用导出同款 `buildProductDetails`（经 getQuoteDetail）；图片用与 detail 相同 orderBy 的并行查询按索引配对
- **打印**：`PrintButton` 客户端组件调 `window.print()`（print:hidden），浏览器可直接存 PDF
- **入口**：报价历史详情面板加"网页版"链接（新标签打开）

## 注意
- 部署后此页在 Basic Auth 后面；如果要真正发给客户，需要 nginx 对 `/quote/*` 放行或加签名 token——**发链接给客户前先解决这个**，当前形态适合内部打开后存 PDF 发送
