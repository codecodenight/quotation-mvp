import { prisma } from "./prisma";

type DbCount = bigint | number | null;

export type CategoryQuality = {
  category: string;
  productCount: number;
  offerCount: number;
  imageCount: number;
  paramProductCount: number;
  sizeProductCount: number;
  ctnOfferCount: number;
};

export type ParamKeyCoverage = {
  paramKey: string;
  productCount: number;
  percentage: number;
};

export type CategoryParamCoverage = {
  category: string;
  paramKey: string;
  productCount: number;
};

export type CategoryCompletion = {
  category: string;
  totalProducts: number;
  completeProducts: number;
  coreParamCount: number;
  paramBreakdown: Record<string, number>;
};

export type DataQualitySummary = {
  categories: CategoryQuality[];
  totals: CategoryQuality;
  paramCoverage: ParamKeyCoverage[];
  categoryParamMatrix: CategoryParamCoverage[];
};

export type ProductQualityRow = {
  category: string | null;
  product_count: DbCount;
  image_count: DbCount;
};

export type OfferQualityRow = {
  category: string | null;
  offer_count: DbCount;
  ctn_count: DbCount;
};

export type ParamQualityRow = {
  category: string | null;
  param_product_count: DbCount;
};

export type SizeQualityRow = {
  category: string | null;
  size_count: DbCount;
};

export type ParamKeyCoverageRow = {
  param_key: string;
  product_count: DbCount;
};

export type CategoryParamCoverageRow = {
  category: string | null;
  param_key: string;
  product_count: DbCount;
};

type DataQualityRows = {
  productRows: ProductQualityRow[];
  offerRows: OfferQualityRow[];
  paramRows: ParamQualityRow[];
  sizeRows: SizeQualityRow[];
  paramCoverageRows?: ParamKeyCoverageRow[];
  categoryParamRows?: CategoryParamCoverageRow[];
};

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

export async function getDataQuality(): Promise<DataQualitySummary> {
  const [productRows, offerRows, paramRows, sizeRows, paramCoverageRows, categoryParamRows] = await Promise.all([
    prisma.$queryRaw<ProductQualityRow[]>`
      SELECT
        COALESCE(category, '未分类') as category,
        COUNT(*) as product_count,
        SUM(CASE WHEN image_path IS NOT NULL AND TRIM(image_path) != '' THEN 1 ELSE 0 END) as image_count
      FROM products
      GROUP BY category
      ORDER BY COUNT(*) DESC
    `,
    prisma.$queryRaw<OfferQualityRow[]>`
      SELECT
        COALESCE(p.category, '未分类') as category,
        COUNT(*) as offer_count,
        SUM(CASE WHEN so.ctn_qty IS NOT NULL AND TRIM(so.ctn_qty) != '' THEN 1 ELSE 0 END) as ctn_count
      FROM supplier_offers so
      JOIN products p ON so.product_id = p.id
      GROUP BY p.category
    `,
    prisma.$queryRaw<ParamQualityRow[]>`
      SELECT
        COALESCE(p.category, '未分类') as category,
        COUNT(DISTINCT pp.product_id) as param_product_count
      FROM product_params pp
      JOIN products p ON pp.product_id = p.id
      GROUP BY p.category
    `,
    prisma.$queryRaw<SizeQualityRow[]>`
      SELECT
        COALESCE(p.category, '未分类') as category,
        COUNT(DISTINCT p.id) as size_count
      FROM products p
      WHERE (p.size IS NOT NULL AND TRIM(p.size) != '')
         OR EXISTS (
           SELECT 1 FROM product_params pp
           WHERE pp.product_id = p.id
             AND pp.param_key IN ('size_display', 'length_mm', 'width_mm', 'height_mm')
             AND pp.normalized_value IS NOT NULL
             AND TRIM(pp.normalized_value) != ''
         )
      GROUP BY p.category
    `,
    prisma.$queryRawUnsafe<ParamKeyCoverageRow[]>(`
      SELECT
        pp.param_key,
        COUNT(DISTINCT pp.product_id) as product_count
      FROM product_params pp
      WHERE pp.param_key IN (
        'watts','voltage','cct','cri','ip','pf',
        'driver_type','material','luminous_efficacy','base','size_display'
      )
      GROUP BY pp.param_key
      ORDER BY product_count DESC
    `),
    prisma.$queryRawUnsafe<CategoryParamCoverageRow[]>(`
      SELECT
        COALESCE(p.category, '未分类') as category,
        pp.param_key,
        COUNT(DISTINCT pp.product_id) as product_count
      FROM product_params pp
      JOIN products p ON pp.product_id = p.id
      WHERE pp.param_key IN (
        'watts','voltage','cct','cri','ip','pf',
        'driver_type','material','luminous_efficacy'
      )
      GROUP BY p.category, pp.param_key
    `),
  ]);

  return buildDataQualitySummary({ productRows, offerRows, paramRows, sizeRows, paramCoverageRows, categoryParamRows });
}

