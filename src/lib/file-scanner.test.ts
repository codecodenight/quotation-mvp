import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { scanDirectory } from "./file-scanner";

describe("scanDirectory", () => {
  test("recursively indexes supported files and skips hidden, unsupported, and oversized files", async () => {
    const root = await mkdtemp(join(tmpdir(), "quotation-scan-"));
    await mkdir(join(root, "工厂A", "nested"), { recursive: true });
    await writeFile(join(root, "工厂A", "报价.xlsx"), "excel");
    await writeFile(join(root, "工厂A", "nested", "产品图.JPG"), "image");
    await writeFile(join(root, "catalog.pdf"), "pdf");
    await writeFile(join(root, "archive.zip"), "zip");
    await writeFile(join(root, ".hidden.xlsx"), "hidden");
    await writeFile(join(root, "notes.txt"), "text");
    await writeFile(join(root, "large.pdf"), Buffer.alloc(12));

    const result = await scanDirectory(root, {
      maxFileSizeBytes: 10,
      now: new Date("2026-06-04T12:00:00.000Z"),
    });

    expect(result.files.map((file) => file.relativePath).sort()).toEqual([
      "archive.zip",
      "catalog.pdf",
      "工厂A/nested/产品图.JPG",
      "工厂A/报价.xlsx",
    ]);
    expect(result.files.map((file) => file.fileType).sort()).toEqual([
      "excel",
      "image",
      "pdf",
      "zip",
    ]);
    expect(result.files.every((file) => file.volumeName.length > 0)).toBe(true);
    expect(result.files.every((file) => file.absolutePathSnapshot.startsWith(root))).toBe(true);
    expect(result.files.every((file) => file.fileSize > 0n)).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "unsupported_type", path: join(root, "notes.txt") }),
        expect.objectContaining({ reason: "too_large", path: join(root, "large.pdf") }),
      ]),
    );
  });
});
