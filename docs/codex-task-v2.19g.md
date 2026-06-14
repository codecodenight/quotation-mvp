# Codex Task: V2.19G — 数据质量遗留收口审计

## 目标

对 V2.19F 遗留的全部数据异常做一次只读审计，输出结论文档。**不修 DB、不删数据**。每条异常标记为：待人工补价 / 保留 / 不处理 / 需单独拆分。

## 背景

V2.19F 修了能自动修的部分，但留下了三类尾巴：

1. **尼奥灯带 3 条无源价格**：源 Excel 对应行没有独立价格列，V2.19F 按安全边界跳过
2. **瑞鑫面板灯 4 条 audit-only**：36/40W（有图）、PP0.7/0.8/1.0（有 params），V2.19F 仅记录未处理
3. **欧诺面板灯 2 条 audit-only**：圆形/方形，形状标签做 product_name
4. **48W model_no 碰撞**：11 个工厂的 offer 挂在同一个 model_no="48W" 产品上，来源文件跨品类

## 脚本：`scripts/data-quality-audit-v2.19g.ts`（新建）

### 命令行

```bash
npx tsx scripts/data-quality-audit-v2.19g.ts
```

只读，无 `--fix` 模式。

### 输出

`docs/v2.19g-data-quality-audit.md`

---

## 四个 Part 的审计内容

### Part A: 尼奥灯带 3 条无源价格

查询当前状态：

```sql
SELECT p.id, p.model_no, p.product_name, so.purchase_price, so.id as offer_id,
       p.image_path IS NOT NULL as has_image,
       (SELECT COUNT(*) FROM product_params pp WHERE pp.product_id = p.id) as param_count,
       (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) as quote_refs
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '灯带'
  AND so.factory_name = '尼奥'
  AND p.model_no IN (
    'LST-110/220V-NW-2835-180',
    'LST-110/220V-NW-COB-240免驱',
    'LST-110/220V-NW-COB-288免驱'
  )
```

对每条输出：
- 当前错误价格
- 有无图片、params、quote_items 引用
- 是否有其他工厂的 offer（如果有，那个 offer 的价格是否正常）
- 结论：`待人工补价` — 产品本身是真产品（有图片/params），但价格是芯片型号/灯珠数，源 Excel 无法自动提取正确价格，需要人工从工厂询价或查其他报价文件

### Part B: 瑞鑫面板灯 4 条 audit-only

查询：

```sql
SELECT p.id, p.model_no, p.product_name, so.purchase_price, so.id as offer_id,
       p.image_path IS NOT NULL as has_image,
       p.remark,
       (SELECT COUNT(*) FROM product_params pp WHERE pp.product_id = p.id) as param_count,
       (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) as quote_refs,
       (SELECT COUNT(*) FROM supplier_offers so2 WHERE so2.product_id = p.id) as total_offers
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.category = '面板灯'
  AND so.factory_name = '瑞鑫'
  AND p.model_no IN ('36/40W', 'PP0.7', 'PP0.8', 'PP1.0')
```

对每条判定：
- **36/40W**：有图片，price=36 可能是 wattage 当价格。如果 remark 或 params 中有真实价格线索 → 标 `待人工补价`，否则 → `保留`（有图片，不轻易删）
- **PP0.7/PP0.8/PP1.0**：无图片但有 6 params each。查看 params 是否有实质内容（watts/size 等）。如果 params 有意义 → `保留`（可能是瑞鑫的导光板/扩散板材料规格变体）；如果 params 只有从 model_no 推测的空壳 → `不处理`（可以后续清理但不紧急）

### Part C: 欧诺面板灯 2 条 audit-only

查询：

```sql
SELECT p.id, p.model_no, p.product_name, so.purchase_price, so.currency, so.id as offer_id,
       p.image_path IS NOT NULL as has_image,
       p.remark,
       (SELECT COUNT(*) FROM product_params pp WHERE pp.product_id = p.id) as param_count,
       (SELECT COUNT(*) FROM quote_items qi WHERE qi.product_id = p.id) as quote_refs,
       (SELECT COUNT(*) FROM supplier_offers so2 WHERE so2.product_id = p.id) as total_offers,
       f.file_name
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
LEFT JOIN files f ON so.source_file_id = f.id
WHERE p.category = '面板灯'
  AND p.model_no IN ('圆形', '方形')
  AND so.factory_name LIKE '%欧诺%'
```

判定：
- 圆形/方形是形状标签做 product_name，但 V2.19F 审计发现源文件（塑料面板灯报价单）中这两行有真实的 RMB 价格（2.80/4.50 等）。如果当前 price 合理 → `保留`（product_name 不好但价格可能正确）
- 如果 product 有其他工厂 offer → 记录

