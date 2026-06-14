import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DB_PATH = "prisma/dev.db";
const SOURCE_ROOT = "/Volumes/My Passport/AI 报价/各家工厂最新报价汇总";
const AUDIT_REPORT_PATH = "docs/v2.19f-audit.md";
const FIX_REPORT_PATH = "docs/v2.19f-fix-result.md";

const NEON_RELATIVE_PATH = "灯带/尼奥/尼奥-广交会灯带选品核价 - 高压无导线+柔性 更新 20250331.xls";
const OUNUO_USD_RELATIVE_PATH =
  "室内照明/小面板灯/欧诺 塑料 小面板灯/核价Wellux Quotation of led panel 20220127 欧诺塑料款筒灯.xlsx";
const OUNUO_RMB_RELATIVE_PATH =
  "室内照明/小面板灯/欧诺 塑料 小面板灯/塑料面板灯 报价单2022.01.08.xlsx";
const OUNUO_GROUND_RELATIVE_PATH = "户外照明 工业照明/LED 地埋灯地插灯/欧诺/欧诺塑料地插灯报价单11月份.xlsx";

type NeonTarget = {
  modelNo: string;
  badPrice: number;
  anchorPrice?: number;
};

const NEON_TARGETS: NeonTarget[] = [
  { modelNo: "LST-110/220V-NW-2835-120", badPrice: 2835, anchorPrice: 1.74 },
  { modelNo: "LST-110/220V-NW-2835-180", badPrice: 2835 },
  { modelNo: "LST-110/220V-NW-2835-240", badPrice: 2835, anchorPrice: 3.72 },
  { modelNo: "LST-110/220V-NW-5050-60", badPrice: 5050 },
  { modelNo: "LST-110/220V-NW-5050-96", badPrice: 5050 },
  { modelNo: "LST-110/220V-NW-COB-240免驱", badPrice: 240 },
  { modelNo: "LST-110/220V-NW-COB-288免驱", badPrice: 288 },
] as const;

const RUIXIN_DELETE_MODELS = ["0.7PS", "0.8PS+1.2棱镜板", "295*1195*32mm-40W", "595*1195*32mm-60W", "595*595*32mm-40W"];
const RUIXIN_KEEP_MODELS = ["36/40W", "PP0.7", "PP0.8", "PP1.0"];
const OUNUO_WATTAGE_MODELS = ["3W", "5W"];

type Mode = "audit" | "fix";
type Part = "a" | "b" | "c";
type CellValue = string | number | boolean | Date | null | undefined;
type Rows = string[][];

type NeonCandidateRow = {
  sheetName: string;
  rowNumber: number;
  modelNo: string;
  noTaxPrice: number | null;
  taxPrice: number | null;
  rowPreview: string;
};

type NeonAuditRow = {
  productId: string | null;
  offerId: string | null;
  modelNo: string;
  currentPrice: number | null;
  sourcePrice: number | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  action: "update" | "skip";
  reason: string;
};

type DeleteAuditRow = {
  productId: string;
  offerIds: string[];
  modelNo: string;
  price: number | null;
  imagePath: string | null;
  quoteRefs: number;
  paramCount: number;
  offerCount: number;
  action: "delete-product" | "skip";
  reason: string;
};

type OunuoAudit = {
  usdOffers: Array<{
    productId: string;
    offerId: string;
    modelNo: string | null;
    price: number;
    currency: string;
    quoteRefs: number;
  }>;
  usdHeaderLines: string[];
  rmbHeaderLines: string[];
  groundHeaderLines: string[];
  shapeOffers: Array<{
    productId: string;
    offerId: string;
    modelNo: string | null;
    price: number;
    quoteRefs: number;
  }>;
  wattageOffers: Array<{
    productId: string;
    offerId: string;
    modelNo: string | null;
    price: number;
    quoteRefs: number;
    productOfferCount: number;
    sourcePrice: number | null;
    action: "delete-offer" | "skip";
    reason: string;
  }>;
  currencyAction: "update-usd" | "skip";
  currencyReason: string;
};

