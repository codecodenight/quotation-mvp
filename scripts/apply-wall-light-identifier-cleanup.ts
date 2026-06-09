/* eslint-disable @typescript-eslint/no-require-imports */
{
const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const XLSX = require("xlsx") as typeof import("xlsx");
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

const prisma = new PrismaClient();
const reportPath = "docs/v2.3-wall-light-identifier-cleanup-report.md";

type AppliedRow = {
  id: string;
  oldModelNo: string;
  newModelNo: string;
  price: string;
  sourceRow: number;
};

async function main() {
  const appliedRows: AppliedRow[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { category: "壁灯", modelNo: { startsWith: "壁灯-" } },
      include: {
        supplierOffers: {
          include: { sourceFile: true },
          orderBy: [{ purchasePrice: "asc" }],
        },
      },
      orderBy: [{ modelNo: "asc" }],
    });

    for (const product of products) {
      if (product.supplierOffers.length !== 1) {
        throw new Error(`${product.modelNo ?? product.productName} 报价数量异常：${product.supplierOffers.length}`);
      }

      const offer = product.supplierOffers[0];
      const sourcePath = offer.sourceFile?.absolutePathSnapshot;
      if (!sourcePath) {
        throw new Error(`${product.modelNo ?? product.productName} 缺少来源文件路径`);
      }

      const sourceRowIndex = readTrailingNumber(product.modelNo ?? product.productName);
      if (!sourceRowIndex) {
        throw new Error(`${product.modelNo ?? product.productName} 缺少源表行号`);
      }

      const sourceRow = readWallLightSourceRow(sourcePath, sourceRowIndex);
      if (!sourceRow) {
        throw new Error(`${product.modelNo ?? product.productName} 无法读取源表 row ${sourceRowIndex}`);
      }

      const newModelNo = buildWallLightModelName(sourceRow);
      const newRemark = buildWallLightRemark(sourceRow);

      await tx.product.update({
        where: { id: product.id },
        data: {
          productName: newModelNo,
          modelNo: newModelNo,
          material: sourceRow.material || product.material,
          size: sourceRow.dimension || product.size,
          remark: newRemark,
        },
      });

      appliedRows.push({
        id: product.id,
        oldModelNo: product.modelNo ?? "",
        newModelNo,
        price: offer.purchasePrice.toString(),
        sourceRow: sourceRowIndex,
      });
    }

    return { productsUpdated: products.length };
  });

  await fs.writeFile(reportPath, renderReport(appliedRows), "utf8");
  console.log(JSON.stringify({ ...result, report: reportPath }, null, 2));
}

function readWallLightSourceRow(sourcePath: string, rowIndex: number) {
  const workbook = XLSX.readFile(sourcePath, { cellDates: false });
  const sheet = workbook.Sheets["第1页"];
  if (!sheet) {
    return null;
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as string[][];
  const row = rows[rowIndex - 1];
  if (!row) {
    return null;
  }

  return {
    rowIndex,
    wattage: cleanCell(row[2]),
    material: cleanCell(row[3]),
    housing: cleanCell(row[4]),
    dimension: cleanCell(row[5]),
    driver: cleanCell(row[6]),
    grounding: cleanCell(row[7]),
    gasket: cleanCell(row[8]),
    cri: cleanCell(row[9]),
    moq: cleanCell(row[11]),
    price: cleanCell(row[12]),
  };
}

function buildWallLightModelName(sourceRow: NonNullable<ReturnType<typeof readWallLightSourceRow>>): string {
  return ["Wall Light", sourceRow.wattage, sourceRow.material, normalizeDimensionForModel(sourceRow.dimension)]
    .filter(Boolean)
    .join(" ");
}

function buildWallLightRemark(sourceRow: NonNullable<ReturnType<typeof readWallLightSourceRow>>): string {
  return [
    sourceRow.wattage ? `Wattage: ${sourceRow.wattage}` : "",
    sourceRow.material ? `Material: ${sourceRow.material}` : "",
    sourceRow.housing ? `Housing: ${sourceRow.housing}` : "",
    sourceRow.driver ? `Driver: ${sourceRow.driver}` : "",
    sourceRow.grounding ? `Grounding: ${sourceRow.grounding}` : "",
    sourceRow.gasket ? `Gasket: ${sourceRow.gasket}` : "",
    sourceRow.cri ? `CRI: ${sourceRow.cri}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function readTrailingNumber(value: string): number | null {
  const match = value.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeDimensionForModel(value: string): string {
  return value.replace(/[×*]/g, "x").replace(/\s+/g, "");
}

function cleanCell(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function renderReport(rows: AppliedRow[]): string {
  const lines = [
    "# V2.3 Wall Light Identifier Cleanup Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    `- Products updated: ${rows.length}`,
    "- Prices and supplier offers were not changed.",
    "- Products were not merged, because source images may distinguish same-spec rows.",
    "",
    "| # | Source row | Old model_no | New model_no | Price |",
    "|---:|---:|---|---|---:|",
  ];

  rows.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.sourceRow} | ${md(row.oldModelNo)} | ${md(row.newModelNo)} | ${md(row.price)} |`);
  });

  return lines.join("\n");
}

function md(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").replaceAll("|", "\\|").slice(0, 180);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
}
