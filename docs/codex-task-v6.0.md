# V6.0：48W model_no 碰撞拆分

## 背景

产品 `b900170d-8a08-4ade-b76e-e82318d37555`（model_no="48W", category="面板灯"）挂了 11 个不同工厂的 offer，跨 7 个品类。V2.19G 审计已确认拆分方案：4 个 offer 留在面板灯，7 个 offer 迁到各自品类的新产品。

审计报告：`docs/v2.19g-data-quality-audit.md` Part D。

## 安全确认（已验证）

- quote_items 引用：0
- customer_quote_rows 匹配：0
- product_params：7 条，属于面板灯，留在原产品不动
- price_history：FK 在 supplier_offer_id 上，跟着 offer 走，无需手动迁移

## 要求

写 `scripts/v6.0-48w-split.ts`，支持 `--dry-run`（默认）和 `--apply` 两种模式。

### Step 0：备份 + 前置检查

- `--apply` 模式下先 `cp prisma/dev.db backups/dev-before-v6.0-{timestamp}.sqlite`
- 确认产品 `b900170d-...` 存在且有 11 个 offer
- 列出 11 个 offer 的 factory_name、price、currency、source_file_id

### Step 1：创建 6 个新产品

按品类分组，每个品类一个新产品：

| 新品类 | 要迁移的 offer（factory_name） |
|---|---|
| 吸顶灯 | 中山呈明 |
| 球泡 | 合力 |
| 灯管 | 鑫盟泰 |
| 净化灯 | 宏硕 |
| 三防灯 | 普照 |
| 线条灯 | 锐晶 |
| 磁吸灯 | 鹏荣202410 |

**注意**：V2.19G 审计把鑫盟泰归为"球泡"（按路径 `光源/球泡灯管/`），但源文件名是 `T8玻璃灯管系列价格表`，应为灯管。

新产品字段：
- `id`：uuid v4
- `model_no`："48W"
- `product_name`："48W"
- `category`：目标品类
- `image_path`：null
- `created_at` / `updated_at`：now

### Step 2：迁移 7 个 offer

UPDATE 每个 offer 的 `product_id` 指向 Step 1 创建的对应新产品。

匹配 offer 用 `factory_name` 精确匹配（值已在审计报告中确认）：
- "中山呈明" → 吸顶灯新产品
- "合力" → 球泡新产品
- "鑫盟泰" → 灯管新产品
- "宏硕" → 净化灯新产品
- "普照" → 三防灯新产品
- "锐晶" → 线条灯新产品
- "鹏荣202410" → 磁吸灯新产品

### Step 3：后置审计

验证并输出：
- 原产品剩余 4 个 offer（一群狼、凯益德、景上、瑞鑫）
- 7 个新产品各有正确数量的 offer（球泡和灯管各 1 个，其余各 1 个）
- price_history 仍然正确链接（count 不变）
- 全局 products 数量 = 10032 + 7 = 10039
- 全局 offers 数量 = 11084（不变）
- 全局 params 数量 = 37433（不变）

### 输出

- 报告写入 `docs/v6.0-48w-split-report.md`
- `--dry-run` 模式输出"将会做什么"但不写 DB
- `--apply` 模式执行后输出实际结果

## 验证

- `npx tsc --noEmit --pretty false` 通过
- `npm run build` 通过
- 脚本 `--dry-run` 输出正确的拆分计划
- 脚本 `--apply` 后 DB 数据正确

## 不做

- 不处理其他 47 组通用 model_no 碰撞（V6.1 再处理）
- 不修改 product_params（留在原面板灯产品）
- 不修改 price_history（FK 在 offer 上，自动跟随）
- 不触碰 customer_quote_rows