type AuditResult = {
  mode: Mode;
  partFilter: Part | "all";
  backupPath?: string;
  neon?: {
    sourcePath: string;
    headerLines: string[];
    candidates: NeonCandidateRow[];
    rows: NeonAuditRow[];
  };
  ruixin?: {
    deleteRows: DeleteAuditRow[];
    keepRows: DeleteAuditRow[];
  };
  ounuo?: OunuoAudit;
  fixSummary?: {
    neonUpdated: number;
    ruixinProductsDeleted: number;
    ruixinOffersDeleted: number;
    ounuoCurrencyUpdated: number;
    ounuoOffersDeleted: number;
    priceHistoryCreated: number;
  };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await assertSourceRootMounted();

  const result: AuditResult = {
    mode: args.mode,
    partFilter: args.part ?? "all",
  };

  if (args.mode === "fix") {
    result.backupPath = await backupDatabase();
  }

  if (shouldRunPart(args.part, "a")) {
    result.neon = await auditNeon();
  }
  if (shouldRunPart(args.part, "b")) {
    result.ruixin = await auditRuixin();
  }
  if (shouldRunPart(args.part, "c")) {
    result.ounuo = await auditOunuo();
  }

  if (args.mode === "fix") {
    result.fixSummary = await applyFixes(result);
    // Re-audit after writes so the result report reflects final DB state.
    if (shouldRunPart(args.part, "a")) result.neon = await auditNeon();
    if (shouldRunPart(args.part, "b")) result.ruixin = await auditRuixin();
    if (shouldRunPart(args.part, "c")) result.ounuo = await auditOunuo();
  }

  const reportPath = args.mode === "audit" ? AUDIT_REPORT_PATH : FIX_REPORT_PATH;
  await writeFile(reportPath, buildReport(result), "utf8");

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        part: args.part ?? "all",
        reportPath,
        backupPath: result.backupPath,
        fixSummary: result.fixSummary,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): { mode: Mode; part?: Part } {
  const hasAudit = args.includes("--audit");
  const hasFix = args.includes("--fix");
  if (hasAudit === hasFix) {
    throw new Error("Use exactly one of --audit or --fix.");
  }

  const partArg = args.find((arg) => arg.startsWith("--part="));
  const part = partArg?.slice("--part=".length).toLowerCase();
  if (part && part !== "a" && part !== "b" && part !== "c") {
    throw new Error("--part must be a, b, or c.");
  }

  return { mode: hasFix ? "fix" : "audit", part: part as Part | undefined };
}

function shouldRunPart(partFilter: Part | undefined, part: Part): boolean {
  return !partFilter || partFilter === part;
}

async function assertSourceRootMounted() {
  const fs = await import("node:fs/promises");
  await fs.access(SOURCE_ROOT);
}

