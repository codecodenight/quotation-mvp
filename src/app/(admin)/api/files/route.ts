import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim();
  const type = url.searchParams.get("type")?.trim();

  const where: Prisma.FileWhereInput = {};
  if (search) {
    where.fileName = { contains: search };
  }
  if (type && type !== "all") {
    where.fileType = type;
  }

  const files = await prisma.file.findMany({
    where,
    orderBy: [{ scannedAt: "desc" }, { fileName: "asc" }],
    take: 500,
  });

  return NextResponse.json({
    files: files.map((file) => ({
      ...file,
      fileSize: file.fileSize.toString(),
      modifiedAt: file.modifiedAt.toISOString(),
      scannedAt: file.scannedAt.toISOString(),
    })),
  });
}
