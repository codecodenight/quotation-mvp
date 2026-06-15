import { NextResponse } from "next/server";

import { scanDirectory } from "@/lib/file-scanner";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ScanRequest = {
  folderPath?: string;
};

export async function POST(request: Request) {
  let body: ScanRequest;

  try {
    body = (await request.json()) as ScanRequest;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const folderPath = body.folderPath?.trim();
  if (!folderPath) {
    return NextResponse.json({ error: "请输入本地文件夹路径。" }, { status: 400 });
  }

  const scanResult = await scanDirectory(folderPath);

  let written = 0;
  for (const file of scanResult.files) {
    await prisma.file.upsert({
      where: {
        volumeName_relativePath: {
          volumeName: file.volumeName,
          relativePath: file.relativePath,
        },
      },
      create: file,
      update: {
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
        folderName: file.folderName,
        factoryGuess: file.factoryGuess,
        absolutePathSnapshot: file.absolutePathSnapshot,
        modifiedAt: file.modifiedAt,
        scannedAt: file.scannedAt,
      },
    });
    written += 1;
  }

  return NextResponse.json({
    rootPath: scanResult.rootPath,
    scanned: scanResult.files.length,
    written,
    errors: scanResult.errors,
  });
}
