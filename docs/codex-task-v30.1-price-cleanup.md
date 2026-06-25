# V30.1: 价格异常清理 — 写数据库

## Goal

根据 V30.0 审计结果 + Claude 验收修正，删除 146 条错误 offer + 20 个孤儿产品。

## 前置条件

备份数据库：`cp prisma/dev.db backups/dev-before-v30.1-$(date +%Y%m%d-%H%M%S).sqlite`

## 操作清单

### Step 1: 删除 A1 电池=价格 offer（5 条）

```sql
DELETE FROM supplier_offers
WHERE factory_name = '中千'
  AND CAST(purchase_price AS REAL) IN (14500, 18650, 26700);
```

验证：删除 5 行。

### Step 2: 删除 A2 型号=价格 offer（65 条）

逐工厂删除。价格明显偏离同工厂正常范围。

```sql
-- 美莱德：正常中位价 16，异常价 1006-8118
DELETE FROM supplier_offers
WHERE factory_name = '美莱德' AND CAST(purchase_price AS REAL) > 1000;
-- 预期 21 行

-- 雄企：正常中位价 77，所有 QJ6870-* 价格 = 6870
DELETE FROM supplier_offers
WHERE factory_name = '雄企' AND CAST(purchase_price AS REAL) = 6870;
-- 预期 23 行

-- 进成：正常中位价 15，异常价 8211-8311
DELETE FROM supplier_offers
WHERE factory_name = '进成' AND CAST(purchase_price AS REAL) > 1000;
-- 预期 5 行

-- 优林：仅 4 条产品，全部是 model=price (8001-8004)
DELETE FROM supplier_offers
WHERE factory_name = '优林';
-- 预期 4 行

-- 汇盈聚：正常中位价 20，异常价 3870/6060
DELETE FROM supplier_offers
WHERE factory_name = '汇盈聚' AND CAST(purchase_price AS REAL) > 1000;
-- 预期 6 行

-- 博华 Raz 7182: model number in product name
DELETE FROM supplier_offers
WHERE factory_name = '博华' AND CAST(purchase_price AS REAL) = 7182;
-- 预期 1 行

-- 太阳能壁灯草坪灯 SL-G-P 系列: model=price
DELETE FROM supplier_offers
WHERE factory_name = '太阳能壁灯草坪灯'
  AND CAST(purchase_price AS REAL) > 1000;
-- 预期 5 行
```

总验证：65 行。

### Step 3: 删除 A3 规格=价格 offer（42 条）

**注意排除假阳性**：合力 "T80-A HIGH / 45W / T125\*228 / E27" price=125 是合法价格（该系列 30W=100, 40W=115, 45W=125, 50W=140, 70W=160，功率-价格梯度完整）。

按工厂逐批删除：

```sql
-- 合力：尺寸=价格的面板灯。排除 T80-A HIGH 系列。
-- 面板灯产品名包含 "明装" "暗装" "φ" 或 尺寸x尺寸 格式
DELETE FROM supplier_offers
WHERE factory_name = '合力'
  AND CAST(purchase_price AS REAL) >= 100
  AND id IN (
    SELECT so.id FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    WHERE so.factory_name = '合力'
      AND CAST(so.purchase_price AS REAL) >= 100
      AND p.product_name NOT LIKE 'T80-A%'
  );
-- 预期 18 行（23 合力 ≥100 的总数 - 5 个 T80-A HIGH）

-- 一群狼 FG 系列：FG-300/600/900/1200
DELETE FROM supplier_offers
WHERE factory_name = '一群狼'
  AND CAST(purchase_price AS REAL) IN (300, 600, 900, 1200)
  AND id IN (
    SELECT so.id FROM supplier_offers so
    JOIN products p ON p.id = so.product_id
    WHERE so.factory_name = '一群狼'
      AND p.product_name LIKE 'FG-%'
  );
-- 预期 4 行

-- 伊明特：D460/D370/D260 尺寸=价格
DELETE FROM supplier_offers
WHERE factory_name = '伊明特'
  AND CAST(purchase_price AS REAL) IN (460, 370, 260);
-- 预期 3 行

-- 伊特：1500W/1000W 瓦数=价格
DELETE FROM supplier_offers
WHERE factory_name = '伊特'
  AND CAST(purchase_price AS REAL) IN (1500, 1000);
-- 预期 2 行

-- 名威：CCT/尺寸=价格
DELETE FROM supplier_offers
WHERE factory_name = '名威'
  AND CAST(purchase_price AS REAL) IN (3000, 1222, 638, 124);
-- 预期 6 行

-- 宁波琦辉：CCT=价格
DELETE FROM supplier_offers
WHERE factory_name = '宁波琦辉' AND CAST(purchase_price AS REAL) = 3000;
-- 预期 1 行

-- 异形：CCT=价格
DELETE FROM supplier_offers
WHERE factory_name = '异形' AND CAST(purchase_price AS REAL) = 6500;
-- 预期 1 行

-- 新时达：尺寸=价格（对应英文名产品 price=23.5/27.8 证实）
DELETE FROM supplier_offers
WHERE factory_name = '新时达'
  AND CAST(purchase_price AS REAL) IN (595, 295);
-- 预期 2 行

-- 绿晟：CCT=价格
DELETE FROM supplier_offers
WHERE factory_name = '绿晟'
  AND CAST(purchase_price AS REAL) IN (6000, 3800, 2800);
-- 预期 3 行

-- 镜前灯-中山惠尔佳：内箱尺寸=价格
DELETE FROM supplier_offers
WHERE factory_name = '镜前灯-中山惠尔佳'
  AND CAST(purchase_price AS REAL) = 109;
-- 预期 1 行

-- 应急球泡：尺寸=价格
DELETE FROM supplier_offers
WHERE factory_name = '应急球泡'
  AND CAST(purchase_price AS REAL) = 325;
-- 预期 1 行 (此工厂其他记录在 Step 5 统一处理)
```

