# V31.4: 删除"未知"工厂数据

## 问题
32 条 supplier_offers 的 factory_name 为"未知"，来自无法确认工厂的文件。关联的产品多为垃圾数据（如 model_no="1."）。

## 步骤

### 1. 备份数据库
```bash
cp prisma/dev.db prisma/dev.db.bak-v31.4
```

### 2. 用 sqlite3 执行清理

```bash
sqlite3 prisma/dev.db <<'SQL'
-- 删除 price_history 关联
DELETE FROM price_history WHERE offer_id IN (
  SELECT id FROM supplier_offers WHERE factory_name = '未知'
);

-- 删除 offers
DELETE FROM supplier_offers WHERE factory_name = '未知';

-- 删除因此变成零 offer 的产品（及其 params）
DELETE FROM product_params WHERE product_id IN (
  SELECT p.id FROM products p
  LEFT JOIN supplier_offers so ON so.product_id = p.id
  WHERE so.id IS NULL
);
DELETE FROM products WHERE id IN (
  SELECT p.id FROM products p
  LEFT JOIN supplier_offers so ON so.product_id = p.id
  WHERE so.id IS NULL
);
SQL
```

### 3. 写报告到 `docs/v31.4-unknown-factory-report.md`

报告内容：
- 删除前 offer 总数、产品总数
- 删除了多少 offer、多少产品
- 删除后 offer 总数、产品总数

### 4. 验证
```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM supplier_offers WHERE factory_name = '未知';"
# 期望：0
```

## 不做
- 不改代码
- 不改 schema
- 不删除其他数据
