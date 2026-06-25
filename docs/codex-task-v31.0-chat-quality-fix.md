# V31.0: Chat 体验修复（代码 + 数据）

## 背景

Chat 功能上线测试发现三类问题：
1. 光效筛选返回 0 结果（数据库实际有 38 条匹配）——DeepSeek 可能未传结构化参数
2. 工厂名显示为源文件名（317 条 supplier_offers）
3. 垃圾产品名（spec/header 误读为产品，20 条）

## 前置条件

- 备份数据库：`cp prisma/dev.db backups/dev-pre-v31.0.db`

## Part A：工具调用日志 + System Prompt 优化（代码）

### A1. 工具调用日志

文件：`src/app/chat/actions.ts`

在 `for (const toolCall of message.tool_calls)` 循环里，`executeChatTool` 调用前后各加一行 console.log：

```typescript
// 调用前
console.log(`[CHAT-TOOL] call: ${toolCall.function.name}`, args);
// 调用后
console.log(`[CHAT-TOOL] result: ${toolCall.function.name}`, JSON.stringify(result.data).slice(0, 200));
```

### A2. System Prompt 增加参数提取引导

文件：`src/lib/deepseek.ts`

在 CHAT_SYSTEM_PROMPT 的"规则"部分追加：

```
7. 当用户提到数值范围（如"光效超过100"、"功率10到20W"、"显色指数90以上"），必须使用对应的工具参数（min_efficacy、min_watts/max_watts、cri等），不要把数值放在 query 文本里。
8. 对比价格时优先使用 compare_factories 工具，它能按工厂分组返回价格区间。
```

## Part B：文件名工厂修复（数据，SQL 脚本）

创建 `scripts/v31.0-chat-quality-fix.ts`，使用 sqlite3 直接执行以下 SQL。

### B1. 可提取工厂名（141 条）

```sql
UPDATE supplier_offers SET factory_name = '玲玲发'
WHERE factory_name = '玲玲发 核算！-PP筒灯价格对比 20250912.xlsx';
-- 预期 101 行

UPDATE supplier_offers SET factory_name = '牛志'
WHERE factory_name = '塑料壁灯 (1)牛志 202504 刘林给.xlsx';
-- 预期 40 行
```

### B2. Wellux 内部核价文件（144 条）

这些是用户自有品牌的内部核价文件，factory_name 应为 "Wellux"：

```sql
UPDATE supplier_offers SET factory_name = 'Wellux'
WHERE factory_name = '出中东款核价Wellux Quotation of led panel 2020-10-8.xlsx';
-- 预期 75 行

UPDATE supplier_offers SET factory_name = 'Wellux'
WHERE factory_name = '核价wellux quotation of led worklight 20230907 (1).xls';
-- 预期 41 行

UPDATE supplier_offers SET factory_name = 'Wellux'
WHERE factory_name = '核价- WELLUX FAN CEILING LAMP QUOTATION -2025.10.13 (3).xlsx';
-- 预期 24 行

UPDATE supplier_offers SET factory_name = 'Wellux'
WHERE factory_name = '核价Wellux Quotation of led solar wall light 20231027.xlsx';
-- 预期 4 行
```

### B3. 不可提取工厂名（32 条）

```sql
UPDATE supplier_offers SET factory_name = '(未知工厂)'
WHERE factory_name = 'LED G9&R7S 核价2021.7.19.xlsx';
-- 预期 22 行

UPDATE supplier_offers SET factory_name = '(未知工厂)'
WHERE factory_name = '防眩光筒灯含税报价3.16.xls';
-- 预期 9 行

UPDATE supplier_offers SET factory_name = '(未知工厂)'
WHERE factory_name = '刘林姐给COB深防眩筒灯报价单 铁皮的 含税加10%.xlsx';
-- 预期 1 行
```

## Part C：垃圾产品清理（数据，SQL 脚本）

以下 20 个产品名是 spec/header 误读为产品，每个只有 1 条报价，无其他工厂报价。
删除顺序：product_params → supplier_offers → products。

### C1. 垃圾产品 ID 列表

先查出 ID：
```sql
SELECT id FROM products WHERE product_name IN (
  'Product Name', 'Voltage （V）', 'AC:165-265V', '3k-65k',
  '230mm','210mm','200mm','175mm','160mm','155mm','140mm',
  '8mm','10MM','0.25MM','0.14MM','0.2MM','10mm','12mm','6.8mm','11mm'
);
```

### C2. 删除

```sql
DELETE FROM product_params WHERE product_id IN (上述 ID 列表);
DELETE FROM supplier_offers WHERE product_id IN (上述 ID 列表);
DELETE FROM products WHERE id IN (上述 ID 列表);
```

预期删除：20 products, 20 offers, N params。

## 验证

脚本执行后输出报告到 `docs/v31.0-chat-quality-fix-report.md`：

```
## 结果

### Part A: 代码修改
- [ ] chat actions.ts 增加工具调用日志（2 行 console.log）
- [ ] deepseek.ts system prompt 增加 2 条规则

### Part B: 工厂名修复
- 玲玲发: X/101 行
- 牛志: X/40 行
- Wellux: X/144 行
- (未知工厂): X/32 行
- 验证: SELECT COUNT(*) FROM supplier_offers WHERE factory_name LIKE '%.xls%' → 应为 0

### Part C: 垃圾产品清理
- 删除 products: X/20
- 删除 offers: X/20
- 删除 params: X

### 最终数据库状态
- SELECT COUNT(*) FROM products → ?
- SELECT COUNT(*) FROM supplier_offers → ?
- SELECT COUNT(*) FROM product_params → ?
```

## 已知异常（本次不处理）

恒百利"三件套 海萊款筒灯"系列：3W-30W 全部 120 RMB/MOQ 3000PCS。
全瓦段统价不符合常理但不能确认是错误（可能是套件体价格），留待人工复核。

## 约束

- 不修改源 Excel 文件
- 不 STOP 等确认，一次跑完
- 报告写到 docs/ 文件
