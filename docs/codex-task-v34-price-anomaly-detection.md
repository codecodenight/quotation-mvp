# V34: 价格异常检测与标记

## 背景
数据库中存在大量价格异常：
- 586 条 offer 价格 < 0.5 RMB（大概率是误解析：行号、序号、百分比被当成价格）
- 36 条 offer 价格 > 1000 RMB（可能是整箱价、整批价或误解析）
- 同工厂同品类价格极差超过 10 倍的组合有 15+ 个

这些异常价格污染搜索结果和工厂对比。

## 目标
1. 生成价格异常检测报告
2. 给异常 offer 打标（不删除）
3. Chat 搜索结果中异常 offer 降权

## 步骤

### 1. 备份数据库
```bash
cp prisma/dev.db prisma/dev.db.bak-v34
```

### 2. 添加异常标记列

用 sqlite3 添加列（不用 prisma migrate，避免 schema-engine 空错误 bug）：

```bash
sqlite3 prisma/dev.db "ALTER TABLE supplier_offers ADD COLUMN price_flag TEXT DEFAULT NULL;"
```

同步更新 `prisma/schema.prisma` 中 `SupplierOffer` model，添加：
```prisma
priceFlag     String?  @map("price_flag")
```

然后运行：
```bash
npx prisma generate
```

### 3. 编写检测脚本 `scripts/v34-price-anomaly-detect.ts`

脚本逻辑：

**规则 A — 绝对阈值**：
- `purchase_price < 0.5` → `price_flag = 'suspicious_low'`
- `purchase_price > 1000` → `price_flag = 'suspicious_high'`

**规则 B — 统计离群**：
对每个 (category) 分组：
- 计算该品类所有 offer 的中位数价格
- 价格 < 中位数 / 10 → `price_flag = 'outlier_low'`
- 价格 > 中位数 * 10 → `price_flag = 'outlier_high'`
- 只对 price_flag 仍为 NULL 的 offer 应用（不覆盖规则 A 的标记）

用 sqlite3 直接执行 SQL，不用 Prisma client。

脚本最后输出统计：
```
suspicious_low: X
suspicious_high: X
outlier_low: X
outlier_high: X
total flagged: X
total offers: X
```

### 4. 执行脚本
```bash
npx tsx scripts/v34-price-anomaly-detect.ts
```

### 5. Chat 搜索降权

修改 `src/lib/chat-tools.ts`：

在 `productSelection` 的 `supplierOffers.select` 中添加 `priceFlag: true`。

修改 `serializeProductCard` 中选择 `recommendedOffer` 的逻辑：优先选 `priceFlag === null`（正常价格）的 offer。如果所有 offer 都有 flag，退回到现有逻辑。

修改 `ChatProductOffer` 类型，添加 `price_flag: string | null`。

在产品卡 UI 中（`chat-client.tsx`），如果 `recommended_offer.price_flag` 不为 null，在价格旁显示一个小警告标记：
```tsx
{offer.price_flag && (
  <span className="text-xs text-amber-500" title="价格可能异常">⚠</span>
)}
```

### 6. 写报告到 `docs/v34-price-anomaly-report.md`

包含：
- 各类 flag 的数量
- 每个品类的中位数价格
- 前 20 个最极端的异常价格样本（含工厂名、品类、价格、flag 类型）

### 7. 验证
```bash
npx vitest run src/lib/chat-tools.test.ts
npx next build
```

两个都通过。

## 不做
- 不删除任何 offer
- 不改 DeepSeek prompt
- 不改价格数据本身
