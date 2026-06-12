# Codex Task: V2.17G — 灯管/球泡拆分导入 Apply

## 目标

用 V2.17F 修正后的价格列检测规则，执行灯管/球泡拆分导入的 apply。

## 背景

- DB 已回滚到 V2.17D 之前（V2.17E 操作），当前：products=10,970 / offers=11,990 / price_history=8,198
- V2.17F dry-run 报告 (`docs/v2.17f-dryrun-report.md`) 已通过人工审核：
  - 96 sheets，1,822 valid rows
  - 所有可导入 sheet 的价格列都有价格关键词，无 ⚠️
  - 预计：+266 products / +330 offers / +1,436 price updates
- 价格列检测规则已在 V2.17E + V2.17F 中修正完毕

## 执行步骤

### Step 1: 备份

```bash
cp prisma/dev.db backups/dev-before-v2.17g-$(date +%Y%m%d-%H%M%S).sqlite
```

### Step 2: Apply

```bash
npx tsx scripts/tube-bulb-split-apply.ts --apply --report docs/v2.17g-apply-report.md
```

### Step 3: 验证数据

```bash
sqlite3 prisma/dev.db "
SELECT '--- products ---';
SELECT COUNT(*) FROM products;
SELECT '--- offers ---';
SELECT COUNT(*) FROM supplier_offers;
SELECT '--- price_history ---';
SELECT COUNT(*) FROM price_history;
SELECT '--- 球泡 ---';
SELECT COUNT(*) FROM products WHERE category = '球泡';
SELECT '--- 灯管 ---';
SELECT COUNT(*) FROM products WHERE category = '灯管';
"
```

期望：
- products ≈ 10,970 + 266 ≈ 11,236
- offers ≈ 11,990 + 330 ≈ 12,320
- 球泡 > 151（之前 V2.17D 前值）
- 灯管 > 8

### Step 4: 验证 + 提交

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
git add scripts/tube-bulb-split-apply.ts docs/v2.17g-apply-report.md
git commit -m "V2.17G: apply tube and bulb split import with fixed price detection"
```

## 验收标准

1. apply 报告中所有可导入 sheet 的价格列与 V2.17F dry-run 一致
2. 无读取错误
3. products / offers / price_history 增量与 dry-run 预估基本一致
4. 球泡 / 灯管产品数均有增长
5. tsc / lint / build / test 全过

## 不做的事

- 不修改价格列检测规则（V2.17F 已完成）
- 不做参数提取（V3.0F 单独做）
- 不改 UI
- 不修改源 Excel 文件
