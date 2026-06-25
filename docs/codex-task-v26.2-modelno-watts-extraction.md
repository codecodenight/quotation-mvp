# V26.2: Product Name / Model No 嵌入式 Watts 提取 — 2,326 个 NO_WATTS 产品

## Goal

V25.1 分类的 2,174 个 NO_WATTS_IN_SOURCE + ~152 个无 source_file_id 的产品，源文件根本没有 watts 列，无法通过匹配 Excel 行获取 watts。但很多产品的 product_name 或 model_no 本身包含 watts 信息。

例如：
- `"DOB筒灯 24W"` → 24W
- `"HY-TG-100W"` → 100W
- `"SY-5103/3W"` → 3W
- `"WL-ML-015-A 15W"` → 15W
- `"36W 300*600"` → 36W
- `"2*48W三色变光"` → 96W

本任务从 product_name + model_no + remark 中提取 watts，作为最后一道覆盖手段。

## Context

- V22.1 做过一轮 product_name watts 提取，但只覆盖了 1.3%
- V22.1 的局限：模式太简单，只匹配末尾 "xxxW" 且没做品类合理性校验
- 本轮改进：更丰富的模式 + 品类合理性区间校验 + 跳过已有 watts 的产品
- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v26.2-modelno-watts-extraction.ts`，支持 `--dry-run`（默认）和 `--apply`。

### A. 目标产品

```sql
SELECT p.id, p.product_name, p.model_no, p.remark, p.category
FROM products p
WHERE p.id NOT IN (
  SELECT product_id FROM product_params WHERE param_key = 'watts'
)
```

### B. Watts 提取模式

对 product_name、model_no、remark 三个字段依次尝试：

```typescript
function extractWattsFromText(text: string): { watts: number; pattern: string } | null {
  if (!text) return null;
  
  // 1. 乘法模式：2*48W, 3×24W → 相乘
  const multiply = text.match(/(\d+)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[Ww]/);
  if (multiply) {
    return { watts: Number(multiply[1]) * Number(multiply[2]), pattern: 'multiply' };
  }
  
  // 2. 带后缀W：100W, 3.5W, 24w（不在数字后紧跟其他字母的情况）
  //    排除 "2835" "5630" 等LED型号（4位+数字不应匹配）
  //    排除 "IP65W" 之类的误匹配
  const directAll = [...text.matchAll(/(?<![0-9])(\d{1,4}(?:\.\d+)?)\s*[Ww](?![a-zA-Z])/g)];
  if (directAll.length === 1) {
    // 唯一匹配
    return { watts: Number(directAll[0][1]), pattern: 'direct_unique' };
  }
  if (directAll.length > 1) {
    // 多个匹配 — 取最后一个（通常格式是 "model 100W xxx"）
    // 但如果值不一致，标记为 ambiguous 跳过
    const values = directAll.map(m => Number(m[1]));
    const unique = [...new Set(values)];
    if (unique.length === 1) {
      return { watts: unique[0], pattern: 'direct_repeated' };
    }
    // 多个不同值 — 不提取
    return null;
  }
  
  return null;
}
```

### C. 品类合理性校验

每个品类有合理的 watts 区间。提取的值必须在区间内，否则跳过：

```typescript
const CATEGORY_WATTS_RANGE: Record<string, [number, number]> = {
  '筒灯':     [1, 100],
  '面板灯':   [3, 200],
  '线条灯':   [5, 200],
  '磁吸灯':   [3, 50],
  '太阳能壁灯': [1, 50],
  '灯带':     [1, 200],  // 通常是 W/m
  '皮线灯':   [1, 50],
  '三防灯':   [10, 120],
  '轨道灯':   [5, 60],
  '吸顶灯':   [10, 200],
  '投光灯':   [10, 1000],
  '球泡':     [3, 50],
  '灯丝灯':   [1, 20],
  '灯管':     [5, 60],
  '壁灯':     [3, 30],
  '风扇灯':   [20, 300],
  '净化灯':   [10, 80],
  '路灯':     [20, 500],
  'Highbay':  [50, 600],
  '防潮灯':   [6, 60],
  '应急灯':   [3, 50],
  '橱柜灯':   [1, 30],
  '镜前灯':   [5, 30],
  '台灯':     [3, 30],
  '地埋灯/地插灯': [1, 50],
  '工作灯':   [3, 100],
  '庭院灯':   [5, 200],
  '太阳能':   [5, 500],
  'G4G9':     [1, 10],
};
```

如果品类不在表中，用宽区间 [0.5, 1000]。

### D. 提取优先级

对同一产品的三个字段：
1. product_name 最优先（最准确）
2. model_no 次之
3. remark 最后

取第一个通过合理性校验的值。

### E. 写入

```
sourceField: "v26.2_name_embedded_watts"
confidence: "medium"（从名称提取，非直接数据）
paramKey: "watts"
```

### F. 报告

写到 `docs/v26.2-modelno-watts-extraction-report.md`：

```markdown
# V26.2 Product Name 嵌入式 Watts 提取报告

## 统计
- 目标产品数（缺 watts）: N
- 提取成功: N (N%)
- 来自 product_name: N
- 来自 model_no: N
- 来自 remark: N
- 跳过（品类范围外）: N
- 跳过（ambiguous 多值）: N
- 无匹配: N

## 按品类

| 品类 | 目标数 | 提取成功 | 提取率 | watts 均值 | watts 范围 |
|------|--------|---------|--------|-----------|-----------|

## 被品类校验拦截的样本（前 20 条）

| 品类 | product_name | model_no | 提取值 | 合理区间 | 判定 |
|------|-------------|---------|--------|---------|------|

## 写入样本（前 30 条）

| 品类 | product_name | model_no | 源字段 | 提取模式 | watts |
|------|-------------|---------|--------|---------|-------|

## product_params / watts 覆盖率变化
```

### G. 验证

```bash
npx tsc --noEmit
npx tsx scripts/v26.2-modelno-watts-extraction.ts            # dry-run
npx tsx scripts/v26.2-modelno-watts-extraction.ts --apply     # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改已有 product_params
- 不从太阳能壁灯的 remark/描述中提取"太阳能电池板 1W"之类的值（V25.3 教训）
  - 安全做法：太阳能壁灯只从 product_name 或 model_no 提取，不用 remark
- 不提取 ambiguous 多值（同一字段出现 "10W" 和 "20W" 则跳过）
