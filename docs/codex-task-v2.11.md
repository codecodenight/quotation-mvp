# Codex Task: V2.11 Multi-Price Parser — 多价格单元格解析

## 目标

增强价格解析能力：当价格单元格包含多个 `变体:价格` 对（如 `3CCT:9 12CCT:10.5`）时，拆分为多条独立 offer，每条标注变体后缀。

## 背景

V2.8 Part C 导入 #26 中千太阳能庭院灯时，列 Q 部分行包含 `3CCT:9 12CCT:10.5` 格式：一个单元格里有多个按色温/规格变体标注的价格。当前 `parsePriceValue()` 会误取 `3`（第一个数字），所以这些行被跳过（46 行 skipped）。

实际含义：`3CCT:9` = 3 色温版本 9 元，`12CCT:10.5` = 12 色温版本 10.5 元。每个变体应成为独立的可报价记录。

## 设计

### 1. 新函数：`parseMultiPrice()`

位置：`src/lib/excel-import.ts`

```typescript
type MultiPriceEntry = {
  variant: string;   // e.g. "3CCT", "12CCT"
  price: string;     // e.g. "9", "10.5"
};

function parseMultiPrice(value: unknown): MultiPriceEntry[] | null
```

识别规则：
- 模式：一个或多个 `{变体标签}:{数字价格}`，用空格/逗号/分号分隔
- 变体标签可包含字母+数字（如 `3CCT`、`12CCT`、`WW`、`CW`）
- 价格是正数（整数或小数）
- 至少匹配到 2 个 `变体:价格` 对才认定为多价格格式（单个不算，走正常 parsePriceValue）
- 如果不匹配此模式，返回 `null`

### 2. 修改 `buildHejiaImportRows()` 的价格解析流程

在 `src/lib/hejia-import.ts` 中：

```
当前逻辑：
  purchasePrice = parsePriceValue(priceCell)
  if (!purchasePrice) → skip row

新逻辑：
  purchasePrice = parsePriceValue(priceCell)
  if (!purchasePrice) {
    multiPrices = parseMultiPrice(priceCell)
    if (multiPrices) {
      // 对每个 variant:price 生成一条 offer
      // model_no 加后缀：originalModel + " - " + variant
      // 例如 "ZQ-BD-005 - 3CCT" 和 "ZQ-BD-005 - 12CCT"
    } else {
      skip row (与当前行为一致)
    }
  }
```

关键规则：
- 每个变体 → 独立 product（model_no 带变体后缀）+ 独立 offer
- product_name 也带变体后缀，方便搜索
- 所有变体共享同一行的其他字段（description、size、ctn 等）
- 如果 `parsePriceValue()` 已能正常解析（单一价格），不触发多价格逻辑

### 3. 不修改 `parsePriceValue()` 本身

`parsePriceValue()` 保持不变，它仍然处理单价格单元格。`parseMultiPrice()` 是 fallback 路径。

## 执行步骤

### Step 1: 审计受影响数据

- 读取 #26 汇浮文件（路径见下方），统计列 Q 中匹配 `变体:价格` 模式的行数
- 列出所有不同的多价格格式样本（确认不只有 `3CCT:9 12CCT:10.5` 一种）
- 记录当前该文件已导入的产品/offer 数量
- 结果写入 `docs/v2.11-multi-price-result.md`

文件路径：
```
/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/户外照明 工业照明/户外工厂/中千/202601/汇浮太阳能庭院灯报价单2026年1月22日.xlsx
```

### Step 2: 实现 `parseMultiPrice()`

- 在 `src/lib/excel-import.ts` 添加 `parseMultiPrice()` 并 export
- 单元测试覆盖：
  1. `"3CCT:9 12CCT:10.5"` → `[{variant:"3CCT", price:"9"}, {variant:"12CCT", price:"10.5"}]`
  2. `"WW:8.5, CW:9"` → 两个 entry
  3. `"3CCT:9"` → `null`（单个不算多价格）
  4. `"¥9.5"` → `null`（正常单价格，不匹配）
  5. `""` / `null` / `"/"` → `null`
  6. `"3CCT:9 12CCT:10.5 RGBCCT:15"` → 三个 entry

### Step 3: 修改 `buildHejiaImportRows()` 支持多价格拆分

- 修改 `src/lib/hejia-import.ts`
- 当 `parsePriceValue()` 返回 null 且 `parseMultiPrice()` 返回有效结果时：
  - 为每个变体生成独立 product 和 offer
  - model_no = `原始 model_no + " - " + variant`
  - 使用 V2.10 的 upsert 逻辑（不会创建重复 offer）
- 单元测试覆盖多价格行的拆分逻辑

### Step 4: 重新导入 #26 验证

- 备份 DB
- 用已有的 #26 mapping 配置重新导入
- 由于 V2.10 upsert 机制：已存在的 offer 会 skip，新的多价格变体 offer 会 create
- 验证：
  - 新增产品/offer 数量合理
  - model_no 带正确变体后缀
  - 价格是实际价格（9、10.5），不是变体标签里的数字（3、12）
  - 原有产品/offer 不受影响
- 结果追加到 `docs/v2.11-multi-price-result.md`

### Step 5: 全量验证 + 提交

- `npm test` / `npm run lint` / `npm run build` 全部通过
- 结果追加到 `docs/v2.11-multi-price-result.md`
- git commit

## 注意事项

- Schema 不变，不需要新表或新字段
- 不改变 `parsePriceValue()` 的行为
- 备份 DB 后再操作
- 源 Excel 文件绝不修改
- #26 的 mapping 配置参考 `docs/v2.8-c-import-plan.md` 中 #26 部分