export async function getCategoryCompletionData(): Promise<CategoryCompletion[]> {
  const completionRows: CategoryCompletion[] = [];

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

    const totalProducts = toNumber(counts[0]?.total_products);
    if (totalProducts <= 0) {
      continue;
    }

    const paramBreakdown = Object.fromEntries(coreParams.map((paramKey) => [paramKey, 0]));
    for (const row of breakdownRows) {
      paramBreakdown[row.param_key] = toNumber(row.product_count);
    }

    completionRows.push({
      category,
      totalProducts,
      completeProducts: toNumber(counts[0]?.complete_products),
      coreParamCount: coreParams.length,
      paramBreakdown,
    });
  }

  return completionRows.sort((left, right) => {
    const leftRate = left.totalProducts > 0 ? left.completeProducts / left.totalProducts : 0;
    const rightRate = right.totalProducts > 0 ? right.completeProducts / right.totalProducts : 0;
    return rightRate - leftRate || right.totalProducts - left.totalProducts || left.category.localeCompare(right.category);
  });
}

export function buildDataQualitySummary(rows: DataQualityRows): DataQualitySummary {
  const byCategory = new Map<string, CategoryQuality>();

  for (const row of rows.productRows) {
    const quality = getOrCreateCategory(byCategory, row.category);
    quality.productCount = toNumber(row.product_count);
    quality.imageCount = toNumber(row.image_count);
  }

  for (const row of rows.offerRows) {
    const quality = getOrCreateCategory(byCategory, row.category);
    quality.offerCount = toNumber(row.offer_count);
    quality.ctnOfferCount = toNumber(row.ctn_count);
  }

  for (const row of rows.paramRows) {
    const quality = getOrCreateCategory(byCategory, row.category);
    quality.paramProductCount = toNumber(row.param_product_count);
  }

  for (const row of rows.sizeRows) {
    const quality = getOrCreateCategory(byCategory, row.category);
    quality.sizeProductCount = toNumber(row.size_count);
  }

  const categories = Array.from(byCategory.values()).sort(
    (left, right) => right.productCount - left.productCount || left.category.localeCompare(right.category),
  );

  const totals = categories.reduce(
    (totals, category) => ({
      category: "全部",
      productCount: totals.productCount + category.productCount,
      offerCount: totals.offerCount + category.offerCount,
      imageCount: totals.imageCount + category.imageCount,
      paramProductCount: totals.paramProductCount + category.paramProductCount,
      sizeProductCount: totals.sizeProductCount + category.sizeProductCount,
      ctnOfferCount: totals.ctnOfferCount + category.ctnOfferCount,
    }),
    createEmptyCategory("全部"),
  );

  const totalProducts = totals.productCount;
  const paramCoverage = (rows.paramCoverageRows ?? []).map((row) => {
    const productCount = toNumber(row.product_count);
    return {
      paramKey: row.param_key,
      productCount,
      percentage: totalProducts > 0 ? (productCount / totalProducts) * 100 : 0,
    };
  });

  const categoryParamMatrix = (rows.categoryParamRows ?? []).map((row) => ({
    category: row.category?.trim() || "未分类",
    paramKey: row.param_key,
    productCount: toNumber(row.product_count),
  }));

  return {
    categories,
    totals,
    paramCoverage,
    categoryParamMatrix,
  };
}

function getOrCreateCategory(categories: Map<string, CategoryQuality>, category: string | null): CategoryQuality {
  const normalizedCategory = category?.trim() || "未分类";
  const existing = categories.get(normalizedCategory);
  if (existing) {
    return existing;
  }

  const quality = createEmptyCategory(normalizedCategory);
  categories.set(normalizedCategory, quality);
  return quality;
}

function createEmptyCategory(category: string): CategoryQuality {
  return {
    category,
    productCount: 0,
    offerCount: 0,
    imageCount: 0,
    paramProductCount: 0,
    sizeProductCount: 0,
    ctnOfferCount: 0,
  };
}

function toNumber(value: DbCount): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value ?? 0;
}
