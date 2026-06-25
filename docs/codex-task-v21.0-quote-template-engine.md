# V21.0: 报价模板引擎 — 基础设施 + 首个品类模板

## Goal

构建品类→报价模板的映射引擎，让报价导出能按品类生成正确格式的 Excel。本次只做基础设施 + 面板灯（最高频品类之一）的完整模板，验证机制后续品类逐步添加。

## Context

- 当前报价导出是通用格式（`src/lib/quote-export.ts`），所有品类共用一套列
- 报价汇总表有 28 种不同表格结构（见上文分析）
- 面板灯在 DB 中有 854 产品，是高频品类
- 导出用 `exceljs` 库
- 现有导出有两种模式：`customerMode: true`（给客户）和 `customerMode: false`（内部用）

## Changes

### A. 模板注册表 `src/lib/quote-templates.ts`

新建文件。定义模板接口和注册表：

```typescript
import type { Workbook, Worksheet } from "exceljs";

export interface QuoteTemplateColumn {
  header: string;
  key: string;
  width: number;
}

export interface QuoteTemplateConfig {
  category: string;
  sheetName: string;
  columns: QuoteTemplateColumn[];
  writeRow: (ws: Worksheet, rowIndex: number, item: QuoteTemplateItem) => void;
  writeHeader?: (ws: Worksheet) => void;
}

export interface QuoteTemplateItem {
  productName: string;
  modelNo: string | null;
  size: string | null;
  material: string | null;
  remark: string | null;
  salePrice: number;
  purchasePrice: number;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  params: Record<string, string>;
}

const TEMPLATE_REGISTRY = new Map<string, QuoteTemplateConfig>();

export function registerTemplate(config: QuoteTemplateConfig) {
  TEMPLATE_REGISTRY.set(config.category, config);
}

export function getTemplate(category: string): QuoteTemplateConfig | null {
  return TEMPLATE_REGISTRY.get(category) ?? null;
}

export function hasTemplate(category: string): boolean {
  return TEMPLATE_REGISTRY.has(category);
}
```

### B. 面板灯模板 `src/lib/quote-templates/panel.ts`

新建文件。面板灯报价表的列结构（参考报价汇总表 LED Slim Panel-plastic sheet）：

| 列 | Header | 数据来源 |
|---|---|---|
| A | No. | 行号 |
| B | Model No. | product.modelNo |
| C | Power | params.watts + "W" |
| D | Size (mm) | params.size_display 或 length×width×height |
| E | Material | params.material |
| F | CCT | params.cct + "K" |
| G | CRI | "Ra" + params.cri |
| H | PF | params.pf |
| I | Voltage | params.voltage + "V" |
| J | Driver | params.driver_type |
| K | IP | "IP" + params.ip |
| L | FOB Price (USD) | salePrice |
| M | MOQ (PCS) | moq |
| N | CTN QTY | ctnQty |
| O | CTN Size (cm) | ctnLength × ctnWidth × ctnHeight |
| P | Packing Volume (m³) | L×W×H/1000000 |

在文件底部调用 `registerTemplate(panelTemplate)`。

### C. 修改导出逻辑 `src/lib/quote-export.ts`

读取现有文件，理解当前导出的完整流程。

修改策略：
1. 在导出函数开头，检查所有 items 的品类（从 product.category 获取）
2. 如果所有 items 都属于同一品类，且该品类有注册模板 → 使用品类模板
3. 如果 items 跨品类，或品类无模板 → 使用现有通用模板（不改动）
4. 品类模板和通用模板不能混用——要么全用品类模板，要么全用通用模板

品类模板导出时：
- 创建新 sheet，用模板的 sheetName
- 调用 writeHeader（如果有）写表头样式
- 遍历 items，调用 writeRow 写每行
- 列宽用模板定义

### D. 传 params 到导出函数

当前导出函数的 item 数据结构可能没有 params。需要确保：
- 从 DB 查询时 include params
- 序列化时把 params 转成 `Record<string, string>`（paramKey → normalizedValue || rawValue）
- 传到模板的 writeRow

检查 `src/app/(admin)/quotes/actions.ts` 中 `createQuote` 和 `previewQuote` 的数据流，确保 params 可用。

### E. 确保模板自动加载

在 `quote-templates.ts` 的顶部 import `./quote-templates/panel`，确保 `registerTemplate` 被调用。

### F. 验证

1. `npx tsc --noEmit` — 0 errors
2. `npx vitest run` — all pass
3. 启动 dev server：
   - 在 /quotes 搜索面板灯，选几个产品
   - 导出报价（客户模式）
   - 检查生成的 Excel：是否使用了面板灯模板（列头应包含 Power/Size/Material/CCT/CRI/PF/Voltage/Driver/IP）
   - 如果选跨品类产品导出，应使用通用模板
4. 导出的 Excel 放到 `outputs/` 目录供审查

### G. 报告

写到 `docs/v21.0-quote-template-engine-report.md`：
- 模板注册表设计说明
- 面板灯模板列定义
- 导出测试结果（面板灯专用模板 vs 通用模板）
- tsc / vitest 结果
