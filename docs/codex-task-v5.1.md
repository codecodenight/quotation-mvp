# Codex Task: V5.1 — 历史客户报价搜索页

## 目标

新增 `/customer-quotes` 页面，让用户可以搜索和浏览全部 6,139 行历史客户 FOB USD 报价记录，无论是否已匹配到产品库。

**只读页面，不改任何数据。**

## 背景

V5.0B-E 已导入 6,139 行历史客户报价，其中 2,902 行匹配到产品（47%），3,237 行未匹配。V5.0D 在报价中心展示已匹配产品的历史售价，但未匹配的 3,237 行无处可查。用户需要一个独立入口来回答："以前给某客户报过什么价？某型号历史 FOB 是多少？"

### 数据表

- `customer_quote_files`：398 条 file-sheet 记录（customer_name, quote_date, format_type 等）
- `customer_quote_rows`：6,139 行（raw_model, sale_price_usd, matched_product_id 等）

---

## 页面设计

### 路由

`/customer-quotes` — 新增 Next.js page（参考现有 `/products` 和 `/data-quality` 页面的模式）。

### 导航

在现有侧边栏/导航中添加"历史报价"入口，放在"产品库"和"数据质量"之间或之后。

### 筛选区域（页面顶部）

参考 `/products` 页面的筛选 UI 风格：

1. **搜索框**：搜 `raw_model`、`raw_description`、`sale_price_text`（模糊搜索，LIKE %keyword%）
2. **客户名下拉**：从 `customer_quote_files.customer_name` 去重生成选项，包含 "全部" 和 "（内部核价）"（NULL）
3. **日期范围**：两个 date input（起止），按 `customer_quote_files.quote_date` 过滤
4. **匹配状态下拉**：全部 / 已匹配 / 未匹配
5. **品类下拉**（可选）：从 `customer_quote_files.relative_path` 提取品类目录名

### 列表区域

表格展示，每行一条 `customer_quote_rows` 记录：

| 列 | 字段 | 说明 |
|---|---|---|
| 日期 | `cqf.quote_date` | YYYY-MM 格式 |
| 客户 | `cqf.customer_name` | NULL 显示"内部核价" |
| 型号 | `cqr.raw_model` | 原始款号 |
| 描述 | `cqr.raw_description` | 截断显示，hover 看全文 |
| FOB USD | `cqr.sale_price_usd` | 格式化为 $X.XX |
| RMB 成本 | `cqr.rmb_cost` | 格式化为 ¥X.XX，核价文件才有 |
| 来源 | `cqf.file_name` | 截断显示 |
| 匹配 | `cqr.matched_product_id` | 已匹配显示产品 model_no + 链接，未匹配显示 "—" |

### 排序

默认按 `quote_date` 降序。列头可点击排序（日期、价格、型号）。

### 分页

每页 50 行，底部分页控件。数据量 6,139 行，不需要虚拟滚动。

### 行展开/详情

点击行展开，显示：
- 完整 `raw_description`
- `raw_row_json` 格式化显示（原始行所有列）
- 来源文件完整路径 + sheet 名
- 表头快照（`cqf.header_snapshot`）
- 如已匹配产品，显示产品信息 + 跳转链接（`/products?search=xxx`）

### 统计摘要（页面顶部或筛选区域下方）

一行摘要：`共 N 条历史报价 | M 条已匹配 | 涉及 K 个客户 | 日期范围 YYYY-MM ~ YYYY-MM`

---

## 数据获取

### Server Component 或 API Route

参考现有页面模式（`/products` 用 Server Component + Prisma query）。

```typescript
interface CustomerQuoteSearchParams {
  search?: string;
  customer?: string;
  dateFrom?: string;
  dateTo?: string;
  matched?: 'all' | 'matched' | 'unmatched';
  category?: string;
  page?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}
```

查询用 Prisma 或 raw SQL 均可。注意：
- JOIN `customer_quote_files` 获取客户名、日期、文件名
- LEFT JOIN `products` 获取已匹配产品的 model_no（用于显示）
- 搜索框用 `LIKE` 查询，同时搜 `raw_model` 和 `raw_description`
- 分页用 `LIMIT/OFFSET`

### 客户名列表

```sql
SELECT DISTINCT customer_name FROM customer_quote_files
WHERE customer_name IS NOT NULL
ORDER BY customer_name
```

---

## 执行步骤

### Step 1: 创建页面

新建 `src/app/customer-quotes/page.tsx`（或按项目现有路由结构）。

### Step 2: 添加导航入口

在现有导航组件中添加"历史报价"链接。

### Step 3: 实现筛选 + 列表 + 分页

### Step 4: 实现行展开详情

### Step 5: 验证

```bash
npx tsc --noEmit --pretty false
```

### Step 6: 提交

```bash
git add -A
git commit -m "V5.1: historical customer quote search page — /customer-quotes"
```

## 验收标准

1. `/customer-quotes` 页面可访问
2. 搜索框能搜 raw_model 和 raw_description
3. 客户名下拉筛选工作正常
4. 日期范围筛选工作正常
5. 匹配状态筛选工作正常
6. 分页工作正常（每页 50 行）
7. 行展开显示原始行 JSON 和来源文件信息
8. 已匹配产品显示 model_no
9. 导航栏有"历史报价"入口
10. `tsc --noEmit` 通过
11. 不改任何数据表

## 不做的事

- 不改数据
- 不做人工匹配绑定界面
- 不做"从历史报价加入当前报价"功能
- 不做价格趋势图
- 不做导出
