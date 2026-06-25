# V30.0: 价格数据全面审计 — 只读

## Goal

审计 10,961 条 supplier_offers，逐条定性所有价格异常和工厂名异常，产出 V30.1 的修正方案。**只读，不写数据库。**

## Context

已知异常类别（Claude 摸底发现）：

### A. 价格异常（~76 条，高风险）

**A1. 电池型号=价格（中千，5 条）**
remark 字段确认：price=14500 对应 "电池参数: 14500/600mAh"
```
ZQ-WQD-002: price=14500 (battery 14500)
ZQ-WQD-004: price=18650 (battery 18650)
ZQ-FY-Txx:  price=14500 (battery 14500)
ZQ-SZGYBD:  price=26700 (battery 26700)
单边:       price=14500 (battery 14500)
```

**A2. 型号编码=价格（4 个工厂，53 条）**
V17.1 处理过同类问题但遗漏了这些：
- 美莱德 21 条：JJL-L8003→8003, JJL-T1006→1006 等
- 雄企 23 条：QJ6870-*→全部 6870（正常雄企价格 90-220）
- 进成 5 条：JC8211A→8211 等
- 优林 4 条：YL-SFD8001→8001 等

**A3. CCT/watts 值=价格（~9 条）**
- 绿晟 "6000-6500K"→price=6000
- 宁波琦辉 "3000K 4000K 6000K"→price=3000
- 名威 "3000-6500k"→price=3000, "1222*34*16±2MM"→price=1222
- 异形 "6500K"→price=6500
- 伊特 "1500W"→price=1500
- 一群狼 "FG-1200"→price=1200

**A4. 极端高价（1 条）**
- 凯晟德 TR-R1 100W: 238,024 RMB（源文件 "TR- R1 Qoutation to 20260512"）

**A5. 垃圾产品：规格值=产品名（凯晟德 8 条，price=0）**
产品名是 "6500K", "IP65", "10W", "200lm", "8 hours", "2 M", "0.5M", "ABS"

### B. 工厂名异常（~1,150 条）

**B1. 文件名=工厂名（~532 条，20+ 个假工厂名）**
最大的几个：
- "广交会最终核价" (104)
- "玲玲发 核算！-PP筒灯价格对比 20250912.xlsx" (101)
- "出中东款核价Wellux Quotation of led panel 2020-10-8.xlsx" (75)
- ...等

**B2. 品类名/描述=工厂名（~618 条）**
- "太阳能壁灯草坪灯" (393) — 来自博登/巨鑫/羽成等多个工厂
- "跨境产品" (142) — 来自皮线灯报价文件
- "sample data" (83) — 测试数据

### C. Sub-1 RMB 价格（731 条）

主要分布：
- 线条灯-伟润 534 条 (avg 0.214) — 铝型材按米定价？
- 面板灯-一群狼 103 条 (avg 0.198) — 组件定价？

## Script

写 `scripts/v30.0-price-audit.ts`，纯只读。

### 审计逻辑

```typescript
interface AuditResult {
  offerId: string;
  productId: string;
  productName: string;
  modelNo: string;
  category: string;
  factoryName: string;
  price: number;
  currency: string;
  sourceFileName: string | null;
  issueType: string;     // A1_battery_as_price | A2_model_as_price | A3_spec_as_price | A4_extreme | A5_garbage_product | B1_filename_as_factory | B2_category_as_factory | C_sub1_rmb
  evidence: string;      // 证据描述
  recommendation: string; // delete_offer | delete_product | fix_price | fix_factory | investigate | keep
  suggestedFix?: string; // 建议修正值（如真实工厂名）
}
```

**A1 检测**：factory_name='中千' AND price IN (14500, 18650, 26700) AND remark LIKE '%电池%{price}%'

**A2 检测**：price > 1000 AND 价格数字出现在 model_no 中（去掉字母前缀后）。排除假阳性：如果同工厂的其他产品中位价格在 price±50% 范围内，则可能是真实价格。

