# V20.0: 多配置 FOB 价格审计

## Goal

只读审计当前 DB 的价格数据能否支撑"同一产品按不同配置（电压/驱动/光效/材质/质保）分别报价"的需求。输出一份审计报告，回答以下问题：

1. 同 model_no 不同 voltage/driver_type 的产品是否已分行存储？如果已分行，那"多配置报价"已经通过多产品实现，不需要改 schema。
2. 有多少产品的 supplier_offers 存在多条相同工厂的 offer（同 product_id + factory_name）？这些是否对应不同配置？
3. 报价汇总表中"同行多 FOB 列"的结构（如 LED Bulb A60 三个 FOB 列），在当前 DB 中对应的产品和 offer 是什么样的？抽样 3 个品类验证。

## Context

- 报价汇总表（外置硬盘 .xls）同一产品行有多个 FOB 列，每列对应不同电压/驱动/光效组合
- 当前 DB 中工厂源文件导入时，不同配置通常已分行导入为不同产品（不同 model_no 后缀）
- `supplier_offers` 有 `product_id + factory_name` 唯一性约束（V2.10 upsert），所以同工厂同产品只有 1 条 offer
- 如果分行导入已覆盖多配置场景，则 V20.0 结论是"无需改 schema"，路线图跳到 V21.0 模板引擎

## Script

### A. 同 model_no 多配置检测

写 `scripts/v20.0-price-config-audit.ts`，只读脚本：

**Part 1: model_no 前缀分组**

按品类分组统计 model_no 的前缀重复情况。前缀规则：去除末尾的功率/电压/驱动后缀（如 `-220V`、`-DOB`、`-90lm`）。

对每个前缀组（≥2 产品），检查组内产品的 voltage / driver_type 参数是否不同。如果是，说明已通过分行实现多配置。

输出：
```
同前缀多配置组总数: N
  其中 voltage 不同: N1
  其中 driver_type 不同: N2
  其中 efficacy 不同: N3
  前缀相同但参数也相同（纯重复/尺寸变体）: N4
```

**Part 2: 同产品多 offer 检测**

统计 `SELECT product_id, factory_name, COUNT(*) as cnt FROM supplier_offers GROUP BY product_id, factory_name HAVING cnt > 1`。

对每个多 offer 组，检查是否有配置区分（price 不同+参数不同）。

输出：
```
同产品同工厂多 offer 组: N（0 = 说明 upsert 已去重）
```

**Part 3: 抽样验证（3 个品类）**

抽样品类：球泡、投光灯、Highbay（这三个在报价汇总表中有明确的多 FOB 列）。

对每个品类：
- 列出所有 model_no 前缀分组（≥2 产品）
- 展示每组产品的 voltage/driver_type/efficacy 参数值
- 展示每个产品的 offer 价格
- 判断：该组是否已正确覆盖多配置报价？

### B. 报告

写到 `docs/v20.0-price-config-audit-report.md`：

```markdown
# V20.0 多配置价格审计报告

## 结论
（一句话：需要改 schema / 不需要改 schema / 部分品类需要补数据）

## Part 1: 同前缀多配置组
（统计数据）

## Part 2: 同产品多 offer
（统计数据）

## Part 3: 抽样验证
### 球泡
（前缀组列表 + 参数 + 价格）
### 投光灯
（同上）
### Highbay
（同上）

## 建议
（如需改 schema，具体方案；如不需要，跳到什么版本）
```

### C. 验证

- `npx tsc --noEmit` — 0 errors（脚本本身用 ts-node/tsx 运行即可，不需要编译到 Next.js）
- 脚本用 `npx tsx scripts/v20.0-price-config-audit.ts` 运行
- 不写 DB，不删数据，纯只读
