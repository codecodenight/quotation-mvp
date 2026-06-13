# Codex Task: V2.18B — 伊特 4.25 产品报价导入

## 目标

将 `伊特/2026/4.25 产品报价-含税.xlsx`（292 行，单 sheet `市电产品`）导入为 **投光灯**。

V2.18 dry-run 已确认：全部是 `YLT-TG163-*W` 系列，单一品类投光灯。

## 实现方式

修改 `scripts/outdoor-import.ts` 中 FILE_LIST 的第 19 条（伊特 4.25）：

```
mode: "analyze-only" → "import"
targetCategory: "" → "投光灯"
```

然后按正常流程 dry-run → apply。

脚本会重新处理全部 19 个文件，但前 18 个已在 V2.18 导入，upsert 会判定为 duplicate/no-change，不会产生新 product/offer/price_history。只有第 19 个文件会写入新数据。

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v2.18b-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: 修改脚本

修改 `scripts/outdoor-import.ts` 中 FILE_LIST 第 19 条：
- `mode` 从 `"analyze-only"` 改为 `"import"`
- `targetCategory` 设为 `"投光灯"`

### Step 3: Dry-run

```bash
npx tsx scripts/outdoor-import.ts --report docs/v2.18b-dryrun-report.md
```

检查：
- 第 19 个文件从 analyze-only 变为 import，出现 valid rows
- 前 18 个文件全部 duplicate/no-change
- 投光灯行数大幅增加（预估 ~250 行，V2.18 分析显示 292 行但部分可能是小标题行）
- 无 ⚠️ 价格列误判

### Step 4: Apply

```bash
npx tsx scripts/outdoor-import.ts --apply --report docs/v2.18b-apply-report.md
```

### Step 5: 验证 + 提交

```bash
sqlite3 prisma/dev.db "
SELECT 'products' as t, COUNT(*) FROM products
UNION ALL SELECT 'offers', COUNT(*) FROM supplier_offers
UNION ALL SELECT 'price_history', COUNT(*) FROM price_history;
SELECT '--- 投光灯 ---';
SELECT COUNT(*) FROM products WHERE category = '投光灯';
"
```

期望：
- products 从 11,300 增加（估计 +100-250，部分型号已存在 → 复用）
- 投光灯从 444+V2.18 增长显著
- 前 18 个文件对应的 products/offers 数量不变

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/outdoor-import.ts docs/v2.18b-dryrun-report.md docs/v2.18b-apply-report.md
git commit -m "V2.18B: import YiTe 4.25 product pricing as floodlight"
```

## 验收标准

1. 伊特 4.25 文件成功导入，products/offers 有增量
2. 前 18 个文件无新增（全部 duplicate）
3. 无源 Excel 文件被修改
4. tsc / lint / build / test 全过

## 不做的事

- 不改其他 FILE_LIST 条目
- 不做参数提取（V3.0G 单独做）
- 不改 UI
- 不修改源 Excel
