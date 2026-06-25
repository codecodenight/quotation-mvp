# V25.2: 写入 383 条 RECOVERABLE watts

## Goal

把 V25.1 审计出的 383 个 RECOVERABLE 产品的 watts 写入 product_params 表。

## Context

- V25.1 审计脚本 `scripts/v25.1-watts-gap-audit.ts` 已对每个缺 watts 产品做了回源匹配
- 383 个产品被标记为 RECOVERABLE：精确匹配到 Excel 行，且该行有可提取 watts 值
- 审计报告 `docs/v25.1-watts-gap-audit-report.md` 有完整样本
- DB 位置：`prisma/dev.db`，操作前必须备份

## Script

写 `scripts/v25.2-recoverable-watts-write.ts`，支持 `--dry-run`（默认）和 `--apply`。

### 逻辑

1. 复用 V25.1 的审计逻辑（可以直接 import V25.1 的导出函数，或复制核心匹配逻辑）
2. 只处理 bucket = RECOVERABLE 的产品
3. 对每个 RECOVERABLE 产品：
   - 再次确认 product_params 中没有 watts（double check）
   - 提取 watts 值（与审计时相同逻辑）
   - 生成 INSERT 记录：
     ```
     id: randomUUID()
     productId: product.id
     paramKey: "watts"
     rawValue: Excel 原始值（如 "9.5W"）
     normalizedValue: 提取的数字（如 "9.5"）
     unit: "W"
     sourceField: "v25.2_recoverable_watts"
     confidence: "high"
     ```
4. 批量写入，每批 500 条

### 报告

写到 `docs/v25.2-recoverable-watts-write-report.md`：

```markdown
# V25.2 RECOVERABLE Watts 写入报告

模式: dry-run / apply

## 备份
路径: backups/dev-before-v25.2-YYYYMMDD-HHMMSS.sqlite

## 统计
- 审计 RECOVERABLE 数: 383
- 实际可写入: N（排除已有 watts 的）
- 跳过（已有 watts）: N
- 写入成功: N

## 按品类

| 品类 | 写入数 |
|------|--------|
| ... |

## 写入样本（前 20 条）

| 品类 | product_name | raw_value | normalized_value |
|------|-------------|-----------|-----------------|
| ... |

## product_params 总数变化
before → after

## watts 覆盖率变化
before: N/10025 (X%) → after: N/10025 (X%)
```

### 验证

```bash
npx tsc --noEmit
npx tsx scripts/v25.2-recoverable-watts-write.ts          # dry-run
npx tsx scripts/v25.2-recoverable-watts-write.ts --apply   # 写入
```

## 不要做

- 不修改 src/ 文件
- 不修改 schema
- 不 UPDATE 或 DELETE 已有数据
