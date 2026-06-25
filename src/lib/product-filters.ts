import { prisma } from "./prisma";

export type ProductFilterOption = {
  value: string;
  count: number;
};

export type ProductCategoryOption = {
  category: string;
  count: number;
};

export async function getCategoryOptions(): Promise<ProductCategoryOption[]> {
  const categories = await prisma.product.groupBy({
    by: ["category"],
    where: { category: { not: null } },
    _count: { _all: true },
  });

  const options: ProductCategoryOption[] = [];
  for (const category of categories) {
    if (category.category) {
      options.push({
        category: category.category,
        count: category._count._all,
      });
    }
  }
  return options.sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

export async function getIpOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("ip");
}

export async function getCctOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("cct");
}

export async function getVoltageOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("voltage");
}

export async function getMaterialOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("material");
}

export async function getDriverTypeOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("driver_type");
}

export async function getCriOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("cri");
}

export async function getPfOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("pf");
}

export async function getBeamAngleOptions(): Promise<ProductFilterOption[]> {
  return getParamOptions("beam_angle");
}

export async function getProductIdsByWattsRange(
  minWatts: string,
  maxWatts: string,
): Promise<string[] | null> {
  return getProductIdsByParamRange("watts", minWatts, maxWatts);
}

export async function getProductIdsByParamRange(
  paramKey: string,
  minValue: string | number | null,
  maxValue: string | number | null,
): Promise<string[] | null> {
  const min = parseOptionalNonNegativeDecimal(minValue);
  const max = parseOptionalNonNegativeDecimal(maxValue);
  if (min === null && max === null) {
    return null;
  }

  let sql = "SELECT DISTINCT product_id FROM product_params WHERE param_key = ?";
  const params: Array<string | number> = [paramKey];
  if (min !== null) {
    sql += " AND CAST(normalized_value AS REAL) >= ?";
    params.push(min);
  }
  if (max !== null) {
    sql += " AND CAST(normalized_value AS REAL) <= ?";
    params.push(max);
  }

  const rows = await prisma.$queryRawUnsafe<{ product_id: string }[]>(sql, ...params);
  return rows.map((row) => row.product_id);
}

export function parseOptionalNonNegativeDecimal(value: string | number | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

async function getParamOptions(paramKey: string): Promise<ProductFilterOption[]> {
  const rows = await prisma.$queryRaw<{ normalized_value: string; cnt: bigint }[]>`
    SELECT normalized_value, COUNT(*) as cnt
    FROM product_params
    WHERE param_key = ${paramKey}
      AND normalized_value IS NOT NULL
      AND TRIM(normalized_value) <> ''
    GROUP BY normalized_value
    ORDER BY cnt DESC
  `;

  return rows.map((row) => ({
    value: row.normalized_value,
    count: Number(row.cnt),
  }));
}
