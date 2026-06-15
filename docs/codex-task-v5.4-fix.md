# V5.4-fix：客户名大小写修正

## 背景

V5.4 客户名规范化把所有全大写客户名转成了 Title Case，但 HTF、AFT、AFRATAB、HACHIZAI 是客户代码/缩写，不应该转换。另外 "想要全系列销售的客户" 是描述性文本，不是客户名。

## 要求

写 `scripts/v5.4-fix-customer-case.ts`，支持 `--dry-run`（默认）和 `--apply`。

### Step 0：备份（仅 --apply）

```
cp prisma/dev.db backups/dev-before-v5.4-fix-{timestamp}.sqlite
```

### Step 1：恢复全大写客户代码

以下客户名恢复为全大写：

| 当前值 | 恢复为 |
|--------|--------|
| Htf | HTF |
| Aft | AFT |
| Afratab | AFRATAB |
| Hachizai | HACHIZAI |
| Deni | DENI |

```sql
UPDATE customer_quote_files SET customer_name = 'HTF' WHERE customer_name = 'Htf';
UPDATE customer_quote_files SET customer_name = 'AFT' WHERE customer_name = 'Aft';
UPDATE customer_quote_files SET customer_name = 'AFRATAB' WHERE customer_name = 'Afratab';
UPDATE customer_quote_files SET customer_name = 'HACHIZAI' WHERE customer_name = 'Hachizai';
UPDATE customer_quote_files SET customer_name = 'DENI' WHERE customer_name = 'Deni';
```

### Step 2：清除描述性假客户名

```sql
UPDATE customer_quote_files SET customer_name = NULL WHERE customer_name = '想要全系列销售的客户';
```

### Step 3：报告

输出到 `docs/v5.4-fix-report.md`：
- 每条 UPDATE 影响的行数
- 修正后的客户名列表（name + 记录数）
- customer_quote_files 总数不变

## 验证

- `npx tsc --noEmit --pretty false` 通过
- dry-run 不改 DB
- apply 后总记录数不变
- 客户名列表中无 Htf/Aft/Afratab/Hachizai/Deni/想要全系列销售的客户

## 不做

- 不改其他客户名
- 不改 customer_quote_rows
- 不动 UI