async function backupDatabase(): Promise<string> {
  await mkdir("backups", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupPath = `backups/dev-before-v2.19f-${timestamp}.sqlite`;
  await copyFile(DB_PATH, backupPath);
  return backupPath;
}

async function auditNeon(): Promise<AuditResult["neon"]> {
  const sourcePath = resolveSource(NEON_RELATIVE_PATH);
  const workbook = readWorkbook(sourcePath);
  const candidates = findNeonCandidates(workbook);
  const headerLines = extractHeaderLines(workbook, "高压无导线SMD", 0, 2);

  const rows: NeonAuditRow[] = [];
  for (const target of NEON_TARGETS) {
    const offer = await prisma.supplierOffer.findFirst({
      where: {
        factoryName: "尼奥",
        purchasePrice: target.badPrice,
        product: {
          category: "灯带",
          modelNo: target.modelNo,
        },
      },
      select: {
        id: true,
        productId: true,
        purchasePrice: true,
        sourceFileId: true,
        product: {
          select: {
            remark: true,
          },
        },
      },
    });

    if (!offer) {
      rows.push({
        productId: null,
        offerId: null,
        modelNo: target.modelNo,
        currentPrice: null,
        sourcePrice: null,
        sourceSheet: null,
        sourceRow: null,
        action: "skip",
        reason: "当前库中没有找到对应错误报价，可能已修复。",
      });
      continue;
    }

    const sourceCandidate = chooseNeonPriceCandidate(
      target.modelNo,
      target.anchorPrice,
      offer.product.remark ?? "",
      candidates,
    );
    const sourcePrice = sourceCandidate?.taxPrice ?? null;

    if (!sourceCandidate || sourcePrice == null) {
      rows.push({
        productId: offer.productId,
        offerId: offer.id,
        modelNo: target.modelNo,
        currentPrice: decimalToNumber(offer.purchasePrice),
        sourcePrice: null,
        sourceSheet: sourceCandidate?.sheetName ?? null,
        sourceRow: sourceCandidate?.rowNumber ?? null,
        action: "skip",
        reason: "源 Excel 对应行没有独立价格单元格；按安全边界跳过，不用备注或灯珠数推测价格。",
      });
      continue;
    }

    if (sourcePrice < 0.5 || sourcePrice > 50) {
      rows.push({
        productId: offer.productId,
        offerId: offer.id,
        modelNo: target.modelNo,
        currentPrice: decimalToNumber(offer.purchasePrice),
        sourcePrice,
        sourceSheet: sourceCandidate.sheetName,
        sourceRow: sourceCandidate.rowNumber,
        action: "skip",
        reason: "源价格不在灯带合理范围 0.5-50，跳过。",
      });
      continue;
    }

    if (target.anchorPrice != null && !nearlyEqual(sourcePrice, target.anchorPrice)) {
      rows.push({
        productId: offer.productId,
        offerId: offer.id,
        modelNo: target.modelNo,
        currentPrice: decimalToNumber(offer.purchasePrice),
        sourcePrice,
        sourceSheet: sourceCandidate.sheetName,
        sourceRow: sourceCandidate.rowNumber,
        action: "skip",
        reason: `源价格 ${sourcePrice} 与 remark 线索 ${target.anchorPrice} 不一致，跳过。`,
      });
      continue;
    }

    rows.push({
      productId: offer.productId,
      offerId: offer.id,
      modelNo: target.modelNo,
      currentPrice: decimalToNumber(offer.purchasePrice),
      sourcePrice,
      sourceSheet: sourceCandidate.sheetName,
      sourceRow: sourceCandidate.rowNumber,
      action: "update",
      reason: "匹配源 Excel 含税价格列，且通过合理价格范围校验。",
    });
  }

  return {
    sourcePath,
    headerLines,
    candidates,
    rows,
  };
}

function findNeonCandidates(workbook: Map<string, Rows>): NeonCandidateRow[] {
  const candidates: NeonCandidateRow[] = [];
  for (const [sheetName, rows] of workbook.entries()) {
    rows.forEach((row, rowIndex) => {
      const modelNo = row[0]?.trim();
      if (!modelNo || !NEON_TARGETS.some((target) => target.modelNo === modelNo)) return;

      candidates.push({
        sheetName,
        rowNumber: rowIndex + 1,
        modelNo,
        noTaxPrice: parsePrice(row[18]),
        taxPrice: parsePrice(row[19]),
        rowPreview: compactRow(row),
      });
    });
  }
  return candidates;
}

function chooseNeonPriceCandidate(
  modelNo: string,
  anchorPrice: number | undefined,
  productRemark: string,
  candidates: NeonCandidateRow[],
): NeonCandidateRow | undefined {
  const matches = candidates.filter((candidate) => candidate.modelNo === modelNo);
  if (matches.length === 0) return undefined;

  if (anchorPrice != null || productRemark.includes("￥")) {
    const expected = anchorPrice ?? extractFirstMoney(productRemark);
    const byAnchor = matches.find((candidate) => candidate.taxPrice != null && expected != null && nearlyEqual(candidate.taxPrice, expected));
    if (byAnchor) return byAnchor;
  }

  return matches.find((candidate) => candidate.taxPrice != null) ?? matches[0];
}

async function auditRuixin(): Promise<AuditResult["ruixin"]> {
  const [deleteRows, keepRows] = await Promise.all([
    Promise.all(RUIXIN_DELETE_MODELS.map((modelNo) => loadRuixinRow(modelNo, true))),
    Promise.all(RUIXIN_KEEP_MODELS.map((modelNo) => loadRuixinRow(modelNo, false))),
  ]);

  return { deleteRows: deleteRows.filter(isDefined), keepRows: keepRows.filter(isDefined) };
}

async function loadRuixinRow(modelNo: string, deleteTarget: boolean): Promise<DeleteAuditRow | null> {
  const product = await prisma.product.findFirst({
    where: {
      category: "面板灯",
      modelNo,
      supplierOffers: {
        some: { factoryName: "瑞鑫" },
      },
    },
    include: {
      supplierOffers: {
        where: { factoryName: "瑞鑫" },
        select: {
          id: true,
          purchasePrice: true,
        },
      },
      _count: {
        select: {
          supplierOffers: true,
          params: true,
          quoteItems: true,
        },
      },
    },
  });

  if (!product) return null;
  const offerIds = product.supplierOffers.map((offer) => offer.id);
  const quoteRefs = await countQuoteRefs(product.id, offerIds);
  const price = product.supplierOffers[0] ? decimalToNumber(product.supplierOffers[0].purchasePrice) : null;

  const canDelete =
    deleteTarget &&
    product.supplierOffers.length === 1 &&
    product._count.supplierOffers === 1 &&
    quoteRefs === 0 &&
    !product.imagePath;

  return {
    productId: product.id,
    offerIds,
    modelNo: product.modelNo ?? product.productName,
    price,
    imagePath: product.imagePath,
    quoteRefs,
    paramCount: product._count.params,
    offerCount: product._count.supplierOffers,
    action: canDelete ? "delete-product" : "skip",
    reason: canDelete
      ? "确认规格/材质行，且无图片、无 quote_items、仅 1 条 offer。"
      : deleteTarget
        ? "安全条件不满足，跳过。"
        : "任务明确要求仅审计保留。",
  };
}

async function auditOunuo(): Promise<OunuoAudit> {
  const usdWorkbook = readWorkbook(resolveSource(OUNUO_USD_RELATIVE_PATH));
  const rmbWorkbook = readWorkbook(resolveSource(OUNUO_RMB_RELATIVE_PATH));
  const groundWorkbook = readWorkbook(resolveSource(OUNUO_GROUND_RELATIVE_PATH));
  const usdHeaderLines = extractHeaderLines(usdWorkbook, "LED PANEL", 4, 6);
  const rmbHeaderLines = extractHeaderLines(rmbWorkbook, "塑料面板灯", 3, 5);
  const groundHeaderLines = extractHeaderLines(groundWorkbook, "Sheet1", 2, 3);

  const usdOffers = await prisma.supplierOffer.findMany({
    where: {
      factoryName: "欧诺 塑料 小面板灯",
      sourceFile: { relativePath: OUNUO_USD_RELATIVE_PATH },
    },
    select: {
      id: true,
      productId: true,
      purchasePrice: true,
      currency: true,
      product: {
        select: { modelNo: true },
      },
    },
    orderBy: [{ purchasePrice: "asc" }, { id: "asc" }],
  });

  const usdRows = [];
  for (const offer of usdOffers) {
    usdRows.push({
      productId: offer.productId,
      offerId: offer.id,
      modelNo: offer.product.modelNo,
      price: decimalToNumber(offer.purchasePrice),
      currency: offer.currency,
      quoteRefs: await countQuoteRefs(offer.productId, [offer.id]),
    });
  }

  const shapeOffers = await prisma.supplierOffer.findMany({
    where: {
      factoryName: "欧诺 塑料 小面板灯",
      sourceFile: { relativePath: OUNUO_RMB_RELATIVE_PATH },
      product: { modelNo: { in: ["圆形", "方形"] } },
    },
    select: {
      id: true,
      productId: true,
      purchasePrice: true,
      product: { select: { modelNo: true } },
    },
    orderBy: { purchasePrice: "asc" },
  });

  const wattageOffers = await loadOunuoWattageOffers(groundWorkbook);
  const currencyIsUsd = usdHeaderLines.some((line) => /FOB PRICE \(USD\)|\$/.test(line));

  return {
    usdOffers: usdRows,
    usdHeaderLines,
    rmbHeaderLines,
    groundHeaderLines,
    shapeOffers: await Promise.all(
      shapeOffers.map(async (offer) => ({
        productId: offer.productId,
        offerId: offer.id,
        modelNo: offer.product.modelNo,
        price: decimalToNumber(offer.purchasePrice),
        quoteRefs: await countQuoteRefs(offer.productId, [offer.id]),
      })),
    ),
    wattageOffers,
    currencyAction: currencyIsUsd && usdRows.some((row) => row.currency !== "USD") ? "update-usd" : "skip",
    currencyReason: currencyIsUsd
      ? "源表价格列明确标注 FOB PRICE (USD)，且库中这些报价当前标为 RMB。"
      : "源表未能明确识别 USD 价格列，跳过币种更新。",
  };
}

async function loadOunuoWattageOffers(workbook: Map<string, Rows>): Promise<OunuoAudit["wattageOffers"]> {
  const sourcePrices = extractOunuoGroundSourcePrices(workbook);
  const offers = await prisma.supplierOffer.findMany({
    where: {
      factoryName: "欧诺",
      product: {
        category: "面板灯",
        modelNo: { in: OUNUO_WATTAGE_MODELS },
      },
      sourceFile: { relativePath: OUNUO_GROUND_RELATIVE_PATH },
    },
    select: {
      id: true,
      productId: true,
      purchasePrice: true,
      product: {
        select: {
          id: true,
          modelNo: true,
          _count: { select: { supplierOffers: true } },
        },
      },
    },
    orderBy: { purchasePrice: "asc" },
  });

  const out: OunuoAudit["wattageOffers"] = [];
  for (const offer of offers) {
    const price = decimalToNumber(offer.purchasePrice);
    const sourcePrice = offer.product.modelNo ? (sourcePrices.get(offer.product.modelNo) ?? null) : null;
    const isWattageAsPrice = offer.product.modelNo != null && nearlyEqual(price, Number.parseFloat(offer.product.modelNo));
    const quoteRefs = await countQuoteRefs(offer.productId, [offer.id]);
    out.push({
      productId: offer.productId,
      offerId: offer.id,
      modelNo: offer.product.modelNo,
      price,
      quoteRefs,
      productOfferCount: offer.product._count.supplierOffers,
      sourcePrice,
      action: isWattageAsPrice && quoteRefs === 0 ? "delete-offer" : "skip",
      reason: isWattageAsPrice
        ? offer.product._count.supplierOffers > 1
          ? "当前报价把功率列当价格；产品被多家报价复用，因此只删除这条欧诺错误 offer，保留产品。"
          : "当前报价把功率列当价格，且无 quote_items 引用。"
        : "未命中 wattage-as-price 规则。",
    });
  }
  return out;
}

function extractOunuoGroundSourcePrices(workbook: Map<string, Rows>): Map<string, number> {
  const prices = new Map<string, number>();
  const rows = workbook.get("Sheet1") ?? [];
  for (const row of rows) {
    const watt = normalizeText(row[2]);
    if (!OUNUO_WATTAGE_MODELS.includes(watt)) continue;
    prices.set(watt, parsePrice(row[11]) ?? parsePrice(row[10]) ?? 0);
  }
  return prices;
}

async function applyFixes(result: AuditResult): Promise<NonNullable<AuditResult["fixSummary"]>> {
  let neonUpdated = 0;
  let ruixinProductsDeleted = 0;
  let ruixinOffersDeleted = 0;
  let ounuoCurrencyUpdated = 0;
  let ounuoOffersDeleted = 0;
  let priceHistoryCreated = 0;

  if (result.neon) {
    for (const row of result.neon.rows) {
      if (row.action !== "update" || !row.offerId || row.sourcePrice == null || row.currentPrice == null) continue;
      await prisma.$transaction(async (tx) => {
        const newPrice = row.sourcePrice;
        const offerId = row.offerId;
        if (newPrice == null || !offerId) return;
        const offer = await tx.supplierOffer.findUnique({
          where: { id: offerId },
          select: {
            id: true,
            purchasePrice: true,
            sourceFileId: true,
          },
        });
        if (!offer) return;
        const oldPrice = decimalToNumber(offer.purchasePrice);
        await tx.supplierOffer.update({
          where: { id: offerId },
          data: {
            purchasePrice: newPrice,
            priceUpdatedAt: new Date(),
          },
          select: { id: true },
        });
        await tx.priceHistory.create({
          data: {
            id: randomUUID(),
            supplierOfferId: offerId,
            oldPrice,
            newPrice,
            ...(offer.sourceFileId ? { oldSourceFileId: offer.sourceFileId, newSourceFileId: offer.sourceFileId } : {}),
          },
        });
      });
      neonUpdated += 1;
      priceHistoryCreated += 1;
    }
  }

  if (result.ruixin) {
    for (const row of result.ruixin.deleteRows) {
      if (row.action !== "delete-product") continue;
      await prisma.$transaction(async (tx) => {
        await tx.priceHistory.deleteMany({ where: { supplierOfferId: { in: row.offerIds } } });
        await tx.productParam.deleteMany({ where: { productId: row.productId } });
        const offerDelete = await tx.supplierOffer.deleteMany({ where: { id: { in: row.offerIds } } });
        await tx.product.delete({ where: { id: row.productId } });
        ruixinOffersDeleted += offerDelete.count;
      });
      ruixinProductsDeleted += 1;
    }
  }

  if (result.ounuo) {
    if (result.ounuo.currencyAction === "update-usd") {
      const update = await prisma.supplierOffer.updateMany({
        where: {
          id: { in: result.ounuo.usdOffers.filter((offer) => offer.currency !== "USD").map((offer) => offer.offerId) },
        },
        data: { currency: "USD" },
      });
      ounuoCurrencyUpdated = update.count;
    }

    const deleteOfferIds = result.ounuo.wattageOffers
      .filter((offer) => offer.action === "delete-offer" && offer.quoteRefs === 0)
      .map((offer) => offer.offerId);
    if (deleteOfferIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.priceHistory.deleteMany({ where: { supplierOfferId: { in: deleteOfferIds } } });
        const deleted = await tx.supplierOffer.deleteMany({ where: { id: { in: deleteOfferIds } } });
        ounuoOffersDeleted = deleted.count;
      });
    }
  }

  return {
    neonUpdated,
    ruixinProductsDeleted,
    ruixinOffersDeleted,
    ounuoCurrencyUpdated,
    ounuoOffersDeleted,
    priceHistoryCreated,
  };
}

