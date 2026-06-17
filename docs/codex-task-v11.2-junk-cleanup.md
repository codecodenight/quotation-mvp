# V11.2 — 垃圾产品清理：删除非产品行误导入记录

## 背景

批量导入时大量 Excel 非产品行（价格、数量、尺寸、重量、包装描述、MOQ 说明等）被当作产品记录导入。这些记录：

- 膨胀产品总数（分母），拉低所有覆盖率百分比
- 无法提取任何有意义的参数（没有 watts/voltage/cri 等）
- 给未来的回填/匹配管线增加噪声

**已知垃圾模式（通过诊断确认）：**

| 模式 | 示例 | 估计数量 |
|---|---|---:|
| 价格值当产品名 | US$2.91, ￥6.21 | ~43 |
| 数量值当产品名 | 600sets, 4000pieces, 4pcs, 11条 | ~76 |
| 尺寸/箱规当产品名 | 38*21.5*19cm, 157.5*9.5*6CM | ~140 |
| 重量当产品名 | N.W.: 11kgs, G.W.: 13kgs | ~21 |
| MOQ/起订说明 | MOQ..., 规格少于300PCS不接单 | ~7 |
| 包装/配件描述 | 包装方式：尼龙袋+..., 含塑料边扣...膨胀管...螺丝 | ~22 |
| LED/灯珠规格行 | SMD2835 130D, SMD2835 96D | ? |
| 太阳能板/电池规格 | Polycrystal 40*30mm, 1*cool/warm white SMD | ? |
| 合同条款/备注 | 产品标贴不干胶..., 外箱是普通瓦楞纸... | ? |

总计估计 400-800 条。

## 前置

```bash
cp prisma/dev.db prisma/dev.db.bak-v11.2
```

## 新建文件：`scripts/v11.2-junk-cleanup.ts`

```bash
npx tsx scripts/v11.2-junk-cleanup.ts                  # dry-run: 审计报告
npx tsx scripts/v11.2-junk-cleanup.ts --apply           # 执行删除
```

### 检测规则

```typescript
function classifyJunk(product: ProductRecord): string | null {
  const name = (product.productName ?? "").trim();
  const model = (product.modelNo ?? "").trim();

  // 1. 价格值：纯数字+货币符号
  if (/^[US$￥¥€£]?\s*[\d,.]+\s*[元]?\s*$/.test(name)) return "price";
  if (/^US?\$\s*[\d,.]+/.test(name)) return "price";
  if (/^￥\s*[\d,.]+/.test(name)) return "price";

  // 2. 数量值
  if (/^\d+\s*(?:pcs|sets?|pieces?|套|条|个|台|只|米|卷|箱|盒)\s*$/i.test(name)) return "quantity";
  if (/^\d+\/\d+$/.test(name) && name.length <= 5) return "quantity"; // "4/2"

  // 3. 尺寸/箱规（短字符串）
  if (/^\d+(?:\.\d+)?\s*[*×x]\s*\d+(?:\.\d+)?(?:\s*[*×x]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|CM|MM)?\s*$/i.test(name)) return "dimension";

  // 4. 重量
  if (/^[NG]\.?\s*W\.?\s*[:：]/i.test(name)) return "weight";

  // 5. MOQ/起订
  if (/^MOQ\b/i.test(name)) return "moq";
  if (/规格少于.*不接单/.test(name)) return "moq";
  if (/^单一规格MOQ/i.test(name)) return "moq";

  // 6. 包装/配件描述（以序号开头的说明文本）
  if (/^\d+[：:、]\s*(?:含|无|配件|包装|外箱|产品标贴|尼龙|棕色)/.test(name)) return "spec_note";
  if (/^包装方式/.test(name)) return "spec_note";
  if (/^换\d+.*不锈钢.*元\/套/.test(name)) return "pricing_note";

  // 7. LED 灯珠规格行（不是产品，是 LED 参数行）
  if (/^SMD\s*\d{4}\s+\d+D$/i.test(name)) return "led_spec"; // "SMD2835 130D"

  // 8. 太阳能板/电池规格（孤立规格行）
  if (/^Polycrystal\s/i.test(name)) return "solar_spec";
  if (/^\d+\s*[*×]\s*(?:cool|warm|white|LED)\s/i.test(name)) return "led_spec";

  // 9. 合同/备注文本（长度 > 30 且包含定价/包装关键词）
  if (name.length > 50 && /(?:安排进仓|提供包材|不干胶|灯座.*接线.*膨胀管)/.test(name)) return "contract_note";

  // 10. 全部产品过CE 等声明
  if (/^全部产品过/.test(name)) return "declaration";
  if (/^产品图片$/.test(name)) return "label";

  return null;
}
```

