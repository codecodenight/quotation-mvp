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

  test("matches products within the default three-row anchor radius", () => {
    const matches = findProductsNearImage({
      anchorRow: 0,
      rows: [["photo"], [""], [""], ["Model", "ABC-300"]],
      candidates: [{ productId: "product-1", modelNo: "ABC-300", imagePath: null }],
    });

    expect(matches).toEqual([
      {
        productId: "product-1",
        modelNo: "ABC-300",
        matchedRowIndex: 3,
        matchedCell: "ABC-300",
        hasExistingImage: false,
      },
    ]);
  });

  test("keeps explicit rowRadius=1 behavior for callers that need a narrow match window", () => {
    const matches = findProductsNearImage({
      anchorRow: 0,
      rowRadius: 1,
      rows: [["photo"], [""], ["Model", "ABC-300"]],
      candidates: [{ productId: "product-1", modelNo: "ABC-300", imagePath: null }],
    });

    expect(matches).toEqual([]);
  });

  test("matches generated model numbers by their original model component", () => {
    const matches = findProductsNearImage({
      anchorRow: 0,
      rows: [["ZQ-XXQD-001", "23lm", "3CCT"]],
      candidates: [
        {
          productId: "product-1",
          modelNo: "下洗墙灯 - ZQ-XXQD-001 - 23lm - 3CCT",
          imagePath: null,
        },
      ],
    });

    expect(matches).toEqual([
      {
        productId: "product-1",
        modelNo: "下洗墙灯 - ZQ-XXQD-001 - 23lm - 3CCT",
        matchedRowIndex: 0,
        matchedCell: "ZQ-XXQD-001",
        hasExistingImage: false,
      },
    ]);
  });

  test("does not match generated model numbers by voltage, size, base, or material components", () => {
    expect(
      findProductsNearImage({
        anchorRow: 0,
        rows: [["220-240V"], ["1500*76*24mm"], ["E14 E27"], ["全塑PC+650度灼热丝"]],
        candidates: [
          {
            productId: "product-1",
            modelNo: "GX53 - 5±10% - Dia73*26 - 220-240V",
            imagePath: null,
          },
          {
            productId: "product-2",
            modelNo: "单压新EMC 新ERP - 全塑PC+650度灼热丝 - 18W - 600*76*24mm",
            imagePath: null,
          },
          {
            productId: "product-3",
            modelNo: "C35 - 2W - E14 E27 - E14 35*98 E27 35*92",
            imagePath: null,
          },
        ],
      }),
    ).toEqual([]);
  });

  test("ignores header-like model numbers", () => {
    expect(
      findProductsNearImage({
        anchorRow: 0,
        rows: [["Model No."]],
        candidates: [{ productId: "product-1", modelNo: "Model No.", imagePath: null }],
      }),
    ).toEqual([]);
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
