import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { escapeMd, INSERT_BATCH_SIZE, productParamKey } from "./v11-shared";

const prisma = new PrismaClient();

const APPLY_MODE = process.argv.includes("--apply");
const REPORT_PATH = path.join("docs", "v13.2-rule-based-gap-fill-report.md");
const BACKUP_PATH = path.join("prisma", "dev.db.bak-v13.2");

const CATEGORY_CORE_PARAMS: Record<string, string[]> = {
  筒灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  面板灯: ["voltage", "cct", "cri", "pf", "driver_type", "material"],
  磁吸灯: ["voltage", "cct", "cri"],
  吸顶灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  灯丝灯: ["voltage", "cct", "cri", "pf", "base"],
  风扇灯: ["voltage", "cct", "cri"],
  球泡: ["voltage", "cct", "cri", "pf", "base"],
  壁灯: ["voltage", "cct", "cri", "driver_type", "material"],
  净化灯: ["voltage", "cct", "cri", "pf", "driver_type"],
  橱柜灯: ["voltage", "cct", "cri"],
  镜前灯: ["voltage", "cct", "cri", "driver_type"],
  轨道灯: ["voltage", "cct", "cri", "pf", "beam_angle"],
  防潮灯: ["voltage", "cct", "cri", "ip", "pf", "driver_type"],
  台灯: ["voltage", "cct", "cri"],
  G4G9: ["voltage", "cct", "cri", "base"],
  灯管: ["voltage", "cct", "cri", "pf"],
  线条灯: ["voltage", "cct", "cri", "ip"],
  投光灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle", "material"],
  三防灯: ["voltage", "cct", "cri", "ip", "pf"],
  太阳能壁灯: ["cct", "ip", "material"],
  太阳能: ["cct", "ip", "material"],
  路灯: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  "地埋灯/地插灯": ["voltage", "cct", "cri", "ip", "beam_angle"],
  工作灯: ["voltage", "cct", "cri", "ip"],
  庭院灯: ["voltage", "cct", "ip", "material"],
  Highbay: ["voltage", "cct", "cri", "ip", "pf", "beam_angle"],
  充电灯: ["cct", "ip", "material"],
  应急灯: ["voltage", "cct"],
  灯带: ["voltage", "cct", "cri", "ip"],
  皮线灯: ["voltage", "ip"],
};

type DbCount = bigint | number | null;

type ProductPathRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  relative_path: string | null;
};

type ProductValueRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  factory_name: string | null;
  normalized_value: string | null;
};

type MissingProductRow = {
  product_id: string;
  model_no: string | null;
  product_name: string;
  category: string | null;
  factory_name: string | null;
};

type PlannedParam = {
  id: string;
  productId: string;
  modelNo: string | null;
  productName: string;
  category: string;
  paramKey: string;
  rawValue: string;
  normalizedValue: string;
  unit: string | null;
  sourceField: "path_inference" | "voltage_inference" | "category_default" | "factory_category_default" | "name_extraction";
  confidence: "medium" | "low";
};

type PartAStats = {
  missingTotal: number;
  indoorPaths: number;
  outdoorPaths: number;
  otherPaths: number;
  conflicts: number;
  fillIp20: number;
  fillIp65: number;
};

type PartBStats = {
  missingTotal: number;
  withVoltage: number;
  fillIp65From220: number;
  fillIp20From24: number;
  skippedUnclear: number;
};

type PartCStats = {
  missingTotal: number;
  fillIp65: number;
};

type PartDStats = {
  missingTotal: number;
  factoryGroupFill: number;
  nameExtractionFill: number;
  skipped: number;
};

type PartEStats = {
  missingTotal: number;
  factoryGroupFill: number;
  skipped: number;
};

type CoverageParamRow = {
  paramKey: string;
  coveredProducts: number;
  requiredProducts: number;
};

type CoverageCategoryRow = {
  category: string;
  totalProducts: number;
  completeProducts: number;
};

type CoverageSnapshot = {
  paramRows: CoverageParamRow[];
  categoryRows: CoverageCategoryRow[];
  totalProducts: number;
  productParams: number;
  completeProducts: number;
  scopedProducts: number;
};

