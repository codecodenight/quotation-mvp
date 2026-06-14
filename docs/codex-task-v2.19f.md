# Codex Task: V2.19F — 尼奥/瑞鑫/欧诺 数据修补

## 目标

修补 V2.19D/E 遗留的三组数据异常，分三个 Part 独立处理。脚本支持 `--audit`（只读）和 `--fix`（写 DB）。

## 背景

V2.19E 调查了三组异常：
- **尼奥灯带**：7 条 offer 的价格是芯片型号/灯珠数（2835/5050/240/288），不是真实价格
- **瑞鑫面板灯**：导入残留的规格/材质行，product_name 是 "0.7PS"、"295*1195*32mm-40W" 等
- **欧诺面板灯**：20 条 offer 价格极低（0.44–2.30），标记 RMB，来自"核价"文件，疑似 USD 或组件成本

三组均无 quote_items 引用。

---

## Part A: 尼奥灯带 — 7 条价格修正

### 现状

| model_no | 当前 price | 错误原因 | offer_id |
|---|---:|---|---|
| LST-110/220V-NW-2835-120 | 2835 | 芯片型号 2835 | 855427cd-... |
| LST-110/220V-NW-2835-180 | 2835 | 芯片型号 2835 | 3a4a7cd0-... |
| LST-110/220V-NW-2835-240 | 2835 | 芯片型号 2835 | 028ce345-... |
| LST-110/220V-NW-5050-60 | 5050 | 芯片型号 5050 | bf685f29-... |
| LST-110/220V-NW-5050-96 | 5050 | 芯片型号 5050 | df25a815-... |
| LST-110/220V-NW-COB-240免驱 | 240 | 灯珠数 240 | aa1b93b5-... |
| LST-110/220V-NW-COB-288免驱 | 288 | 灯珠数 288 | 06ba4e54-... |

源文件（全部来自同一个文件）：
```
/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/灯带/尼奥/尼奥-广交会灯带选品核价 - 高压无导线+柔性 更新 20250331.xls
```
file_id: `35a724c5-3f7a-47ec-a853-bf096ab132a9`

### 已知线索

remark 中有 2 条包含真实价格：
- LST-2835-120: remark 含 `￥1.74`
- LST-2835-240: remark 含 `￥3.72`

### 修正方法

1. 用 SheetJS 读源 Excel（.xls 格式，SheetJS 支持）
2. 找到包含这 7 个型号的 sheet
3. 识别正确的价格列——灯带价格通常 ￥1–30/m 范围，排除芯片型号列（值为 2835/5050）和灯珠数列（值为 60/96/120/180/240/288）
4. 提取正确价格
5. 对 LST-2835-120 和 LST-2835-240 用 remark 中的 ￥1.74/￥3.72 交叉验证
6. 更新 supplier_offers.purchase_price

### 安全边界

- 如果源文件不存在（硬盘未挂载）→ 报错退出
- 如果找不到包含这些型号的 sheet → 报告并跳过 Part A
- 如果找到价格但与 remark 线索矛盾 → 报告不修正
- 正确价格必须在 0.5–50 范围内（灯带合理价格），否则跳过
- 写 price_history 记录旧价格（记录从错误价格修正）

---

## Part B: 瑞鑫面板灯 — 规格行清理

### 确认删除（5 条）

全部无图片、无 quote_items、仅 1 条 offer、1 条 param。明显是源 Excel 的规格/材质行误导入为产品：

| model_no | price | 判定 |
|---|---:|---|
| 0.7PS | 0.7 | PS 材质厚度行 |
| 0.8PS+1.2棱镜板 | 0.8 | 材质+棱镜板行 |
| 295*1195*32mm-40W | 295 | 尺寸规格行，price=尺寸数字 |
| 595*1195*32mm-60W | 595 | 尺寸规格行，price=尺寸数字 |
| 595*595*32mm-40W | 595 | 尺寸规格行，price=尺寸数字 |

### 仅审计不删除

| model_no | price | has_image | offers | 原因 |
|---|---:|---|---:|---|
| 36/40W | 36 | Y | 1 | 有图片，可能是真产品但 model_no 差 |
| PP0.7 | 0.7 | N | 1 | 有 6 params（watts=24, size=295×595），可能是材质变体 |
| PP0.8 | 0.8 | N | 1 | 有 6 params（watts=40, size=295×1195），可能是材质变体 |
| PP1.0 | 1 | N | 1 | 有 6 params（watts=60, size=595×1195），可能是材质变体 |

**48W（price=48, 11 offers from 11 factories）不在本任务范围内**——这是 model_no 碰撞问题，需要单独处理。

### 删除操作

对 5 个确认删除的产品：
1. 删 product_params
2. 删 supplier_offers
3. 删 products
4. 记录删除明细

