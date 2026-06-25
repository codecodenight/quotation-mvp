# V30.2: 工厂名修正 — 高置信度批次

## Goal

修正 supplier_offers 中工厂名为文件名或品类名的记录，仅限人工确认映射关系的高置信度子集。预计修正 ~423 条。

## 前置条件

备份数据库：`cp prisma/dev.db backups/dev-before-v30.2-$(date +%Y%m%d-%H%M%S).sqlite`

## 修正映射表

所有 UPDATE 通过 `source_file_id` JOIN `files` 表匹配源文件名，确保精确对应。

### Group A: 太阳能壁灯草坪灯 → 真实工厂名（按源文件推断）

当前 factory_name = '太阳能壁灯草坪灯'，按 source_file_id 对应的 file_name 分组：

| 源文件 file_name 匹配 | → 修正为 | 预期条数 |
|----------------------|---------|---------|
| `%博登%` | 博登 | 87 |
| `%巨鑫%` | 巨鑫 | 65 |
| `%羽成%` | 羽成 | 66 |
| `%欣益进%` | 欣益进 | 24 |
| `%精友%` | 精友 | 4 |
| `%晟高%` | 晟高 | 1 |
| **小计** | | **247** |

```sql
UPDATE supplier_offers SET factory_name = '博登'
WHERE factory_name = '太阳能壁灯草坪灯'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%博登%');

UPDATE supplier_offers SET factory_name = '巨鑫'
WHERE factory_name = '太阳能壁灯草坪灯'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%巨鑫%');

UPDATE supplier_offers SET factory_name = '羽成'
WHERE factory_name = '太阳能壁灯草坪灯'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%羽成%');

UPDATE supplier_offers SET factory_name = '欣益进'
WHERE factory_name = '太阳能壁灯草坪灯'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%欣益进%');

UPDATE supplier_offers SET factory_name = '精友'
WHERE factory_name = '太阳能壁灯草坪灯'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%精友%');

UPDATE supplier_offers SET factory_name = '晟高'
WHERE factory_name = '太阳能壁灯草坪灯'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%晟高%');
```

### Group B: 文件名=工厂名 → 真实工厂名（从 factory_name 自身提取）

这些记录的 factory_name 就是文件名，可从中提取工厂名：

| factory_name 匹配 | → 修正为 | 预期条数 |
|------------------|---------|---------|
| `科蒲尔%` | 科蒲尔 | 31 |
| `优泽%` | 优泽 | 12 |
| `瑞雪%` | 瑞雪 | 12 |
| `凯益德%` | 凯益德 | 10 |
| `名威 支架%` | 名威 | 3 |
| `NOVA%名威%` | 名威 | 1 |
| **小计** | | **69** |

```sql
UPDATE supplier_offers SET factory_name = '科蒲尔'
WHERE factory_name LIKE '科蒲尔%' AND factory_name != '科蒲尔';

UPDATE supplier_offers SET factory_name = '优泽'
WHERE factory_name LIKE '优泽%' AND factory_name != '优泽';

UPDATE supplier_offers SET factory_name = '瑞雪'
WHERE factory_name LIKE '瑞雪%' AND factory_name != '瑞雪';

UPDATE supplier_offers SET factory_name = '凯益德'
WHERE factory_name LIKE '凯益德%' AND factory_name != '凯益德';

UPDATE supplier_offers SET factory_name = '名威'
WHERE factory_name LIKE '名威 支架%';

UPDATE supplier_offers SET factory_name = '名威'
WHERE factory_name LIKE 'NOVA%名威%';
```

### Group C: 混合匹配 — factory_name + source_file 联合定位

| factory_name | 源文件 file_name 匹配 | → 修正为 | 预期条数 |
|-------------|---------------------|---------|---------|
| `广交会最终核价` | `%华浦%` | 华浦 | 21 |
| `广交会最终核价` | `%汇孚%` | 汇孚 | 66 |
| `核价 发客户` | `%巨登%` | 巨登 | 11 |
| `sample data` | `%汇孚%` | 汇孚 | 9 |
| **小计** | | | **107** |

```sql
UPDATE supplier_offers SET factory_name = '华浦'
WHERE factory_name = '广交会最终核价'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%华浦%');

UPDATE supplier_offers SET factory_name = '汇孚'
WHERE factory_name = '广交会最终核价'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%汇孚%');

UPDATE supplier_offers SET factory_name = '巨登'
WHERE factory_name = '核价 发客户'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%巨登%');

UPDATE supplier_offers SET factory_name = '汇孚'
WHERE factory_name = 'sample data'
  AND source_file_id IN (SELECT id FROM files WHERE file_name LIKE '%汇孚%');
```

## 实现

写 `scripts/v30.2-factory-name-fix.ts`。

结构：
1. 备份数据库
2. 记录修正前状态：每个异常 factory_name 的条数
3. 按 Group A → B → C 顺序执行 UPDATE，每步记录 affected rows
4. 记录修正后状态：异常 factory_name 剩余条数
5. 抽检：每个修正组取前 3 条，显示 product_name + 旧工厂名 + 新工厂名 + 源文件名
6. 写报告

## 报告格式

写到 `docs/v30.2-factory-name-fix-report.md`：

```markdown
# V30.2 工厂名修正报告

## 备份
路径: backups/dev-before-v30.2-{timestamp}.sqlite

## 执行结果

| 组 | 映射 | 预期 | 实际 | 状态 |
|----|------|------|------|------|
| A | 太阳能壁灯草坪灯→博登 | 87 | N | ✓/✗ |
| A | 太阳能壁灯草坪灯→巨鑫 | 65 | N | ✓/✗ |
| ... | | | | |

## 修正前后对比

| 异常 factory_name | 修正前条数 | 修正后条数 | 变化 |
|-------------------|----------|----------|------|
| 太阳能壁灯草坪灯 | N | N | -N |
| 广交会最终核价 | N | N | -N |
| ... | | | |

## 抽检样本
(每组前 3 条)
```

## 验证

```bash
npx tsc --noEmit
npx tsx scripts/v30.2-factory-name-fix.ts
```

## 不动的记录（~722 条，留待后续人工处理）

以下 factory_name 的记录本次不修改，因为无法从文件名确定真实工厂：

- `太阳能壁灯草坪灯` 来自 Wellux/Welfull 核价文件（~141 条）
- `玲玲发 核算！-PP筒灯价格对比 20250912.xlsx`（101 条）
- `出中东款核价Wellux Quotation...`（75 条）
- `核价wellux quotation...` 系列（~92 条）
- `塑料壁灯 (1)牛志 202504 刘林给.xlsx`（40 条）
- `跨境产品`（142 条）
- `sample data` 非汇孚来源（74 条）
- `LED G9&R7S 核价`（22 条）
- 其他小组合（~35 条）

这些记录的真实工厂名需要打开源 Excel 文件从内容中查找。

## 不要做

- 不修改 src/ 文件
- 不修改价格数据
- 不修改 Welfull/Wellux factory_name 记录（需用户确认这些是否应保留）
- 对无法确认的映射不做猜测
