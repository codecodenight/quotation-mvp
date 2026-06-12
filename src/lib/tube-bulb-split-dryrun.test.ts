import { describe, expect, test } from "vitest";

import { parseSplitImportPlan, selectPlannedSheets } from "../../scripts/tube-bulb-split-dryrun";

describe("tube/bulb split dry-run plan", () => {
  test("parses bulb, tube, and skip entries from the markdown plan", () => {
    const plan = parseSplitImportPlan(`
# V2.17B

## 直接导入为球泡

| 文件 | 工厂 | Sheets | 分类依据 |
|---|---|---|---|
| 光源/球泡灯管/a.xlsx | 合力 | A泡, T泡 | 文件名命中 |

## 直接导入为灯管

| 文件 | 工厂 | Sheets | 分类依据 |
|---|---|---|---|
| 光源/球泡灯管/b.xlsx | 鑫盟泰 | T8灯管 | 文件名命中 |

## Skip 文件

| 文件 | 工厂 | 理由 |
|---|---|---|
| 光源/球泡灯管/skip.xlsx | 佛山凯徽 | 人工确认不用管 |
`);

    expect(plan.entries).toEqual([
      {
        relativePath: "光源/球泡灯管/a.xlsx",
        factory: "合力",
        category: "球泡",
        sheetNames: ["A泡", "T泡"],
        reason: "文件名命中",
      },
      {
        relativePath: "光源/球泡灯管/b.xlsx",
        factory: "鑫盟泰",
        category: "灯管",
        sheetNames: ["T8灯管"],
        reason: "文件名命中",
      },
    ]);
    expect(plan.skipEntries).toEqual([
      { relativePath: "光源/球泡灯管/skip.xlsx", factory: "佛山凯徽", reason: "人工确认不用管" },
    ]);
  });

  test("uses a strict sheet whitelist for mixed files", () => {
    const selected = selectPlannedSheets({
      availableSheets: ["Packinglist", "2007年1月出货明细TO台湾力玛（总)", "目录"],
      plannedSheets: ["Packinglist"],
      strictWhitelist: true,
    });

    expect(selected.selectedSheets).toEqual(["Packinglist"]);
    expect(selected.missingSheets).toEqual([]);
  });
});