---

## Part C: 欧诺面板灯 — 源文件审计 + 价格判定

### 现状

20 条 offer from "欧诺 塑料 小面板灯"，prices 0.44–2.30，标记 RMB。
6 条 offer from "欧诺"，包括 3W(3)/5W(5)/12W(7.42)/15W(12.47)/圆形(13.8)/方形(14.5)。

源文件：
```
# 20 条来源
/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/小面板灯/欧诺 塑料 小面板灯/核价Wellux Quotation of led panel 20220127 欧诺塑料款筒灯.xlsx

# 6 条来源（其中 2 条）
/Volumes/My Passport/AI 报价/各家工厂最新报价汇总/室内照明/小面板灯/欧诺 塑料 小面板灯/塑料面板灯 报价单2022.01.08.xlsx
```

### 审计方法

1. 用 SheetJS 读 `核价Wellux Quotation...xlsx`
2. 找价格列表头——看是否标注 USD/FOB/$ 等
3. 检查是否有其他价格列（如含税价、RMB 价）
4. 读 `塑料面板灯 报价单...xlsx` 同样分析
5. 输出发现到审计报告

### 修正规则

- 如果源文件价格列明确标注 USD/$ → `--fix` 时更新 currency 为 USD
- 如果源文件价格列标注为组件成本（如 "driver cost"、"housing cost"） → 审计报告建议删除，但不自动删除
- 如果 3W=3, 5W=5 是瓦数当价格（price=wattage） → `--fix` 时删除这 2 条产品+offer
- 圆形/方形 product_name 是形状标签 → 审计报告记录，但价格可能正确，不自动处理
- 如果源文件不存在 → 跳过 Part C

---

## 脚本：`scripts/data-fix-v2.19f.ts`（新建）

### 命令行

```bash
# 审计全部（只读）
npx tsx scripts/data-fix-v2.19f.ts --audit

# 修正全部
npx tsx scripts/data-fix-v2.19f.ts --fix

# 只处理某个 Part
npx tsx scripts/data-fix-v2.19f.ts --audit --part=a
npx tsx scripts/data-fix-v2.19f.ts --fix --part=b
```

### 输出

- `--audit` → `docs/v2.19f-audit.md`
- `--fix` → `docs/v2.19f-fix-result.md`

### Excel 读取

用项目已有的 SheetJS。import 方式参考 `src/lib/hejia-import.ts` 或 `src/lib/excel-reader.ts`。

读 .xls 时 SheetJS 的 `XLSX.readFile(path)` 直接支持，不需要 LibreOffice 转换。

### DB 备份

`--fix` 模式先备份：
```bash
cp prisma/dev.db backups/dev-before-v2.19f-{timestamp}.sqlite
```

---

## 执行步骤

### Step 1: 创建脚本

新建 `scripts/data-fix-v2.19f.ts`。

### Step 2: Audit

```bash
npx tsx scripts/data-fix-v2.19f.ts --audit
```

检查 `docs/v2.19f-audit.md`：
- Part A: 确认找到正确价格列，7 条新价格合理
- Part B: 确认 5 条删除目标无其他依赖
- Part C: 确认价格列语义

### Step 3: Fix

```bash
npx tsx scripts/data-fix-v2.19f.ts --fix
```

### Step 4: 验证

```bash
npx tsc --noEmit --pretty false
```

```bash
sqlite3 prisma/dev.db "SELECT model_no, purchase_price FROM supplier_offers so JOIN products p ON so.product_id=p.id WHERE p.category='灯带' AND so.factory_name='尼奥' ORDER BY model_no"
```

```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM products WHERE category='面板灯' AND model_no IN ('0.7PS','0.8PS+1.2棱镜板','295*1195*32mm-40W','595*1195*32mm-60W','595*595*32mm-40W')"
```

### Step 5: 提交

```bash
git add scripts/data-fix-v2.19f.ts docs/v2.19f-audit.md docs/v2.19f-fix-result.md
git commit -m "V2.19F: fix 尼奥 prices, clean 瑞鑫 spec rows, audit 欧诺 currency"
```

## 验收标准

1. Part A: 7 条尼奥 offer 价格更新为合理值（0.5–50 范围），price_history 记录旧价
2. Part B: 5 条规格行产品+offer+params 已删除，36/40W 和 PP 系列不受影响
3. Part C: 审计报告明确说明欧诺价格列语义；如果是 USD 则 currency 已更新
4. DB 备份存在
5. `tsc --noEmit` 通过
6. 审计报告包含源 Excel 表头截图（文本形式）

## 不做的事

- 不处理 48W model_no 碰撞问题（需要单独解决）
- 不处理伟润 578 产品（V2.19E 已确认是假警报，价格实际正确）
- 不修改导入逻辑
- 不修改 schema
