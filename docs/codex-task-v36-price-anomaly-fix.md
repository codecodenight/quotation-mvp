# V36: 修复价格异常检测误标

## 背景
V34 的 outlier 检测用品类中位数 × 10 作为上限阈值。但线条灯品类混合了两种计价方式：
- 按米单价（0.03-3 RMB），548 条
- 按条/套整灯价格（10-2000 RMB），几百条

中位数被大量按米单价拉低到 0.91 RMB，导致正常整灯价格（如瑞鑫 1200 RMB）全被标为 `outlier_high`。共 407 条线条灯误标。

同样的问题可能影响其他品类（如灯带也有按米 vs 按卷的价格差异）。

## 目标
改进 outlier 检测逻辑，避免混合计价单位品类的系统性误标。

## 方案

### 修改 `scripts/v34-price-anomaly-detect.ts`

将规则 B（统计离群）的中位数从全品类一个值，改为**分段检测**：

对每个品类：
1. 计算所有 offer 价格的 Q1（25th percentile）和 Q3（75th percentile）
2. 计算 IQR = Q3 - Q1
3. 异常下界 = Q1 - 3 × IQR（宽松系数，避免误标）
4. 异常上界 = Q3 + 3 × IQR
5. 价格 < 异常下界 → `outlier_low`
6. 价格 > 异常上界 → `outlier_high`
7. 只对 price_flag 仍为 NULL 的 offer 应用（不覆盖规则 A 的 suspicious_low/suspicious_high）

IQR 方法天然适应双峰分布 — 如果品类有两个价格段，IQR 会很大，阈值会放宽，减少误标。

### 执行步骤

1. 备份数据库
```bash
cp prisma/dev.db prisma/dev.db.bak-v36
```

2. 清除旧的 outlier 标记（保留 suspicious 标记）
```bash
sqlite3 prisma/dev.db "UPDATE supplier_offers SET price_flag = NULL WHERE price_flag IN ('outlier_low', 'outlier_high');"
```

3. 修改脚本中规则 B 的实现，改用 IQR 方法

4. 重新执行脚本
```bash
npx tsx scripts/v34-price-anomaly-detect.ts
```

5. 写报告到 `docs/v36-price-anomaly-fix-report.md`，包含：
   - 修复前各 flag 数量
   - 修复后各 flag 数量
   - 线条灯 outlier_high 数量变化（期望大幅减少）
   - 各品类的 Q1/Q3/IQR 值

### 验证
```bash
# 线条灯 outlier_high 应该大幅减少（从 407 降到 < 50）
sqlite3 prisma/dev.db "
SELECT p.category, so.price_flag, COUNT(*) 
FROM supplier_offers so 
JOIN products p ON p.id = so.product_id 
WHERE so.price_flag IS NOT NULL AND p.category = '线条灯'
GROUP BY so.price_flag;
"

npx next build
```

## 不做
- 不改规则 A（suspicious_low/suspicious_high 的绝对阈值）
- 不改 UI
- 不删除任何 offer
