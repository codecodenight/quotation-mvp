import { describe, expect, test } from "vitest";

import { buildImageBackfillReportCopy, findProductsNearImage } from "./image-backfill";

describe("image backfill matching", () => {
  test("matches products by model number on adjacent rows and shares same-model images", () => {
    const matches = findProductsNearImage({
      anchorRow: 1,
      rows: [
        ["header"],
        ["photo"],
        ["Model", "ABC-100", "12W"],
      ],
      candidates: [
        { productId: "product-1", modelNo: "ABC-100", imagePath: null },
        { productId: "product-2", modelNo: "ABC-100", imagePath: null },
        { productId: "product-3", modelNo: "ABC-200", imagePath: null },
      ],
    });

    expect(matches).toEqual([
      {
        productId: "product-1",
        modelNo: "ABC-100",
        matchedRowIndex: 2,
        matchedCell: "ABC-100",
        hasExistingImage: false,
      },
      {
        productId: "product-2",
        modelNo: "ABC-100",
        matchedRowIndex: 2,
        matchedCell: "ABC-100",
        hasExistingImage: false,
      },
    ]);
  });

  test("requires exact cell match for short model numbers", () => {
    expect(
      findProductsNearImage({
        anchorRow: 0,
        rows: [["C35T Golden soft LED filament"], ["C35"]],
        candidates: [{ productId: "product-1", modelNo: "C35", imagePath: null }],
      }),
    ).toEqual([
      {
        productId: "product-1",
        modelNo: "C35",
        matchedRowIndex: 1,
        matchedCell: "C35",
        hasExistingImage: false,
      },
    ]);
  });

  test("uses apply-specific report copy when writing back images", () => {
    expect(buildImageBackfillReportCopy("apply")).toEqual({
      title: "Image Backfill Result",
      writeSummary: "Apply writes: thumbnail files are stored under data/images/ and products.image_path is updated.",
      decision: "Apply completed. Review verification below.",
    });
  });
});
