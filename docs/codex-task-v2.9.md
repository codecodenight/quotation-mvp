# Codex Task: V2.9 — 2-Offer 重复清理

## 目标

处理 204 组 `model_no + factory_name` 各有 2 条 supplier_offers 的重复组，保留最新报价，清除旧的冗余数据。

## 背景

V2.8 A3 已清理 ≥3 条的重复组（删除 347 条）。剩余 204 组各有 2 条 offer，仍会在报价页造成选择困惑和价格选错风险。

## Step 0: 审计（只读）

1. 查询所有 2-offer 重复组：
   ```sql
   SELECT p.model_no, so.factory_name, COUNT(*) as cnt
   FROM supplier_offers so
   JOIN products p ON so.product_id = p.id
   GROUP BY p.model_no, so.factory_name
   HAVING cnt = 2
   ORDER BY p.model_no;
   ```

2. 对每组标记：
   - **保留**：`price_updated_at` 更新的一条，fallback `created_at` 更新的
   - **待删除**：另一条
   - **有引用**：查 `quote_items.supplier_offer_id` 是否引用待删除的 offer，有引用则不能删
   - **价格差异**：计算 `abs(price1 - price2) / min(price1, price2)`，> 30% 标记人工确认

3. 分类汇总写入 `docs/v2.9-dedup-audit.md`：

   ```markdown
   # V2.9 — 2-Offer 重复审计

   ## 统计
   - 重复组数：X
   - 计划删除：X
   - 有引用跳过：X
   - 价格差异 > 30% 需人工确认：X

   ## 安全删除清单（价差 ≤ 30%，无引用）
   | model_no | factory | 保留 offer_id | 保留价格 | 保留日期 | 删除 offer_id | 删除价格 |

   ## 跳过清单（有 quote_items 引用）
   | model_no | factory | offer_id | 引用数 |

   ## 人工确认清单（价差 > 30%）
   | model_no | factory | offer_1 价格 | offer_2 价格 | 差异比 | 建议保留 |
   ```

**STOP — 写完审计报告后停止，等确认后再执行删除。**

## Step 1: 执行删除（确认后）

1. 确认备份存在
2. 删除安全删除清单中的 offer
3. 如用户确认了人工确认清单中的部分 → 也一并删除
4. 验证：
   - `SELECT COUNT(*) FROM supplier_offers` 应减少对应数量
   - `SELECT COUNT(*) FROM quote_items` 不变
   - 重复组数应为 0（或仅剩跳过的）
5. 将执行结果追加到 `docs/v2.9-dedup-audit.md`
6. git commit

## 注意事项

- 源 Excel 文件绝不修改
- 删除前必须确认 quote_items 无引用
- 不用 CASCADE
- 价格差异大的可能是不同规格被归到同一 model_no，需要保留两条或修正 model_no
