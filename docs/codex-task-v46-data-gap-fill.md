# V46 — 数据补全批处理：CTN 自动补全 + 缺口报告

> **补录说明**：本任务由 Claude Fable 5 于 2026-07-07 直接执行完成，此文档为事后补录的记录（非 Codex 执行指令）。

## 背景

图片覆盖率 73.6%（缺 2587/9807），CTN 装箱数据覆盖率 ~25%。需要安全的自动补全 + 按源文件分组的缺口报告，方便后续按文件批量处理。

## 完成内容

### 脚本 `scripts/v46-data-gap-fill.ts`
- 默认 dry-run（只生成报告），`--apply` 才写库
- **Pass 1 同产品互补**：同一产品下某 offer 有 CTN（qty/size/或 L+W+H 齐全）、其他 offer 缺 → 复制（业务假设：同产品装箱规格一致）
- **Pass 2 历史报价回填**：已绑定产品的 `customer_quote_rows.ctn_qty/ctn_size` 有值、且该产品所有 offer 都缺 CTN → 回填
- 报告写入 `docs/v46-data-gap-report.md`：缺图产品按源文件 Top 30、补全后仍缺 CTN 的 offer 按源文件 Top 30、补全明细前 50 条

### 执行结果（2026-07-07）
- 备份：`prisma/dev.db.bak-v46-pre-ctn-fill`
- **已应用 690 条 CTN 补全**
- 补后仍缺 CTN：6589 条 offer（集中在少数源文件，见报告）

## 后续
- 缺图 2587 产品按报告分组，走图片重提取流水线
- 剩余缺 CTN 的源文件如原 Excel 有装箱 sheet，可扩展 import 列映射