总验证：42 行。

### Step 4: 删除 A4 极端高价 offer（1 条）

```sql
DELETE FROM supplier_offers
WHERE factory_name = '凯晟德'
  AND CAST(purchase_price AS REAL) > 10000;
-- 预期 1 行 (TR-R1 100W at 238024)
```

### Step 5: 删除 A5 price=0 offer + 应急球泡全工厂清理

**重要**：A5 只删 offer，不删产品（这些产品有其他工厂的合法报价）。

```sql
-- A5: 凯晟德 price=0 垃圾 offer
DELETE FROM supplier_offers
WHERE factory_name = '凯晟德' AND CAST(purchase_price AS REAL) = 0;
-- 预期 8 行

-- A5: 普照 ABS price=0
DELETE FROM supplier_offers
WHERE factory_name = '普照' AND CAST(purchase_price AS REAL) = 0;
-- 预期 1 行

-- 应急球泡：全工厂所有 offer（24 条，全部 watt=price 或 dim=price）
-- 其中 325*125*135MM 已在 Step 3 删除 1 条，剩余 23 条
DELETE FROM supplier_offers
WHERE factory_name = '应急球泡';
-- 预期 23 行（325 那条已在 Step 3 删掉）
```

注意：Step 3 已删 1 条应急球泡，这里删剩余 23 条。如果脚本按顺序执行，应先 Step 3 再 Step 5。如果合并执行，应急球泡总共 24 条。

### Step 6: 清理孤儿产品

删除应急球泡 offer 后，20 个产品变成孤儿（无其他工厂 offer、无 quote_items 引用）。需删除其 product_params 和 products。

```sql
-- 先删 product_params
DELETE FROM product_params
WHERE product_id IN (
  SELECT id FROM products
  WHERE id NOT IN (SELECT product_id FROM supplier_offers)
    AND id NOT IN (SELECT product_id FROM quote_items)
);

-- 再删孤儿 products
DELETE FROM products
WHERE id NOT IN (SELECT product_id FROM supplier_offers)
  AND id NOT IN (SELECT product_id FROM quote_items);
```

注意：这个 SQL 会清理所有无 offer 且无 quote_item 的产品，不仅仅是应急球泡。如果数据库中本来就有其他孤儿产品，也会一并清理。这是安全的——没有 offer 也没有 quote_item 引用的产品就是无用数据。

## 实现

写 `scripts/v30.1-price-cleanup.ts`。

结构：
1. 备份数据库
2. 按 Step 1-6 顺序执行，每步打印实际删除行数
3. 汇总前后 offer/product/product_params 总数
4. 写报告到 `docs/v30.1-price-cleanup-report.md`

```typescript
// 伪代码框架
async function main() {
  backup();
  
  const before = await getCounts(); // offers, products, product_params
  
  // Step 1-5: 按上面 SQL 逐步执行，用 prisma.$executeRawUnsafe
  // 每步记录 affected rows
  
  // Step 6: 清理孤儿
  
  const after = await getCounts();
  
  writeReport({
    before, after,
    steps: [
      { name: 'A1 电池=价格', expected: 5, actual: step1Count },
      { name: 'A2 型号=价格', expected: 65, actual: step2Count },
      { name: 'A3 规格=价格', expected: 42, actual: step3Count },
      { name: 'A4 极端高价', expected: 1, actual: step4Count },
      { name: 'A5 price=0', expected: 9, actual: step5aCount },
      { name: '应急球泡全清', expected: 23, actual: step5bCount },
      { name: '孤儿 product_params', expected: '~100', actual: step6aCount },
      { name: '孤儿 products', expected: '~20', actual: step6bCount },
    ]
  });
}
```

## 报告格式

```markdown
# V30.1 价格异常清理报告

## 备份
路径: backups/dev-before-v30.1-{timestamp}.sqlite

## 执行结果

| 步骤 | 预期 | 实际 | 状态 |
|------|------|------|------|
| A1 电池=价格 | 5 | N | ✓/✗ |
| A2 型号=价格 | 65 | N | ✓/✗ |
| A3 规格=价格 | 42 | N | ✓/✗ |
| A4 极端高价 | 1 | N | ✓/✗ |
| A5 price=0 | 9 | N | ✓/✗ |
| 应急球泡 | 23 | N | ✓/✗ |
| 孤儿 params | ~100 | N | |
| 孤儿 products | ~20 | N | |

## 数据库变化

| 指标 | 清理前 | 清理后 | 变化 |
|------|--------|--------|------|
| supplier_offers | N | N | -N |
| products | N | N | -N |
| product_params | N | N | -N |

## 抽检样本
(脚本应输出每步删除的前 5 条记录的 product_name + factory_name + price)
```

## 验证

```bash
npx tsc --noEmit
npx tsx scripts/v30.1-price-cleanup.ts
```

## 不要做

- 不动 B 类工厂名（留给 V30.2）
- 不动 C 类 sub-1 RMB（已确认多数合法）
- 不删合力 "T80-A HIGH / 45W / T125*228 / E27"（假阳性，真实价格）
- 不删有其他工厂合法 offer 的产品（只删 offer）
- 不修改 src/ 文件