async function main() {
  const beforeCounts = await loadCounts();
  const existingParamKeys = await loadExistingParamKeys();
  const allPlannedParams: PlannedParam[] = [];

  const partA = await planLinearLightIp(existingParamKeys, allPlannedParams);
  const partB = await planStripLightIp(existingParamKeys, allPlannedParams);
  const partC = await planSolarIp(existingParamKeys, allPlannedParams);
  const partD = await planFilamentBase(existingParamKeys, allPlannedParams);
  const partE = await planNeonVoltage(existingParamKeys, allPlannedParams);

  const insertedParams = APPLY_MODE ? await insertParams(allPlannedParams) : 0;
  const afterCounts = await loadCounts();
  const coverage = await buildCoverageSnapshot();

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    buildReport({
      mode: APPLY_MODE ? "apply" : "dry-run",
      beforeCounts,
      afterCounts,
      insertedParams,
      partA,
      partB,
      partC,
      partD,
      partE,
      coverage,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        mode: APPLY_MODE ? "apply" : "dry-run",
        reportPath: REPORT_PATH,
        plannedParams: allPlannedParams.length,
        insertedParams,
        partA,
        partB,
        partC,
        partD,
        partE,
        productParamsBefore: beforeCounts.productParams,
        productParamsAfter: afterCounts.productParams,
      },
      null,
      2,
    ),
  );
}

