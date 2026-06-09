# Codex Task: 修复悬空 quote_items

## 目标

删除 2 条引用不存在 supplier_offer 的 quote_items 记录。

## 背景

V2.9 去重审计时发现 2 条 quote_items 的 `supplier_offer_id` 指向已不存在的 offer（`fba596bd-3a5d-4737-a94b-fed6f151d0cb`）。这不是 V2.9 造成的，该 offer 在更早的清理中已被删除。

受影响记录：

| quote_item_id | quote | 状态 |
|---|---|---|
| `9565cf63-1bfe-4a60-aad5-c95da571cb73` | V1.8 Preview Test（测试报价） | 悬空 |
| `8d1382a4-2d20-4422-be55-b7fbfc0de604` | V2真实跑-02-球泡（早期测试） | 悬空 |

两个报价各有 3 条 item，只有这 2 条悬空，其余 4 条正常。两个都是开发/测试报价，不是真实客户数据。

## 执行步骤

### Step 1: 备份 + 确认

- 备份 DB
- 确认这 2 条 quote_items 仍然悬空（`LEFT JOIN supplier_offers ... WHERE so.id IS NULL`）
- 确认没有其他新增的悬空 quote_items

### Step 2: 删除

```sql
DELETE FROM quote_items WHERE id IN (
  '9565cf63-1bfe-4a60-aad5-c95da571cb73',
  '8d1382a4-2d20-4422-be55-b7fbfc0de604'
);
```

### Step 3: 验证 + 提交

- 再次查询确认 0 条悬空 quote_items
- `npm test` / `npm run lint` / `npm run build` 通过
- 结果写入 `docs/dangling-quote-items-result.md`
- git commit
