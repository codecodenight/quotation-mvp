# Codex Task: V3.0I — V2.24 PDF 产品参数提取

## 目标

给 V2.24 导入的 6 个 S06 三防灯产品（`PZ-HP-B-*` / `PZ-HP-B2-*`）补提参数。这 6 个产品在 V3.0H 之后才入库，目前 `product_params` 为 0。

## 方法

复用现有 `scripts/extract-params.ts --target=v3h`。V3.0H target 覆盖三防灯品类，脚本会找到这 6 个无 params 的产品并提取。已有 params 的产品会跳过（脚本逻辑是 upsert）。

## 执行步骤

### Step 1: Dry-run

```bash
npx tsx scripts/extract-params.ts --target=v3h --report=docs/v3.0i-dry-run-report.md
```

检查报告，确认 6 个 `PZ-HP-B` 产品被提取到参数（Power、Material、Voltage 等）。

### Step 2: Apply

```bash
npx tsx scripts/extract-params.ts --target=v3h --apply --report=docs/v3.0i-apply-report.md
```

### Step 3: 验证

```bash
npx tsc --noEmit --pretty false
```

```bash
sqlite3 prisma/dev.db "SELECT p.model_no, pp.param_key, pp.normalized_value, pp.unit FROM product_params pp JOIN products p ON pp.product_id=p.id WHERE p.model_no LIKE 'PZ-HP-B-%' OR p.model_no LIKE 'PZ-HP-B2-%' ORDER BY p.model_no, pp.param_key"
```

### Step 4: 提交

```bash
git add docs/v3.0i-dry-run-report.md docs/v3.0i-apply-report.md
git commit -m "V3.0I: extract params for V2.24 PDF-imported 三防灯 products"
```

## 验收标准

1. 6 个 `PZ-HP-B` 产品全部有 params
2. 已有 params 的三防灯产品不受影响（params 数量只增不减）
3. `tsc --noEmit` 通过

## 不做的事

- 不写新脚本
- 不改 schema
- 不碰其他品类