async function loadCounts(): Promise<{ products: number; productParams: number }> {
  const [products, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  return { products, productParams };
}

async function loadExistingParamKeys(): Promise<Set<string>> {
  const rows = await prisma.productParam.findMany({
    where: { normalizedValue: { not: null } },
    select: { productId: true, paramKey: true, normalizedValue: true },
  });
  return new Set(
    rows
      .filter((row) => row.normalizedValue && row.normalizedValue.trim())
      .map((row) => productParamKey(row.productId, row.paramKey)),
  );
}

async function planLinearLightIp(existingParamKeys: Set<string>, plannedParams: PlannedParam[]): Promise<PartAStats> {
  const rows = await prisma.$queryRaw<ProductPathRow[]>`
    SELECT DISTINCT
      p.id as product_id,
      p.model_no,
      p.product_name,
      f.relative_path
    FROM products p
    LEFT JOIN supplier_offers so ON so.product_id = p.id
    LEFT JOIN files f ON f.id = so.source_file_id
    WHERE p.category = '线条灯'
      AND NOT EXISTS (
        SELECT 1 FROM product_params pp
        WHERE pp.product_id = p.id
          AND pp.param_key = 'ip'
          AND pp.normalized_value IS NOT NULL
          AND TRIM(pp.normalized_value) != ''
      )
  `;
  const byProduct = groupPaths(rows);
  const stats: PartAStats = {
    missingTotal: byProduct.size,
    indoorPaths: 0,
    outdoorPaths: 0,
    otherPaths: 0,
    conflicts: 0,
    fillIp20: 0,
    fillIp65: 0,
  };

  for (const product of byProduct.values()) {
    const pathKinds = product.paths.map(classifyLinearPath);
    if (pathKinds.includes("indoor")) stats.indoorPaths += 1;
    else if (pathKinds.includes("outdoor")) stats.outdoorPaths += 1;
    else stats.otherPaths += 1;

    const hasOutdoor = pathKinds.includes("outdoor");
    const hasNonOutdoor = pathKinds.some((kind) => kind !== "outdoor");
    if (hasOutdoor && hasNonOutdoor) {
      stats.conflicts += 1;
      continue;
    }

    const ip = hasOutdoor ? "65" : "20";
    const key = productParamKey(product.productId, "ip");
    if (existingParamKeys.has(key)) continue;
    plannedParams.push(buildParam(product, "ip", `IP${ip}`, ip, null, "path_inference", "medium"));
    existingParamKeys.add(key);
    if (ip === "65") stats.fillIp65 += 1;
    else stats.fillIp20 += 1;
  }

  return stats;
}

async function planStripLightIp(existingParamKeys: Set<string>, plannedParams: PlannedParam[]): Promise<PartBStats> {
  const rows = await prisma.$queryRaw<ProductValueRow[]>`
    SELECT
      p.id as product_id,
      p.model_no,
      p.product_name,
      p.category,
      NULL as factory_name,
      pp.normalized_value
    FROM products p
    LEFT JOIN product_params pp
      ON pp.product_id = p.id
      AND pp.param_key = 'voltage'
      AND pp.normalized_value IS NOT NULL
      AND TRIM(pp.normalized_value) != ''
    WHERE p.category = '灯带'
      AND NOT EXISTS (
        SELECT 1 FROM product_params ip
        WHERE ip.product_id = p.id
          AND ip.param_key = 'ip'
          AND ip.normalized_value IS NOT NULL
          AND TRIM(ip.normalized_value) != ''
      )
  `;

  const byProduct = groupValues(rows);
  const stats: PartBStats = {
    missingTotal: byProduct.size,
    withVoltage: 0,
    fillIp65From220: 0,
    fillIp20From24: 0,
    skippedUnclear: 0,
  };

  for (const product of byProduct.values()) {
    const voltages = product.values.filter(Boolean);
    if (voltages.length === 0) {
      stats.skippedUnclear += 1;
      continue;
    }
    stats.withVoltage += 1;

    const has220 = voltages.some((value) => value.replace(/\s+/g, "").startsWith("220"));
    const has24 = voltages.some((value) => value.replace(/\s+/g, "") === "24");
    if (has220 && !has24) {
      plannedParams.push(buildParam(product, "ip", "IP65", "65", null, "voltage_inference", "medium"));
      existingParamKeys.add(productParamKey(product.productId, "ip"));
      stats.fillIp65From220 += 1;
    } else if (has24 && !has220) {
      plannedParams.push(buildParam(product, "ip", "IP20", "20", null, "voltage_inference", "medium"));
      existingParamKeys.add(productParamKey(product.productId, "ip"));
      stats.fillIp20From24 += 1;
    } else {
      stats.skippedUnclear += 1;
    }
  }

  return stats;
}

async function planSolarIp(existingParamKeys: Set<string>, plannedParams: PlannedParam[]): Promise<PartCStats> {
  const products = await prisma.product.findMany({
    where: {
      category: "太阳能",
      params: {
        none: {
          paramKey: "ip",
          normalizedValue: { not: null },
        },
      },
    },
    select: { id: true, modelNo: true, productName: true, category: true },
  });

  const stats: PartCStats = { missingTotal: products.length, fillIp65: 0 };
  for (const product of products) {
    const key = productParamKey(product.id, "ip");
    if (existingParamKeys.has(key)) continue;
    plannedParams.push(
      buildParam(
        {
          productId: product.id,
          modelNo: product.modelNo,
          productName: product.productName,
          category: product.category ?? "(未分类)",
        },
        "ip",
        "IP65",
        "65",
        null,
        "category_default",
        "low",
      ),
    );
    existingParamKeys.add(key);
    stats.fillIp65 += 1;
  }
  return stats;
}

async function planFilamentBase(existingParamKeys: Set<string>, plannedParams: PlannedParam[]): Promise<PartDStats> {
  const [missingProducts, baseRows] = await Promise.all([
    loadMissingProducts("灯丝灯", "base"),
    loadFactoryParamRows("灯丝灯", "base"),
  ]);
  const factoryDistribution = buildFactoryDistribution(baseRows, normalizeBaseValue);
  const stats: PartDStats = {
    missingTotal: missingProducts.length,
    factoryGroupFill: 0,
    nameExtractionFill: 0,
    skipped: 0,
  };

  for (const product of missingProducts) {
    const key = productParamKey(product.product_id, "base");
    if (existingParamKeys.has(key)) continue;

    const factoryValue = product.factory_name ? dominantBaseForFactory(factoryDistribution.get(product.factory_name)) : null;
    if (factoryValue) {
      plannedParams.push(buildParam(toPlannable(product), "base", factoryValue, factoryValue, null, "factory_category_default", "low"));
      existingParamKeys.add(key);
      stats.factoryGroupFill += 1;
      continue;
    }

    const nameValue = extractSingleBase(`${product.model_no ?? ""} ${product.product_name}`);
    if (nameValue) {
      plannedParams.push(buildParam(toPlannable(product), "base", nameValue, nameValue, null, "name_extraction", "medium"));
      existingParamKeys.add(key);
      stats.nameExtractionFill += 1;
      continue;
    }

    stats.skipped += 1;
  }

  return stats;
}

async function planNeonVoltage(existingParamKeys: Set<string>, plannedParams: PlannedParam[]): Promise<PartEStats> {
  const [missingProducts, voltageRows] = await Promise.all([
    loadMissingProducts("皮线灯", "voltage"),
    loadFactoryParamRows("皮线灯", "voltage"),
  ]);
  const distribution = buildFactoryDistribution(voltageRows, (value) => value.trim());
  const stats: PartEStats = { missingTotal: missingProducts.length, factoryGroupFill: 0, skipped: 0 };

  for (const product of missingProducts) {
    const key = productParamKey(product.product_id, "voltage");
    if (existingParamKeys.has(key)) continue;
    const dominant = product.factory_name ? dominantValueForFactory(distribution.get(product.factory_name), 0.85) : null;
    if (!dominant) {
      stats.skipped += 1;
      continue;
    }
    plannedParams.push(buildParam(toPlannable(product), "voltage", `${dominant}V`, dominant, "V", "factory_category_default", "low"));
    existingParamKeys.add(key);
    stats.factoryGroupFill += 1;
  }

  return stats;
}

async function loadMissingProducts(category: string, paramKey: string): Promise<MissingProductRow[]> {
  return prisma.$queryRaw<MissingProductRow[]>`
    SELECT
      p.id as product_id,
      p.model_no,
      p.product_name,
      p.category,
      (
        SELECT so.factory_name
        FROM supplier_offers so
        WHERE so.product_id = p.id
        ORDER BY so.created_at ASC
        LIMIT 1
      ) as factory_name
    FROM products p
    WHERE p.category = ${category}
      AND NOT EXISTS (
        SELECT 1 FROM product_params pp
        WHERE pp.product_id = p.id
          AND pp.param_key = ${paramKey}
          AND pp.normalized_value IS NOT NULL
          AND TRIM(pp.normalized_value) != ''
      )
  `;
}

async function loadFactoryParamRows(category: string, paramKey: string): Promise<ProductValueRow[]> {
  return prisma.$queryRaw<ProductValueRow[]>`
    SELECT
      p.id as product_id,
      p.model_no,
      p.product_name,
      p.category,
      (
        SELECT so.factory_name
        FROM supplier_offers so
        WHERE so.product_id = p.id
        ORDER BY so.created_at ASC
        LIMIT 1
      ) as factory_name,
      pp.normalized_value
    FROM products p
    JOIN product_params pp ON pp.product_id = p.id
    WHERE p.category = ${category}
      AND pp.param_key = ${paramKey}
      AND pp.normalized_value IS NOT NULL
      AND TRIM(pp.normalized_value) != ''
  `;
}

async function buildCoverageSnapshot(): Promise<CoverageSnapshot> {
  const [totalProducts, productParams] = await Promise.all([prisma.product.count(), prisma.productParam.count()]);
  const paramTotals = new Map<string, { coveredProducts: number; requiredProducts: number }>();
  const categoryRows: CoverageCategoryRow[] = [];
  let completeProducts = 0;
  let scopedProducts = 0;

  for (const [category, coreParams] of Object.entries(CATEGORY_CORE_PARAMS)) {
    const placeholders = coreParams.map(() => "?").join(", ");
    const [counts, breakdownRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ total_products: DbCount; complete_products: DbCount }>>(
        `
          SELECT
            COUNT(*) as total_products,
            SUM(CASE WHEN core_param_count = ? THEN 1 ELSE 0 END) as complete_products
          FROM (
            SELECT
              p.id,
              (
                SELECT COUNT(DISTINCT pp.param_key)
                FROM product_params pp
                WHERE pp.product_id = p.id
                  AND pp.param_key IN (${placeholders})
                  AND pp.normalized_value IS NOT NULL
                  AND TRIM(pp.normalized_value) != ''
              ) as core_param_count
            FROM products p
            WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') = ?
          ) scoped_products
        `,
        coreParams.length,
        ...coreParams,
        category,
      ),
      prisma.$queryRawUnsafe<Array<{ param_key: string; product_count: DbCount }>>(
        `
          SELECT
            pp.param_key,
            COUNT(DISTINCT pp.product_id) as product_count
          FROM product_params pp
          JOIN products p ON p.id = pp.product_id
          WHERE COALESCE(NULLIF(TRIM(p.category), ''), '未分类') = ?
            AND pp.param_key IN (${placeholders})
            AND pp.normalized_value IS NOT NULL
            AND TRIM(pp.normalized_value) != ''
          GROUP BY pp.param_key
        `,
        category,
        ...coreParams,
      ),
    ]);

    const total = toNumber(counts[0]?.total_products);
    if (total <= 0) continue;
    const complete = toNumber(counts[0]?.complete_products);
    categoryRows.push({ category, totalProducts: total, completeProducts: complete });
    completeProducts += complete;
    scopedProducts += total;

    const breakdown = Object.fromEntries(coreParams.map((paramKey) => [paramKey, 0]));
    for (const row of breakdownRows) {
      breakdown[row.param_key] = toNumber(row.product_count);
    }
    for (const paramKey of coreParams) {
      const totalForParam = paramTotals.get(paramKey) ?? { coveredProducts: 0, requiredProducts: 0 };
      totalForParam.coveredProducts += breakdown[paramKey] ?? 0;
      totalForParam.requiredProducts += total;
      paramTotals.set(paramKey, totalForParam);
    }
  }

  categoryRows.sort((left, right) => {
    const leftRate = left.totalProducts > 0 ? left.completeProducts / left.totalProducts : 0;
    const rightRate = right.totalProducts > 0 ? right.completeProducts / right.totalProducts : 0;
    return rightRate - leftRate || right.totalProducts - left.totalProducts || left.category.localeCompare(right.category);
  });

  return {
    paramRows: Array.from(paramTotals.entries())
      .map(([paramKey, counts]) => ({ paramKey, ...counts }))
      .sort((left, right) => right.requiredProducts - left.requiredProducts || left.paramKey.localeCompare(right.paramKey)),
    categoryRows,
    totalProducts,
    productParams,
    completeProducts,
    scopedProducts,
  };
}

