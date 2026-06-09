# Codex Task: Price Version Tracking — 价格更新替代重复创建

## 目标

改造导入逻辑：当同一 `product_id + factory_name` 的 offer 已存在时，更新价格而非创建新 offer。记录价格变更历史。

## 背景

当前导入行为：每次导入同一产品/工厂组合，都会创建新的 supplier_offer 记录，导致大量重复（V2.8 A3 删了 347 条，V2.9 又删了 203 条）。根本原因是导入逻辑缺少 upsert 机制。

V2.9 已完成去重，现在 offer 数据干净（2,223 条，仅 1 组重复且有引用无法删）。在此基础上加入价格版本追踪，防止未来再产生重复。

## 设计

### 新表：price_history

```sql
CREATE TABLE price_history (
  id TEXT PRIMARY KEY,
  supplier_offer_id TEXT NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
  old_price DECIMAL NOT NULL,
  new_price DECIMAL NOT NULL,
  old_source_file_id TEXT REFERENCES files(id),
  new_source_file_id TEXT REFERENCES files(id),
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_price_history_offer ON price_history(supplier_offer_id);
```

### 导入逻辑改造

在 `src/app/import/actions.ts` 和 `src/lib/hejia-import.ts` 的 offer 创建逻辑中：

1. 查询是否存在 `supplier_offers` WHERE `product_id = X AND factory_name = Y`
2. 如果存在且价格不同：
   - 插入 `price_history` 记录（old_price, new_price, source_file_ids）
   - 更新 `supplier_offers` 的 `purchase_price`, `price_updated_at`, `source_file_id`
   - 如果新数据有 CTN/MOQ 信息而旧的没有 → 一并更新（补充，不覆盖已有值）
3. 如果存在且价格相同 → 跳过（与当前 duplicate skip 行为一致）
4. 如果不存在 → 创建新 offer（与当前行为一致）

### Prisma schema 更新

用 raw SQL 创建表（Prisma schema-engine 在此 Mac 有 empty error bug）。Prisma schema 文件同步更新 model 定义。

## 执行步骤

### Step 1: 创建 price_history 表

- 用 `sqlite3 prisma/dev.db` 执行 CREATE TABLE
- 更新 `prisma/schema.prisma` 添加 PriceHistory model
- 验证：`PRAGMA table_info(price_history)` 确认字段

### Step 2: 改造导入逻辑

- 修改 offer 创建代码为 upsert 逻辑
- 确保 price_history 在价格变更时写入
- 补充字段更新规则：CTN/MOQ 只补不覆盖（新值非空且旧值为空时才更新）

### Step 3: 测试

- 单元测试：
  1. 新 offer（无已有）→ 创建，无 price_history
  2. 已有 offer 价格相同 → 跳过，无 price_history
  3. 已有 offer 价格不同 → 更新 offer + 写 price_history
  4. 已有 offer 无 CTN，新数据有 CTN → 补充 CTN
  5. 已有 offer 有 CTN，新数据有不同 CTN → 不覆盖
- `npm test` / `npm run lint` / `npm run build` 全部通过

### Step 4: 验证

- 用一个已导入文件做 dry-run 测试：重新导入应产生 0 新 offer + 0 price_history（价格未变）
- 修改测试数据价格后重新导入 → 应产生 price_history 记录
- 将完整验证结果写入 `docs/price-version-result.md`

### Step 5: 提交

- git commit 所有改动

## 注意事项

- Schema 改用 raw SQL（不用 `npx prisma db push`）
- 备份 DB 后再建表
- 源 Excel 文件绝不修改
- 不改变现有 API/UI 行为，仅改导入时的内部逻辑
- price_history 是追加日志表，不删除历史记录