function readWorkbook(filePath: string): Map<string, Rows> {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheets = new Map<string, Rows>();
  for (const sheetName of workbook.SheetNames) {
    const rawRows = XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
    sheets.set(
      sheetName,
      rawRows.map((row) => row.map((value) => normalizeCell(value))),
    );
  }
  return sheets;
}

function extractHeaderLines(workbook: Map<string, Rows>, sheetName: string, startIndex: number, endIndexInclusive: number): string[] {
  const rows = workbook.get(sheetName) ?? [];
  return rows.slice(startIndex, endIndexInclusive + 1).map((row, offset) => `Row ${startIndex + offset + 1}: ${compactRow(row)}`);
}

function resolveSource(relativePath: string): string {
  return path.join(SOURCE_ROOT, relativePath);
}

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.replace(/,/g, "").trim();
  const currencyMatch = text.match(/[¥￥$]\s*(-?\d+(?:\.\d+)?)/);
  const match = currencyMatch ?? text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const raw = currencyMatch ? match[1] : match[0];
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractFirstMoney(text: string): number | null {
  return parsePrice(text.match(/[¥￥]\s*\d+(?:\.\d+)?/)?.[0] ?? "");
}

function normalizeCell(value: CellValue): string {
  if (value == null) return "";
  return String(value).normalize("NFC").trim();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").trim();
}