### 安全检查

每个标记为垃圾的产品在删除前必须满足：

```typescript
async function isSafeToDelete(productId: string): Promise<{ safe: boolean; reason?: string }> {
  // 1. 没有被引用在任何 quote_items 中
  const quoteItemCount = await prisma.quoteItem.count({ where: { productId } });
  if (quoteItemCount > 0) return { safe: false, reason: `${quoteItemCount} quote_items` };

  // 2. 没有被引用在任何 customer_quote_rows 中
  const cqrCount = await prisma.$queryRaw<[{cnt: number}]>`
    SELECT COUNT(*) as cnt FROM customer_quote_rows WHERE matched_product_id = ${productId}
  `;
  if (cqrCount[0].cnt > 0) return { safe: false, reason: `${cqrCount[0].cnt} customer_quote_rows` };

  // 3. 有图片的产品谨慎处理
  const product = await prisma.product.findUnique({ 
    where: { id: productId }, 
    select: { imagePath: true } 
  });
  if (product?.imagePath) return { safe: false, reason: "has image" };

  return { safe: true };
}
```

### 删除级联

对每个确认安全的垃圾产品：

```typescript
await prisma.$transaction([
  prisma.productParam.deleteMany({ where: { productId } }),
  prisma.supplierOffer.deleteMany({ where: { productId } }),
  // price_history 通过 supplier_offer_id 关联，需先查再删
  // ...
  prisma.product.delete({ where: { id: productId } }),
]);
```

注意：price_history 通过 `supplier_offer_id` 关联，不直接关联 product_id。需要：
1. 查出该产品的所有 supplier_offer ids
2. 删除关联的 price_history
3. 删除 supplier_offers
4. 删除 product_params
5. 删除 product

### 报告：`docs/v11.2-junk-cleanup-report.md`

```markdown
# V11.2 垃圾产品清理报告

模式: dry-run / apply
时间: ...

## 汇总

| 指标 | 数值 |
|---|---:|
| 扫描产品数 | X |
| 检测到垃圾 | X |
| 通过安全检查 | X |
| 跳过（有 quote_items） | X |
| 跳过（有 customer_quote_rows） | X |
| 跳过（有图片） | X |
| 实际删除产品 | X |
| 删除 supplier_offers | X |
| 删除 product_params | X |
| 删除 price_history | X |
| 产品总数变化 | 前 → 后 |

## 按垃圾类型统计

| 类型 | 检测数 | 安全删除 | 跳过 |

## 按品类统计

| 品类 | 删除产品 | 删除前总数 | 删除后总数 |

## 删除采样（前 50 条）

| 品类 | model_no | product_name | 垃圾类型 | 关联 offers |

## 跳过采样（有 FK 引用）

| 品类 | model_no | product_name | 跳过原因 |
```

---

## Commit

```
V11.2: clean up junk products (non-product rows imported as products)

- New v11.2-junk-cleanup.ts with pattern-based junk detection
- 10 detection patterns: price/quantity/dimension/weight/MOQ/spec notes/LED specs/etc.
- Safety checks: skip products with quote_items, customer_quote_rows, or images
- Cascade delete: price_history → supplier_offers → product_params → product
- Re-run audit after cleanup
```

## 重跑管线

```bash
npx tsx scripts/v11.2-junk-cleanup.ts --apply
npx tsx scripts/v10.0-source-audit.ts
```

## 不做什么

- 不删除有 quote_items 或 customer_quote_rows FK 引用的产品
- 不删除有图片的产品（可能是误判）
- 不删除铝材套件（它们是合法产品，只是没有 watts）
- 不修改任何现有脚本
- 不改 Prisma schema
- 不改前端
- 不修改源 Excel 文件