async function insertParams(plannedParams: PlannedParam[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < plannedParams.length; index += INSERT_BATCH_SIZE) {
    const chunk = plannedParams.slice(index, index + INSERT_BATCH_SIZE);
    const result = await prisma.productParam.createMany({
      data: chunk.map((param) => ({
        id: param.id,
        productId: param.productId,
        paramKey: param.paramKey,
        rawValue: param.rawValue,
        normalizedValue: param.normalizedValue,
        unit: param.unit,
        sourceField: param.sourceField,
        confidence: param.confidence,
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

function buildReport(input: {
  mode: "dry-run" | "apply";
  beforeCounts: { products: number; productParams: number };
  afterCounts: { products: number; productParams: number };
  insertedParams: number;
  partA: PartAStats;
  partB: PartBStats;
  partC: PartCStats;
  partD: PartDStats;
  partE: PartEStats;
  coverage: CoverageSnapshot;
}): string {
  return `# V13.2 规则填充报告

模式: ${input.mode}
时间: ${new Date().toISOString()}
备份: ${BACKUP_PATH}

## Part A — 线条灯 IP 路径推断

| 指标 | 数量 |
|---|---:|
| 线条灯缺 IP 总数 | ${input.partA.missingTotal} |
| 源文件路径 室内 | ${input.partA.indoorPaths} |
| 源文件路径 户外 | ${input.partA.outdoorPaths} |
| 源文件路径 其他 | ${input.partA.otherPaths} |
| 路径冲突跳过 | ${input.partA.conflicts} |
| 填充 IP20 | ${input.partA.fillIp20} |
| 填充 IP65 | ${input.partA.fillIp65} |

## Part B — 灯带 IP 电压推断

| 指标 | 数量 |
|---|---:|
| 灯带缺 IP 总数 | ${input.partB.missingTotal} |
| 有 voltage 的 | ${input.partB.withVoltage} |
| 220V → IP65 | ${input.partB.fillIp65From220} |
| 24V → IP20 | ${input.partB.fillIp20From24} |
| 跳过（电压不明确） | ${input.partB.skippedUnclear} |

## Part C — 太阳能 IP65 品类默认

| 指标 | 数量 |
|---|---:|
| 太阳能缺 IP | ${input.partC.missingTotal} |
| 填充 IP65 | ${input.partC.fillIp65} |

## Part D — 灯丝灯 base 填充

| 指标 | 数量 |
|---|---:|
| 灯丝灯缺 base | ${input.partD.missingTotal} |
| 工厂分组填充 | ${input.partD.factoryGroupFill} |
| 名称提取填充 | ${input.partD.nameExtractionFill} |
| 跳过 | ${input.partD.skipped} |

## Part E — 皮线灯 voltage 工厂推断

| 指标 | 数量 |
|---|---:|
| 皮线灯缺 voltage | ${input.partE.missingTotal} |
| 工厂分组填充 | ${input.partE.factoryGroupFill} |
| 跳过 | ${input.partE.skipped} |

## Part F — 覆盖率快照

### 逐参数覆盖率

| param_key | 已覆盖 | 需覆盖(品类要求) | 覆盖率 |
|---|---:|---:|---:|
${input.coverage.paramRows
  .map((row) => `| ${escapeMd(row.paramKey)} | ${row.coveredProducts} | ${row.requiredProducts} | ${formatPercent(row.coveredProducts, row.requiredProducts)} |`)
  .join("\n")}

### 品类完成率（核心参数全部有值）

| 品类 | 总产品 | 全部完成 | 完成率 |
|---|---:|---:|---:|
${input.coverage.categoryRows
  .map((row) => `| ${escapeMd(row.category)} | ${row.totalProducts} | ${row.completeProducts} | ${formatPercent(row.completeProducts, row.totalProducts)} |`)
  .join("\n")}

### 全局汇总

| 指标 | 数值 |
|---|---:|
| product_params 变化 | ${input.beforeCounts.productParams} → ${input.afterCounts.productParams} |
| 本次新增 | ${input.insertedParams} |
| 总产品 | ${input.coverage.totalProducts} |
| 核心参数覆盖范围产品 | ${input.coverage.scopedProducts} |
| 核心参数全部完成产品 | ${input.coverage.completeProducts} |
| 全局完成率 | ${formatPercent(input.coverage.completeProducts, input.coverage.scopedProducts)} |

## DB 计数

| 表 | 执行前 | 执行后 | 变化 |
|---|---:|---:|---:|
| products | ${input.beforeCounts.products} | ${input.afterCounts.products} | ${input.afterCounts.products - input.beforeCounts.products} |
| product_params | ${input.beforeCounts.productParams} | ${input.afterCounts.productParams} | ${input.afterCounts.productParams - input.beforeCounts.productParams} |
`;
}

function groupPaths(rows: ProductPathRow[]): Map<
  string,
  { productId: string; modelNo: string | null; productName: string; category: string; paths: string[] }
> {
  const byProduct = new Map<string, { productId: string; modelNo: string | null; productName: string; category: string; paths: string[] }>();
  for (const row of rows) {
    const product =
      byProduct.get(row.product_id) ??
      {
        productId: row.product_id,
        modelNo: row.model_no,
        productName: row.product_name,
        category: "线条灯",
        paths: [],
      };
    if (row.relative_path) product.paths.push(row.relative_path);
    byProduct.set(row.product_id, product);
  }
  return byProduct;
}

function groupValues(rows: ProductValueRow[]): Map<
  string,
  { productId: string; modelNo: string | null; productName: string; category: string; values: string[] }
> {
  const byProduct = new Map<string, { productId: string; modelNo: string | null; productName: string; category: string; values: string[] }>();
  for (const row of rows) {
    const product =
      byProduct.get(row.product_id) ??
      {
        productId: row.product_id,
        modelNo: row.model_no,
        productName: row.product_name,
        category: row.category ?? "(未分类)",
        values: [],
      };
    if (row.normalized_value) product.values.push(row.normalized_value);
    byProduct.set(row.product_id, product);
  }
  return byProduct;
}

function classifyLinearPath(relativePath: string): "indoor" | "outdoor" | "other" {
  if (relativePath.includes("户外")) return "outdoor";
  if (relativePath.includes("室内照明")) return "indoor";
  return "other";
}

function buildFactoryDistribution(
  rows: ProductValueRow[],
  normalizeValue: (value: string) => string | null,
): Map<string, Map<string, Set<string>>> {
  const distribution = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    if (!row.factory_name || !row.normalized_value) continue;
    const value = normalizeValue(row.normalized_value);
    if (!value) continue;
    const factoryMap = distribution.get(row.factory_name) ?? new Map<string, Set<string>>();
    const productIds = factoryMap.get(value) ?? new Set<string>();
    productIds.add(row.product_id);
    factoryMap.set(value, productIds);
    distribution.set(row.factory_name, factoryMap);
  }
  return distribution;
}

function dominantValueForFactory(distribution: Map<string, Set<string>> | undefined, threshold: number): string | null {
  if (!distribution || distribution.size === 0) return null;
  const totalProductIds = new Set<string>();
  for (const productIds of distribution.values()) {
    for (const productId of productIds) totalProductIds.add(productId);
  }
  const total = totalProductIds.size;
  if (total === 0) return null;

  let dominant: { value: string; count: number } | null = null;
  for (const [value, productIds] of distribution.entries()) {
    const count = productIds.size;
    if (!dominant || count > dominant.count) dominant = { value, count };
  }

  return dominant && dominant.count / total >= threshold ? dominant.value : null;
}

function dominantBaseForFactory(distribution: Map<string, Set<string>> | undefined): "E27" | "E14" | null {
  if (!distribution || distribution.size === 0) return null;
  const productIds = new Set<string>();
  const e27ProductIds = new Set<string>();
  const e14ProductIds = new Set<string>();

  for (const [value, ids] of distribution.entries()) {
    for (const productId of ids) {
      productIds.add(productId);
      if (value === "E27") e27ProductIds.add(productId);
      if (value === "E14") e14ProductIds.add(productId);
    }
  }

  if (productIds.size === 0) return null;
  const e27Ratio = e27ProductIds.size / productIds.size;
  const e14Ratio = e14ProductIds.size / productIds.size;
  if (e27Ratio >= 0.85 && e14Ratio < 0.85) return "E27";
  if (e14Ratio >= 0.85 && e27Ratio < 0.85) return "E14";
  return null;
}

function normalizeBaseValue(value: string): "E27" | "E14" | null {
  const upper = value.toUpperCase();
  const hasE27 = /\bE\s*27\b/.test(upper) || /E27/.test(upper);
  const hasE14 = /\bE\s*14\b/.test(upper) || /E14/.test(upper);
  if (hasE27 && !hasE14) return "E27";
  if (hasE14 && !hasE27) return "E14";
  return null;
}

function extractSingleBase(text: string): "E27" | "E14" | null {
  return normalizeBaseValue(text);
}

function buildParam(
  product: { productId: string; modelNo: string | null; productName: string; category: string },
  paramKey: string,
  rawValue: string,
  normalizedValue: string,
  unit: string | null,
  sourceField: PlannedParam["sourceField"],
  confidence: PlannedParam["confidence"],
): PlannedParam {
  return {
    id: randomUUID(),
    productId: product.productId,
    modelNo: product.modelNo,
    productName: product.productName,
    category: product.category,
    paramKey,
    rawValue,
    normalizedValue,
    unit,
    sourceField,
    confidence,
  };
}

function toPlannable(product: MissingProductRow): { productId: string; modelNo: string | null; productName: string; category: string } {
  return {
    productId: product.product_id,
    modelNo: product.model_no,
    productName: product.product_name,
    category: product.category ?? "(未分类)",
  };
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