function compactRow(row: string[]): string {
  return row
    .map((value, index) => (value ? `${columnName(index)}=${value.replace(/\s+/g, " ")}` : ""))
    .filter(Boolean)
    .join(" | ");
}

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out;
}

async function countQuoteRefs(productId: string, offerIds: string[]): Promise<number> {
  return prisma.quoteItem.count({
    where: {
      OR: [{ productId }, { supplierOfferId: { in: offerIds } }],
    },
  });
}

function decimalToNumber(value: { toString(): string } | number | string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number.parseFloat(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function buildReport(result: AuditResult): string {
  const lines: string[] = [];
  const title = result.mode === "audit" ? "V2.19F Audit — 尼奥/瑞鑫/欧诺 数据修补" : "V2.19F Fix Result — 尼奥/瑞鑫/欧诺 数据修补";
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- Mode: ${result.mode}`);
  lines.push(`- Part filter: ${result.partFilter}`);
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  if (result.backupPath) lines.push(`- DB backup: ${result.backupPath}`);
  lines.push("");

  if (result.fixSummary) {
    lines.push("## Fix Summary");
    lines.push("");
    lines.push(`- 尼奥价格更新: ${result.fixSummary.neonUpdated}`);
    lines.push(`- 尼奥 price_history 新增: ${result.fixSummary.priceHistoryCreated}`);
    lines.push(`- 瑞鑫删除产品: ${result.fixSummary.ruixinProductsDeleted}`);
    lines.push(`- 瑞鑫删除 offers: ${result.fixSummary.ruixinOffersDeleted}`);
    lines.push(`- 欧诺币种改 USD: ${result.fixSummary.ounuoCurrencyUpdated}`);
    lines.push(`- 欧诺删除错误 offers: ${result.fixSummary.ounuoOffersDeleted}`);
    lines.push("");
  }

  if (result.neon) buildNeonReport(lines, result.neon);
  if (result.ruixin) buildRuixinReport(lines, result.ruixin);
  if (result.ounuo) buildOunuoReport(lines, result.ounuo);

  lines.push("## Notes");
  lines.push("");
  lines.push("- 源 Excel 文件只读，脚本只写 SQLite 和 docs 报告。");
  lines.push("- 尼奥 COB 两条源行没有独立价格列，未用灯珠数或备注推测价格。");
  lines.push("- 欧诺 3W/5W 产品被其他供应商报价复用，修复只删除欧诺错误 offer，不删除共享产品。");
  lines.push("");
  return lines.join("\n");
}

function buildNeonReport(lines: string[], neon: NonNullable<AuditResult["neon"]>) {
  lines.push("## Part A — 尼奥灯带价格修正");
  lines.push("");
  lines.push(`Source: ${neon.sourcePath}`);
  lines.push("");
  lines.push("### Source Header Snapshot");
  lines.push("");
  lines.push("```text");
  lines.push(...neon.headerLines);
  lines.push("```");
  lines.push("");
  lines.push("### Candidate Rows From Excel");
  lines.push("");
  lines.push("| model_no | sheet | row | no-tax | tax | row preview |");
  lines.push("|---|---|---:|---:|---:|---|");
  for (const row of neon.candidates) {
    lines.push(
      `| ${escapeMd(row.modelNo)} | ${escapeMd(row.sheetName)} | ${row.rowNumber} | ${formatPrice(row.noTaxPrice)} | ${formatPrice(row.taxPrice)} | ${escapeMd(row.rowPreview)} |`,
    );
  }
  lines.push("");
  lines.push("### Action Plan / Result");
  lines.push("");
  lines.push("| model_no | current | source | source row | action | reason |");
  lines.push("|---|---:|---:|---|---|---|");
  for (const row of neon.rows) {
    lines.push(
      `| ${escapeMd(row.modelNo)} | ${formatPrice(row.currentPrice)} | ${formatPrice(row.sourcePrice)} | ${escapeMd(
        row.sourceSheet && row.sourceRow ? `${row.sourceSheet} #${row.sourceRow}` : "-",
      )} | ${row.action} | ${escapeMd(row.reason)} |`,
    );
  }
  lines.push("");
}

function buildRuixinReport(lines: string[], ruixin: NonNullable<AuditResult["ruixin"]>) {
  lines.push("## Part B — 瑞鑫面板灯规格行清理");
  lines.push("");
  lines.push("### Delete Targets");
  lines.push("");
  lines.push("| model_no | price | offers | params | quote refs | image | action | reason |");
  lines.push("|---|---:|---:|---:|---:|---|---|---|");
  for (const row of ruixin.deleteRows) {
    lines.push(
      `| ${escapeMd(row.modelNo)} | ${formatPrice(row.price)} | ${row.offerCount} | ${row.paramCount} | ${row.quoteRefs} | ${row.imagePath ? "Y" : "N"} | ${row.action} | ${escapeMd(row.reason)} |`,
    );
  }
  lines.push("");
  lines.push("### Keep / Audit Only");
  lines.push("");
  lines.push("| model_no | price | offers | params | quote refs | image | action | reason |");
  lines.push("|---|---:|---:|---:|---:|---|---|---|");
  for (const row of ruixin.keepRows) {
    lines.push(
      `| ${escapeMd(row.modelNo)} | ${formatPrice(row.price)} | ${row.offerCount} | ${row.paramCount} | ${row.quoteRefs} | ${row.imagePath ? "Y" : "N"} | ${row.action} | ${escapeMd(row.reason)} |`,
    );
  }
  lines.push("");
}

function buildOunuoReport(lines: string[], ounuo: OunuoAudit) {
  lines.push("## Part C — 欧诺面板灯源文件审计 + 价格判定");
  lines.push("");
  lines.push("### 核价 Wellux 文件表头");
  lines.push("");
  lines.push("```text");
  lines.push(...ounuo.usdHeaderLines);
  lines.push("```");
  lines.push("");
  lines.push(`Decision: ${ounuo.currencyAction} — ${ounuo.currencyReason}`);
  lines.push("");
  lines.push("| offers | current RMB | current USD | quote refs | price range |");
  lines.push("|---:|---:|---:|---:|---|");
  const usdRmbCount = ounuo.usdOffers.filter((offer) => offer.currency === "RMB").length;
  const usdUsdCount = ounuo.usdOffers.filter((offer) => offer.currency === "USD").length;
  const quoteRefs = ounuo.usdOffers.reduce((sum, offer) => sum + offer.quoteRefs, 0);
  const prices = ounuo.usdOffers.map((offer) => offer.price);
  lines.push(
    `| ${ounuo.usdOffers.length} | ${usdRmbCount} | ${usdUsdCount} | ${quoteRefs} | ${formatPrice(Math.min(...prices))} - ${formatPrice(Math.max(...prices))} |`,
  );
  lines.push("");
  lines.push("### 塑料面板灯报价单表头");
  lines.push("");
  lines.push("```text");
  lines.push(...ounuo.rmbHeaderLines);
  lines.push("```");
  lines.push("");
  lines.push("圆形/方形为形状标签，价格列是 RMB 单价；本任务只记录，不自动处理。");
  lines.push("");
  lines.push("| model_no | price | quote refs | action |");
  lines.push("|---|---:|---:|---|");
  for (const offer of ounuo.shapeOffers) {
    lines.push(`| ${escapeMd(offer.modelNo ?? "-")} | ${formatPrice(offer.price)} | ${offer.quoteRefs} | audit-only |`);
  }
  lines.push("");
  lines.push("### 欧诺地插灯文件表头");
  lines.push("");
  lines.push("```text");
  lines.push(...ounuo.groundHeaderLines);
  lines.push("```");
  lines.push("");
  lines.push("3W/5W 当前在面板灯共享产品上，但来源是地插灯文件，且 DB 价格等于功率列。");
  lines.push("");
  lines.push("| model_no | current price | source price | product offers | quote refs | action | reason |");
  lines.push("|---|---:|---:|---:|---:|---|---|");
  for (const offer of ounuo.wattageOffers) {
    lines.push(
      `| ${escapeMd(offer.modelNo ?? "-")} | ${formatPrice(offer.price)} | ${formatPrice(offer.sourcePrice)} | ${offer.productOfferCount} | ${offer.quoteRefs} | ${offer.action} | ${escapeMd(offer.reason)} |`,
    );
  }
  lines.push("");
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
