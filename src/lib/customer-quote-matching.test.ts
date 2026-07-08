import { describe, expect, it } from "vitest";

import {
  extractWatts,
  findCandidates,
  normalizeModel,
  scoreCandidate,
  type MatchableProduct,
} from "./customer-quote-matching";

function product(overrides: Partial<MatchableProduct> = {}): MatchableProduct {
  return {
    id: "p1",
    modelNo: "BL-6336/36W",
    productName: "36W 面板灯",
    category: "面板灯",
    ...overrides,
  };
}

describe("normalizeModel", () => {
  it("uppercases and strips separators", () => {
    expect(normalizeModel("bl-6336/36w")).toBe("BL633636W");
    expect(normalizeModel(" F1 - 40W ")).toBe("F140W");
  });

  it("keeps CJK characters", () => {
    expect(normalizeModel("8寸圆")).toBe("8寸圆");
  });

  it("returns empty string for null", () => {
    expect(normalizeModel(null)).toBe("");
  });
});

describe("extractWatts", () => {
  it("extracts wattage from model text", () => {
    expect(extractWatts("BL-6336/36W")).toBe("36");
    expect(extractWatts("100w floodlight")).toBe("100");
  });

  it("ignores letters that merely start with w", () => {
    expect(extractWatts("white 面板灯")).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("gives 100 for exact normalized match", () => {
    const candidate = scoreCandidate("BL6336-36W", null, product({ modelNo: "BL-6336/36W" }));
    expect(candidate?.score).toBe(100);
    expect(candidate?.reason).toBe("exact");
  });

  it("scores containment matches above prefix matches", () => {
    const contains = scoreCandidate("BL-6336", null, product({ modelNo: "BL-6336/36W" }));
    const prefix = scoreCandidate("BL-6399/20W", null, product({ modelNo: "BL-6336/36W" }));
    expect(contains?.reason).toBe("contains");
    expect(prefix?.reason).toBe("prefix");
    expect((contains?.score ?? 0) > (prefix?.score ?? 0)).toBe(true);
  });

  it("falls back to watts + category hint", () => {
    const candidate = scoreCandidate(
      "PANEL-A",
      "36W 面板灯 白光",
      product({ modelNo: "XYZ-36W", productName: "超薄面板灯", category: "面板灯" }),
    );
    expect(candidate?.reason).toBe("watts");
    expect(candidate?.score).toBe(40);
  });

  it("returns null when nothing aligns", () => {
    expect(scoreCandidate("ABCD", null, product({ modelNo: "WXYZ-99", productName: "灯" }))).toBeNull();
  });
});

describe("findCandidates", () => {
  it("returns top candidates sorted by score, capped at 3", () => {
    const products: MatchableProduct[] = [
      product({ id: "exact", modelNo: "BL-6336/36W" }),
      product({ id: "contains", modelNo: "BL-6336/36W-PLUS" }),
      product({ id: "prefix", modelNo: "BL-6399/20W" }),
      product({ id: "noise", modelNo: "ZZZ-1", productName: "射灯" }),
    ];
    const candidates = findCandidates("BL-6336/36W", null, products);
    expect(candidates.map((candidate) => candidate.product.id)).toEqual(["exact", "contains", "prefix"]);
  });

  it("returns empty for blank raw model", () => {
    expect(findCandidates("  ", null, [product()])).toEqual([]);
  });
});