### Part D: 48W model_no 碰撞

这是最重要的部分。查询：

```sql
-- 48W 产品的全部 offer
SELECT p.id as product_id, p.model_no, p.product_name, p.category,
       p.image_path IS NOT NULL as has_image, p.remark,
       so.id as offer_id, so.factory_name, so.purchase_price, so.currency,
       so.moq, so.ctn_qty,
       f.file_name, f.relative_path
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
LEFT JOIN files f ON so.source_file_id = f.id
WHERE p.model_no = '48W' AND p.category = '面板灯'
ORDER BY so.factory_name

-- 各 offer 的源文件品类
-- （从 relative_path 提取品类关键词）

-- quote_items 引用
SELECT qi.id, qi.quote_id, qi.purchase_price, q.created_at
FROM quote_items qi
JOIN quotes q ON qi.quote_id = q.id
WHERE qi.product_id = (SELECT id FROM products WHERE model_no = '48W' AND category = '面板灯')
```

对 48W 碰撞的分析：
1. 列出全部 11 个 offer，标注每个 offer 的来源文件和品类
2. 按 relative_path 判断每个 offer 实际属于哪个品类（面板灯/球泡/净化灯/三防灯/磁吸灯/灯管/...）
3. 判断哪些 offer 真正属于面板灯品类的 48W 产品
4. 标记需要拆分的 offer（属于其他品类但因 model_no 碰撞挂到了面板灯 48W 上）
5. 结论：`需单独拆分` — 给出具体拆分方案（哪些 offer 应该移到各自品类的独立产品上）

同时检查是否还有其他类似的通用 model_no 碰撞（如 `3W`、`5W`、`12W`、`15W` 等纯瓦数 model_no）：

```sql
SELECT p.model_no, p.category, COUNT(DISTINCT so.factory_name) as factory_count
FROM products p
JOIN supplier_offers so ON so.product_id = p.id
WHERE p.model_no REGEXP '^[0-9]+W$'
GROUP BY p.model_no, p.category
HAVING factory_count >= 3
ORDER BY factory_count DESC
```

如果 SQLite 不支持 REGEXP，用 GLOB：

```sql
WHERE p.model_no GLOB '[0-9]*W'
  AND p.model_no NOT GLOB '*[a-zA-Z]*W'
  AND p.model_no NOT GLOB '*-*'
```

---

## 报告格式

```markdown
# V2.19G — 数据质量遗留收口审计

Generated: {timestamp}
Mode: read-only audit (no DB changes)

## 总结

| Part | 异常项 | 待人工补价 | 保留 | 不处理 | 需拆分 |
|---|---:|---:|---:|---:|---:|

## Part A: 尼奥灯带无源价格

（每条一行，含结论和理由）

## Part B: 瑞鑫面板灯 audit-only

（每条一行，含结论和理由）

## Part C: 欧诺面板灯 audit-only

（每条一行，含结论和理由）

## Part D: 48W model_no 碰撞

### 48W 全部 Offer

（11 行表格）

### 来源品类分析

（每个 offer 按 relative_path 判定的实际品类）

### 拆分方案

（具体说明哪些 offer 应移到哪个品类的哪个产品）

### 其他通用 model_no 碰撞

（如有，列出 model_no + category + factory_count）

## 行动建议

（按优先级排列的后续操作建议）
```

---

## 执行步骤

### Step 1: 创建脚本

新建 `scripts/data-quality-audit-v2.19g.ts`，纯只读查询。

### Step 2: 运行

```bash
npx tsx scripts/data-quality-audit-v2.19g.ts
```

### Step 3: 验证

```bash
npx tsc --noEmit --pretty false
```

确认脚本没有写 DB（可以用 `sqlite3 prisma/dev.db "SELECT COUNT(*) FROM products"` 对比前后）。

### Step 4: 提交

```bash
git add scripts/data-quality-audit-v2.19g.ts docs/v2.19g-data-quality-audit.md
git commit -m "V2.19G: data quality residual audit — 尼奥/瑞鑫/欧诺/48W碰撞"
```

## 验收标准

1. 报告涵盖全部 4 个 Part
2. 每条异常有明确结论标签（待人工补价/保留/不处理/需拆分）
3. 48W 碰撞分析列出全部 11 个 offer 的来源品类
4. 检查是否存在其他通用 model_no 碰撞
5. 脚本不写 DB
6. `tsc --noEmit` 通过

## 不做的事

- 不修改 DB
- 不删除任何记录
- 不做拆分操作（只输出拆分方案）
- 不修改 schema