**A3 检测**：product_name 匹配 CCT 模式（\d{4}K）或 watts 模式（\d+W）且数值=price

**A4 检测**：price > 10000 AND 不在 A1/A2 中

**A5 检测**：product_name 匹配纯规格值模式（IP\d{2}、\d+W、\d+K、\d+lm、\d+ hours?、\d+\.?\d*M、ABS|PC|铝）AND price = 0

**B1 检测**：factory_name LIKE '%.xls%' OR factory_name LIKE '%核价%' OR factory_name LIKE '%报价%'。对每个假工厂名，从 source_file_id → files.file_name 尝试提取真实工厂名。

**B2 检测**：factory_name IN ('太阳能壁灯草坪灯','跨境产品','sample data')。对每个 source_file_id 分组，从 file_name 提取真实工厂名。

**C 检测**：price > 0 AND price < 1。按 category+factory_name 分组，记录品类、数量、均值、中位数。

### B 类工厂名推断逻辑

```typescript
function guessFactoryFromFileName(fileName: string): string | null {
  // 常见模式："{工厂名}报价表", "{工厂名}价格", "核价 {品类} - {工厂名}"
  // 示例：
  //   "副本博登报价单2025年8月.xls" → "博登"
  //   "巨鑫太阳能报价表VIP.xls" → "巨鑫"
  //   "羽成太阳能报价表(2).xlsx" → "羽成"
  //   "科蒲尔 2024年常规主推产品资料.xlsx" → "科蒲尔"
  // 无法确定时返回 null
  
  const patterns = [
    /^(?:副本)?([^\s\d]{2,4})(?:报价|价格|太阳能|灯|核价)/,
    /^(?:核价\s*)?(?:To\s+)?([^\s-]{2,6})\s*[-_]/,
  ];
  for (const pat of patterns) {
    const m = fileName.match(pat);
    if (m) return m[1];
  }
  return null;
}
```

这个函数只是辅助提示，不做自动修正。审计报告应逐个列出推断结果供人工确认。

## 报告

写到 `docs/v30.0-price-audit-report.md`：

```markdown
# V30.0 价格数据审计报告

## 审计总览

| 类别 | 条数 | 建议操作 |
|------|------|---------|

## A. 价格异常

### A1. 电池型号=价格
| product_name | model_no | factory | price | 电池型号 | 建议 |
|...|

### A2. 型号编码=价格  
| product_name | model_no | factory | price | 型号数字 | 同工厂中位价 | 建议 |
|...|

### A3. CCT/watts 值=价格
| product_name | factory | price | 被提取的规格值 | 建议 |
|...|

### A4. 极端高价
| product_name | factory | price | 源文件 | 建议 |
|...|

### A5. 垃圾产品
| product_name | factory | price | 建议 |
|...|

## B. 工厂名异常

### B1. 文件名=工厂名
| 当前工厂名 | 条数 | 源文件 | 推断工厂名 | 置信度 |
|...|

### B2. 品类名/描述=工厂名
| 当前工厂名 | 条数 | 源文件分组 | 推断工厂名 | 置信度 |
|...|

## C. Sub-1 RMB 价格
| 品类 | 工厂 | 条数 | 均值 | 范围 | 建议(keep/investigate) |
|...|

## 修正方案汇总

| 操作 | 条数 | 涉及 offer | 涉及 product |
|------|------|-----------|-------------|
| delete_offer | N | ... | ... |
| delete_product | N | ... | ... |
| fix_factory | N | ... | ... |
| investigate | N | ... | ... |
| keep | N | ... | ... |
```

## 验证

```bash
npx tsc --noEmit
npx tsx scripts/v30.0-price-audit.ts
```

## 不要做

- 不修改数据库
- 不修改 src/ 文件
- 对 B 类工厂名不做自动修正，只提供推断建议
- 对 C 类 sub-1 RMB 不预设"错误"结论——可能是合理的组件定价
