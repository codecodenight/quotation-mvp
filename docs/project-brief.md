# 本地供应商报价资料管理系统 MVP 开发说明

## 0. 项目目标

我要做一个本地运行的供应商报价资料管理系统。

当前所有原始资料都在移动硬盘中，包括：

* Excel 报价表
* PDF 产品册
* 产品图片
* ZIP 压缩包
* 工厂文件夹

第一版目标不是 AI Agent，也不是云端 SaaS。

第一版只要跑通：

移动硬盘资料 → 文件索引 → Excel导入 → 产品库 → 搜索 → 报价单导出

---

## 1. 技术栈要求

请使用：

* Next.js
* TypeScript
* Tailwind CSS
* Node.js API Route
* SQLite
* Prisma
* exceljs 或 xlsx
* exceljs 用于导出报价单

第一版不要使用：

* Supabase
* Vercel
* RAG
* 向量数据库
* AI Agent
* 百度网盘同步
* PDF智能解析
* 飞书机器人

原因：系统需要读取本地移动硬盘，先做本地工具。

---

## 2. 第一版页面

请实现以下页面：

### 1. 文件扫描页

功能：

* 输入本地文件夹路径
* 递归扫描该路径下所有文件
* 识别 Excel / PDF / 图片 / ZIP
* 写入 files 表
* 展示扫描结果

---

### 2. 文件列表页

功能：

* 展示已扫描文件
* 支持按文件类型筛选
* 支持按文件名搜索
* 显示文件路径、大小、修改时间、所属文件夹

---

### 3. 产品管理页

功能：

* 产品列表
* 新增产品
* 编辑产品
* 删除产品
* 搜索产品
* 按工厂、价格、MOQ筛选

---

### 4. Excel导入页

功能：

* 从已扫描文件中选择一个 Excel
* 读取表格内容
* 展示前几行预览
* 允许用户做字段映射

字段映射包括：

* 产品名
* 款号
* 工厂名
* 价格
* MOQ
* 材质
* 尺寸
* 备注

确认后写入 raw_products 表。

---

### 5. 产品整理页

功能：

把 raw_products 里的数据整理为正式产品。

第一版只做人工操作：

* 导入为新产品
* 关联到已有产品
* 忽略该条数据

不要做自动产品归一。

---

### 6. 报价中心页

功能：

* 搜索产品
* 勾选产品
* 输入客户名
* 输入利润率
* 选择币种
* 生成报价单 Excel

第一版报价公式先简单：

销售价 = 采购价 × (1 + 利润率)

---

### 7. 历史报价页

功能：

* 查看历史报价记录
* 查看报价客户
* 查看报价时间
* 查看导出的报价单文件路径

---

## 3. 数据库设计

请使用 Prisma + SQLite。

### files 表

用于记录移动硬盘中的原始文件。

字段：

* id
* file_name
* file_path
* file_type
* file_size
* folder_name
* factory_guess
* modified_at
* scanned_at

---

### raw_products 表

用于保存从 Excel 中解析出来的原始产品数据。

字段：

* id
* source_file_id
* factory_name
* raw_product_name
* raw_model_no
* raw_price
* raw_moq
* raw_material
* raw_size
* raw_remark
* raw_row_data
* created_at

---

### products 表

用于保存整理后的正式产品。

字段：

* id
* product_name
* category
* model_no
* material
* size
* image_path
* remark
* created_at
* updated_at

---

### supplier_offers 表

用于保存不同工厂对同一产品的报价。

字段：

* id
* product_id
* factory_name
* purchase_price
* moq
* lead_time
* source_file_id
* remark
* created_at

---

### quotes 表

用于保存报价单主表。

字段：

* id
* customer_name
* currency
* profit_margin
* exchange_rate
* quote_file_path
* created_at

---

### quote_items 表

用于保存报价单明细。

字段：

* id
* quote_id
* product_id
* supplier_offer_id
* purchase_price
* sale_price
* quantity
* remark

---

## 4. 开发顺序

请严格按以下顺序开发，不要跳步。

### Phase 1：项目初始化

完成：

* Next.js 项目
* Tailwind CSS
* Prisma
* SQLite
* 基础页面布局
* 左侧导航

验收标准：

可以本地启动项目，并看到各页面入口。

---

### Phase 2：文件扫描功能

完成：

* 输入文件夹路径
* 递归扫描文件
* 识别文件类型
* 写入 files 表
* 文件列表展示

验收标准：

输入移动硬盘某个目录后，可以看到 Excel / PDF / 图片 / ZIP 文件列表。

---

### Phase 3：产品 CRUD

完成：

* products 表 CRUD
* supplier_offers 表 CRUD
* 产品搜索
* 产品筛选

验收标准：

可以手动新增一个产品，并录入不同工厂报价。

---

### Phase 4：Excel 导入

完成：

* 选择已扫描的 Excel 文件
* 读取 Sheet
* 展示预览
* 字段映射
* 写入 raw_products

验收标准：

可以把 Excel 中的多行产品数据导入 raw_products。

---

### Phase 5：产品整理

完成：

* 展示 raw_products
* 支持导入为新产品
* 支持关联到已有产品
* 支持忽略

验收标准：

可以把 raw_products 转成 products + supplier_offers。

---

### Phase 6：报价导出

完成：

* 搜索产品
* 勾选产品
* 输入客户名、利润率、币种
* 生成报价单 Excel
* 保存 quotes 和 quote_items

验收标准：

可以导出一个包含产品、工厂、采购价、销售价的 Excel 报价单。

---

## 5. 产品原则

第一版必须保持简单。

核心目标只有四个：

1. 文件扫得到
2. Excel导得进
3. 产品查得到
4. 报价导得出

不要提前开发：

* AI
* Agent
* 自动产品归一
* PDF解析
* 云端部署
* 复杂权限
* 多用户系统

后续版本再考虑这些。

---

## 6. 当前最优先任务

请先完成 Phase 1 和 Phase 2。

也就是：

1. 初始化项目
2. 建 Prisma 数据表
3. 做文件扫描页
4. 做文件列表页

完成后暂停，等待我测试移动硬盘扫描效果。
