# V2.26：超长 model_no 清理

## 背景

15 个产品的 `model_no` 超过 200 字符（最长 429 字符），实际内容是完整规格文本被粘贴到了型号字段。全部 15 个产品的 `product_name == model_no`（相同的长文本）。

来源：
- 12 个来自「副本博登报价单2025年8月.xls」（太阳能壁灯草坪灯工厂，太阳能壁灯品类）
- 2 个来自「欣益进系列报价2023-05.xlsx」（太阳能壁灯草坪灯工厂，太阳能壁灯品类）
- 1 个来自「汇孚画册+广交会灯带选品核价_137th+138th.xlsx」（广交会最终核价工厂，灯带品类）

根因：源 Excel 文件中没有独立的"型号"列，导入时把整个规格描述行当作了 model_no。

## 要求

写 `scripts/v2.26-long-model-cleanup.ts`，支持 `--dry-run`（默认）和 `--apply`。

### Step 0：备份（仅 --apply）

```
cp prisma/dev.db backups/dev-before-v2.26-{timestamp}.sqlite
```

### Step 1：生成简短 model_no

对每个目标产品（`LENGTH(model_no) > 200`），按以下规则生成新 model_no：

1. 从 `product_params` 中提取 `watts` 参数的 `normalized_value`（如 `15`）
2. 用 `factory_name`（来自第一条 offer）作为前缀
3. 拼接格式：`{factory_short}-{category_code}-{watts}W-{序号}`
   - factory_short：取工厂名前 2 个汉字（如 `博登`→`博登`、`欣益`→`欣益`、`汇孚`→`汇孚`）
   - category_code：太阳能壁灯→`SWL`、灯带→`STR`
   - 序号：同工厂同品类内去重用（从 1 开始）
4. 如果没有 watts 参数，用 `{factory_short}-{category_code}-{序号}`

### Step 2：迁移规格文本

1. 如果 `remark` 为 NULL 或空：将当前 `model_no`（长文本）写入 `remark`
2. 如果 `remark` 已有值：保留原 remark 不变（长文本已在 product_name 中保留）
3. 更新 `model_no` 为 Step 1 生成的简短值
4. `product_name` 保持不变（保留原始规格文本，用于搜索命中）

### Step 3：检查唯一性

确保新生成的 `model_no` 不与现有产品的 `model_no`（同品类内）冲突。如有冲突，递增序号。

### Step 4：报告

输出到 `docs/v2.26-long-model-report.md`：

| ID | 工厂 | 品类 | 旧 model_no 长度 | 新 model_no | remark 是否更新 |
|---|---|---|---|---|---|

## 目标产品列表

共 15 个（`SELECT id FROM products WHERE LENGTH(model_no) > 200`）：

| ID | 品类 | 工厂 | 当前 model_no 长度 |
|---|---|---|---:|
| c51758e0 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 429 |
| 23e332fe | 太阳能壁灯 | 太阳能壁灯草坪灯(欣益进) | 406 |
| a26610d9 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 314 |
| 8843de82 | 太阳能壁灯 | 太阳能壁灯草坪灯(欣益进) | 297 |
| e10616be | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 286 |
| ffae177c | 灯带 | 广交会最终核价(汇孚) | 281 |
| f31be45a | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 257 |
| 644b8567 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 251 |
| 8ab280e6 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 236 |
| 21c20aeb | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 233 |
| d2bf0f73 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 232 |
| e02c2453 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 224 |
| 7eb3819f | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 220 |
| 3e4b5a61 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 210 |
| 8c9df162 | 太阳能壁灯 | 太阳能壁灯草坪灯(博登) | 205 |

## 验证

- `npx tsc --noEmit --pretty false` 通过
- dry-run 不改 DB
- apply 后 `SELECT COUNT(*) FROM products WHERE LENGTH(model_no) > 200` = 0
- 所有目标产品的 remark 不为空（或原本就有 remark 的保持不变）
- 新 model_no 在同品类内唯一

## 不做

- 不动 product_params
- 不动 supplier_offers
- 不改 product_name（保留用于全文搜索）
- 不处理 model_no 在 100-200 字符范围的产品（本次只清理 >200）
