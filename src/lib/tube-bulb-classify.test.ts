import { describe, expect, test } from "vitest";

import {
  classifyFileName,
  classifySheetRows,
  summarizeFileCategory,
  type SheetClassification,
} from "../../scripts/classify-tube-bulb";

describe("tube/bulb classification", () => {
  test("classifies clear file names before reading sheet content", () => {
    expect(classifyFileName("A泡价格-2024.4.14.xlsx").category).toBe("球泡");
    expect(classifyFileName("NEW ERP T8 TUBE -2024.10.08.xlsx").category).toBe("灯管");
    expect(classifyFileName("嘉家旺整体报价23.04.18(1).xlsx").category).toBe("未知");
  });

  test("classifies sheet rows by bulb and tube keywords", () => {
    const bulb = classifySheetRows("报价", [
      ["型号", "品名"],
      ["A60-9W", "LED球泡 E27"],
      ["C37-5W", "蜡烛泡 E14"],
    ]);
    const tube = classifySheetRows("报价", [
      ["型号", "品名"],
      ["T8-18W", "LED灯管"],
      ["T5-12W", "一体化支架"],
    ]);

    expect(bulb.category).toBe("球泡");
    expect(tube.category).toBe("灯管");
  });

  test("does not treat LED board codes like A27 as bulb model names", () => {
    const sheet = classifySheetRows("报价", [
      ["型号", "规格"],
      ["24W", "96D A27-2B48C 150mA 1.5米"],
      ["18W", "76D A27-2B38C 145mA 1.2米"],
    ]);

    expect(sheet.category).toBe("未知");
    expect(sheet.bulbHits).toBe(0);
  });

  test("summarizes mixed files when sheet classifications differ", () => {
    const sheets: SheetClassification[] = [
      { sheetName: "A泡", category: "球泡", dataRows: 10, bulbHits: 5, tubeHits: 0, basis: "sheet 名命中球泡", samples: [] },
      { sheetName: "T8", category: "灯管", dataRows: 8, bulbHits: 0, tubeHits: 4, basis: "sheet 名命中灯管", samples: [] },
    ];

    expect(summarizeFileCategory({ category: "未知", basis: "文件名不明确" }, sheets).category).toBe("混合");
  });

  test("treats file-name and single sheet conflicts as manual review", () => {
    const sheets: SheetClassification[] = [
      { sheetName: "A泡", category: "球泡", dataRows: 10, bulbHits: 5, tubeHits: 0, basis: "sheet 名命中球泡", samples: [] },
    ];

    const summary = summarizeFileCategory({ category: "灯管", basis: "文件名命中灯管" }, sheets);

    expect(summary.category).toBe("未知");
    expect(summary.basis).toContain("需人工确认");
  });
});
