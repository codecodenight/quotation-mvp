export type ImageBackfillCandidate = {
  productId: string;
  modelNo: string | null;
  imagePath: string | null;
};

export type ImageBackfillMatch = {
  productId: string;
  modelNo: string;
  matchedRowIndex: number;
  matchedCell: string;
  hasExistingImage: boolean;
};

export type ImageBackfillMode = "dry-run" | "apply";

export type ImageBackfillReportCopy = {
  title: string;
  writeSummary: string;
  decision: string;
};

type FindProductsNearImageInput = {
  anchorRow: number;
  rows: string[][];
  candidates: ImageBackfillCandidate[];
  rowRadius?: number;
};

type CandidateGroup = {
  modelKey: string;
  modelNo: string;
  products: ImageBackfillCandidate[];
};

type CandidateHit = {
  group: CandidateGroup;
  rowIndex: number;
  cell: string;
  distance: number;
};

const DEFAULT_ROW_RADIUS = 1;

export function buildImageBackfillReportCopy(mode: ImageBackfillMode): ImageBackfillReportCopy {
  if (mode === "apply") {
    return {
      title: "Image Backfill Result",
      writeSummary: "Apply writes: thumbnail files are stored under data/images/ and products.image_path is updated.",
      decision: "Apply completed. Review verification below.",
    };
  }

  return {
    title: "Image Backfill Dry Run",
    writeSummary: "Dry-run writes: none. No DB updates and no image files written.",
    decision: "STOP. Review this dry-run before running apply.",
  };
}

export function findProductsNearImage({
  anchorRow,
  rows,
  candidates,
  rowRadius = DEFAULT_ROW_RADIUS,
}: FindProductsNearImageInput): ImageBackfillMatch[] {
  const groups = buildCandidateGroups(candidates);
  if (groups.length === 0 || rows.length === 0) {
    return [];
  }

  const hits: CandidateHit[] = [];
  const firstRow = Math.max(0, anchorRow - rowRadius);
  const lastRow = Math.min(rows.length - 1, anchorRow + rowRadius);

  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    for (const rawCell of rows[rowIndex] ?? []) {
      const cell = cleanCell(rawCell);
      if (!cell) {
        continue;
      }
      const cellKey = normalizeMatchKey(cell);
      if (!cellKey) {
        continue;
      }

      for (const group of groups) {
        if (cellMatchesModel(cellKey, group.modelKey)) {
          hits.push({
            group,
            rowIndex,
            cell,
            distance: Math.abs(rowIndex - anchorRow),
          });
        }
      }
    }
  }

  const bestHit = chooseBestHit(hits);
  if (!bestHit) {
    return [];
  }

  return bestHit.group.products.map((product) => ({
    productId: product.productId,
    modelNo: bestHit.group.modelNo,
    matchedRowIndex: bestHit.rowIndex,
    matchedCell: bestHit.cell,
    hasExistingImage: Boolean(product.imagePath),
  }));
}

export function normalizeMatchKey(value: string): string {
  return cleanCell(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[‐‑‒–—―\-_/\\()[\]{}（）【】,，.。:：;；]+/g, "");
}

function buildCandidateGroups(candidates: ImageBackfillCandidate[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const candidate of candidates) {
    const modelNo = cleanCell(candidate.modelNo);
    const modelKey = normalizeMatchKey(modelNo);
    if (!isUsableModelKey(modelKey)) {
      continue;
    }
    const existing = groups.get(modelKey);
    if (existing) {
      existing.products.push(candidate);
    } else {
      groups.set(modelKey, { modelKey, modelNo, products: [candidate] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.modelKey.length - a.modelKey.length);
}

function cellMatchesModel(cellKey: string, modelKey: string): boolean {
  if (modelKey.length <= 3) {
    return cellKey === modelKey;
  }
  return cellKey.includes(modelKey);
}

function chooseBestHit(hits: CandidateHit[]): CandidateHit | null {
  if (hits.length === 0) {
    return null;
  }
  return hits.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    if (a.group.modelKey.length !== b.group.modelKey.length) {
      return b.group.modelKey.length - a.group.modelKey.length;
    }
    return a.rowIndex - b.rowIndex;
  })[0];
}

function isUsableModelKey(modelKey: string): boolean {
  return modelKey.length >= 2 && !/^\d+$/.test(modelKey);
}

function cleanCell(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
