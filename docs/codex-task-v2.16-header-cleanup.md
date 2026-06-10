# Codex Task: V2.16 — 表头误导入产品清理

## 目标

删除 4 个被误导入为产品的表头行及其关联 offers。

## 背景

V2.15 extraction spike 审计发现 4 条产品的 model_no / product_name / size 明显是 Excel 表头行内容，不是真实产品。它们会干扰 V3.0 参数提取（把 `Model` / `类别` / `Dimension (mm)` 当成产品去提取参数），必须在 V3.0 之前清理。

### 待删除记录

| product_id | 品类 | model_no | size | offers 数 | quote_items 数 |
|---|---|---|---|---:|---:|
| `447175f0-68e5-48ad-91d0-c4d9b1050447` | Highbay | `Model` | `Size` | 1 | 0 |
| `5572d38d-b39a-4d03-9b0e-a900124b969c` | 净化灯 | `类别` | `规格（mm)` | 1 | 0 |
| `7a0cfc93-c4e7-4012-9e33-ae88a859c54d` | 球泡 | `LED Bulb-Power-Lumen` | `Dimension (mm)` | 2 | 0 |
| `2203b109-2c65-4dbb-a128-8cc251a03bac` | 路灯 | `Model No.` | `Body Size` | 1 | 0 |

**预期影响：** products 2,144 → 2,140，offers 2,235 → 2,230

## 执行步骤

### Step 1: 备份 + 确认

- 备份 DB：`cp prisma/dev.db backups/dev-before-v2.16-header-cleanup-$(date +%Y%m%d-%H%M%S).sqlite`
- 确认这 4 个 product 仍然存在
- 确认它们没有 quote_items 引用（`SELECT COUNT(*) FROM quote_items qi JOIN supplier_offers so ON so.id = qi.supplier_offer_id WHERE so.product_id IN (...)`）
- 确认它们没有 price_history 引用
- 如果任何一条有 quote_items 或 price_history → 停止，报告

### Step 2: 删除 offers

```sql
DELETE FROM supplier_offers WHERE product_id IN (
  '447175f0-68e5-48ad-91d0-c4d9b1050447',
  '5572d38d-b39a-4d03-9b0e-a900124b969c',
  '7a0cfc93-c4e7-4012-9e33-ae88a859c54d',
  '2203b109-2c65-4dbb-a128-8cc251a03bac'
);
```

预期删除：5 条 offers

### Step 3: 删除 products

```sql
DELETE FROM products WHERE id IN (
  '447175f0-68e5-48ad-91d0-c4d9b1050447',
  '5572d38d-b39a-4d03-9b0e-a900124b969c',
  '7a0cfc93-c4e7-4012-9e33-ae88a859c54d',
  '2203b109-2c65-4dbb-a128-8cc251a03bac'
);
```

预期删除：4 条 products

### Step 4: 验证 + 提交

- 确认 products 总数 = 2,140
- 确认 offers 总数 = 2,230
- 确认这 4 个 product_id 在 products / supplier_offers 中不存在
- `npm test` / `npm run lint` / `npm run build` 通过
- 结果写入 `docs/v2.16-header-cleanup-result.md`
- git commit
