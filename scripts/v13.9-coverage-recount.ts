import { PrismaClient } from "@prisma/client";

import { CATEGORY_CORE_PARAMS, loadAccessoryProductIds } from "./v11-shared";

const prisma = new PrismaClient();

type ProductRow = {
  id: string;
  category: string | null;
};

async function main() {
  const [products, params, accessoryIds] = await Promise.all([
    prisma.product.findMany({ select: { id: true, category: true } }),
    prisma.productParam.findMany({
      where: { normalizedValue: { not: null } },
      select: { productId: true, paramKey: true, normalizedValue: true },
    }),
    loadAccessoryProductIds(prisma),
  ]);

  const paramKeysByProduct = new Map<string, Set<string>>();
  for (const param of params) {
    if (!param.normalizedValue?.trim()) continue;
    const keys = paramKeysByProduct.get(param.productId) ?? new Set<string>();
    keys.add(param.paramKey);
    paramKeysByProduct.set(param.productId, keys);
  }

  let scopedProducts = 0;
  let completeProducts = 0;
  const byCategory = new Map<string, { total: number; complete: number }>();
  for (const product of products as ProductRow[]) {
    if (accessoryIds.has(product.id)) continue;
    const category = product.category?.trim();
    if (!category) continue;
    const coreParams = CATEGORY_CORE_PARAMS[category];
    if (!coreParams) continue;
    scopedProducts += 1;
    const item = byCategory.get(category) ?? { total: 0, complete: 0 };
    item.total += 1;
    const keys = paramKeysByProduct.get(product.id) ?? new Set<string>();
    const complete = coreParams.every((paramKey) => keys.has(paramKey));
    if (complete) {
      completeProducts += 1;
      item.complete += 1;
    }
    byCategory.set(category, item);
  }

  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        accessoryProducts: accessoryIds.size,
        scopedProducts,
        completeProducts,
        completionRate: scopedProducts > 0 ? `${((completeProducts / scopedProducts) * 100).toFixed(1)}%` : "0.0%",
        categoryCount: byCategory.size,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
