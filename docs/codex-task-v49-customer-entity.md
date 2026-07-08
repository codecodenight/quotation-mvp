# V49 — 客户实体管理（原 V3.1 计划）

> **补录说明**：本任务由 Claude Fable 5 于 2026-07-07 直接执行完成，此文档为事后补录的记录（非 Codex 执行指令）。

## 背景

quotes.customerName 和 customer_quote_files.customer_name 都是自由文本，无法按客户聚合查看报价历史。第一步：客户实体 + 聚合视图（不动报价创建流程）。

## 完成内容

### Schema：`customers` 表
```prisma
model Customer {
  id        String   @id @default(uuid())
  name      String   @unique
  aliases   String?  // JSON array，如 ["HTF Ltd","HTF"]
  note      String?
  createdAt DateTime @default(now()) @map("created_at")
  @@map("customers")
}
```

**⚠️ 迁移方式（重要）**：本库**没有 `_prisma_migrations` 表**（从未用过 prisma migrate），`prisma migrate dev` 会挂起且有 reset 数据风险。正确做法：
1. 备份 DB（本次：`prisma/dev.db.bak-v45-pre-customer`）
2. `sqlite3 prisma/dev.db` 直接执行 CREATE TABLE + CREATE UNIQUE INDEX
3. schema.prisma 加 model 后 `CHECKPOINT_DISABLE=1 npx prisma generate`

### 回填 `scripts/v49-backfill-customers.ts`
- 从 quotes + customer_quote_files 收集去重客户名（排除空值/"Chat Quote"/"内部核价"），幂等
- 执行结果：quotes 24 个 / files 17 个 → 去重 41 个客户实体

### 页面
- `/customers`：客户列表（新报价单数 / 历史报价文件数 / 历史行数 / 最近报价日期），活跃客户排前
- `/customers/[id]`：客户详情 = 新报价单列表（含 Excel 下载）+ 历史报价记录（型号/绑定产品/FOB USD）
- 聚合按 `name + aliases`（aliases 为 JSON 数组，预留合并能力，暂无编辑 UI）
- `src/components/sidebar.tsx` 加"客户管理"入口

## 明确不做（本版）
- 报价创建流程仍是自由文本客户名（实体只做聚合视图）
- 别名编辑/客户合并 UI（aliases 字段已支持，待后续版本）

## 验证
生产构建后实测：/customers 显示 41 个客户，详情页 200。
