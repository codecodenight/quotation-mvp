# V5.4：客户名规范化 + 同产品历史售价

## 背景

`customer_quote_files` 398 条记录中仅 79 条（20%）有 `customer_name`。已有的 16 个客户名存在大小写重复（DENI / Deni）。另外 319 条无客户名的记录中，大多是 "核价" 内部定价文件，本身没有客户信息。

`customer_quote_rows` 2,903 行已匹配到 887 个产品。当用户展开一行查看详情时，看不到同一产品的其他历史报价，无法判断价格趋势。

本任务两个部分：
- **Part A**：脚本规范化客户名
- **Part B**：/customer-quotes 页面展开行增加"同产品报价记录"

## Part A：客户名规范化脚本

写 `scripts/v5.4-customer-normalize.ts`，支持 `--dry-run`（默认）和 `--apply`。

### Step 0：备份（仅 --apply）

```
cp prisma/dev.db backups/dev-before-v5.4-{timestamp}.sqlite
```

### Step 1：大小写合并

查找 `customer_name` 相同但大小写不同的记录，统一为 Title Case（首字母大写）。

已知案例：`DENI` / `Deni` → `Deni`，`AFRATAB` → `Afratab`。

规则：全大写名字转 Title Case；已混合大小写的保持不变（如 `Vision Energy` 已正确）。

### Step 2：从文件名补提客户名

对 `customer_name IS NULL OR customer_name = ''` 的记录，尝试从 `file_name` 提取客户名：

1. 模式 `给{customer}客户`：如 "核价 ... 给南美客户 汇总.xls" → `南美客户`
2. 模式 `To {customer} -`：应该已在 V5.0B 提取，此步做兜底
3. 模式 `to {customer} -`（小写 to）：兜底

不匹配以上模式的记录保持 NULL（多数是 "核价..." 内部文件，确实没有客户名）。

### Step 3：报告

输出到 `docs/v5.4-customer-normalize-report.md`：

- Before/After 覆盖率（有客户名的记录数/占比）
- 合并的大小写变更列表
- 新提取的客户名列表
- 最终客户名列表（name + 记录数）

### 验证

- dry-run 不改 DB
- apply 后 `customer_quote_files` 总数不变
- 无新增/删除记录，仅 `customer_name` 字段更新

---

## Part B：同产品报价记录（UI 增强）

修改 `/customer-quotes` 页面（`src/app/customer-quotes/page.tsx`）。

### 数据加载

在 `loadRows()` 返回当前页数据后：

1. 收集当前页所有 `matched_product_id`（去重，排除 NULL）
2. 查询这些产品的所有历史报价：

```sql
SELECT
  cqr.id,
  cqr.sale_price_usd,
  cqr.raw_model,
  cqf.quote_date,
  cqf.customer_name,
  cqf.file_name
FROM customer_quote_rows cqr
JOIN customer_quote_files cqf ON cqf.id = cqr.file_id
WHERE cqr.matched_product_id IN (?, ?, ...)
ORDER BY cqf.quote_date DESC
```

3. 按 `matched_product_id` 分组为 `Map<string, HistoryRow[]>`

### UI 渲染

在展开行的 `<details>` 内容区域，**"产品绑定" section 下方**，如果该行有 `matched_product_id` 且该产品有 ≥2 条历史报价记录，新增一个 section：

```
同产品报价记录（共 N 条）
┌──────────┬────────────┬──────────┬────────────────────┐
│ 日期     │ 客户       │ FOB USD  │ 来源文件           │
├──────────┼────────────┼──────────┼────────────────────┤
│ 2024-05  │ HTF        │ $16.92   │ LED Highbay...xlsx │
│ 2024-03  │ Anas       │ $17.50   │ To Anas...xlsx     │
│ 2023-12  │ （内部核价）│ $15.80   │ 核价LED...xls      │
└──────────┴────────────┴──────────┴────────────────────┘
```

规则：
- 不显示当前行自身（排除 `cqr.id = 当前行 id`）
- 最多显示 10 条，有更多则显示 "还有 N 条..."
- 日期格式与现有一致（`YYYY-MM`）
- 客户名 NULL 显示 `（内部核价）`（复用现有 `formatCustomer`）
- FOB USD 复用现有 `formatUsd`
- 样式与现有 `DetailBlock` 一致

### 不做额外页面

不新建客户管理页面、不新建 API endpoint。所有数据在 Server Component 中预加载。

---

## 验证

- `npx tsc --noEmit --pretty false` 通过
- Part A 脚本 dry-run + apply 正常
- Part B 页面正常渲染，展开已匹配行可见"同产品报价记录"
- 无匹配或只有 1 条记录的行不显示该 section
- Part A 报告已生成

## 不做

- 不新建客户实体表
- 不新建页面或 API
- 不添加图表库
- 不修改 `customer_quote_rows` 表结构
