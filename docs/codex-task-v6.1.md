# V6.1：跨品类碰撞只读审计

## 背景

V2.19G 发现 47 组通用 model_no（纯瓦数如 24W/18W/50W）各有多家工厂 offer。V6.0 已修复 48W 跨品类碰撞。V6.1 要搞清楚剩余 47 组（以及其他潜在碰撞）里，有多少是正常的同品类多供应商，有多少是跨品类碰撞。

**本次为只读审计，不改库。**

## 要求

写 `scripts/v6.1-collision-audit.ts`，输出报告到 `docs/v6.1-collision-audit.md`。

### Step 0：识别碰撞组

找出所有 `model_no` 对应 ≥3 个 `supplier_offers` 的产品，列出每个碰撞组的：
- `product.id`、`model_no`、`category`
- offer 数量
- 涉及的 factory_name 列表

### Step 1：构建工厂路径→品类映射

对每个 offer，通过 `source_file_id → files.relative_path` 和 `files.file_name` 推断该 offer 的"来源品类"。

映射规则（按路径段关键词匹配，不复用 `customer-quote-match` 的 CATEGORY_MAP）：

```
路径段/文件名关键词 → 品类
面板 / 大面板 / 小面板 → 面板灯
投光 → 投光灯
线条 / 办公灯 → 线条灯
吸顶 → 吸顶灯
筒灯 → 筒灯
三防 → 三防灯
磁吸 → 磁吸灯
净化 → 净化灯
镜前 → 镜前灯
防潮 → 防潮灯
壁灯 / 市电壁灯 → 壁灯
橱柜 → 橱柜灯
灯丝 → 灯丝灯
轨道 → 轨道灯
太阳能 / solar → 太阳能壁灯
庭院 → 庭院灯
应急 → 应急灯
地埋 → 地埋灯
台灯 → 台灯
皮线 → 皮线灯
路灯 → 路灯
Highbay / 工矿 → Highbay
风扇 → 风扇灯
工作灯 → 工作灯
充电 → 充电灯
灯带 → 灯带
G4 / G9 / GU10 → G4G9
```

**特殊处理**：
- `光源/球泡灯管/` 是合并目录。路径命中此段时，**必须看 file_name**：
  - file_name 含"灯管/T5/T8" → 灯管
  - file_name 含"球泡/bulb" → 球泡
  - 都不含 → 标记为"球泡灯管(不确定)"
- 路径同时命中多个关键词 → 取最深层目录段的匹配
- 无法匹配任何关键词 → 标记为"无法推断"

### Step 2：对比来源品类 vs product.category

对每个碰撞组的每个 offer，对比：
- `inferred_category`（Step 1 推断）
- `product.category`（产品当前品类）

分类为三组：
1. **正常**：该碰撞组所有 offer 的 inferred_category 与 product.category 一致，或 inferred_category 为"无法推断"但只有 1-2 个这样的 offer
2. **疑似跨品类**：至少一个 offer 的 inferred_category ≠ product.category 且 inferred_category 不是"无法推断"
3. **无法判断**：该碰撞组中超过 50% 的 offer 为"无法推断"

### Step 3：201 个 NULL source_file_id offer 专项

单独统计 `source_file_id IS NULL` 的 offer：
- 总数
- 其中落在碰撞组（Step 0 识别的组）里的数量
- 涉及哪些 `model_no + product.category`
- 涉及哪些 factory_name
- 价格范围（min/max）
- 有无 `quote_items` 引用

### 输出格式

报告 `docs/v6.1-collision-audit.md` 应包含：

1. **总览**：碰撞组总数、正常/疑似跨品类/无法判断 各多少组
2. **疑似跨品类详情表**：每组列出 product_id、model_no、product.category、每个 offer 的 factory_name + inferred_category + product.category 对比
3. **正常组摘要**：只列 model_no、category、offer_count（不展开每个 offer）
4. **NULL source 专项**：上述 Step 3 的所有数据
5. **品类映射命中统计**：多少 offer 成功推断、多少"无法推断"、多少"球泡灯管(不确定)"

## 验证

- `npx tsc --noEmit --pretty false` 通过
- 脚本运行不修改 DB（全程只用 SELECT / `$queryRaw`）
- 报告已生成

## 不做

- 不改库、不拆产品、不迁移 offer
- 不处理非碰撞组（offer < 3 的产品）
- 不做历史报价相关操作
