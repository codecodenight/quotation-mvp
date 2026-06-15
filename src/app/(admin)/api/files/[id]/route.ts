import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { resolveStoredFilePath } from "@/lib/file-paths";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const CONTENT_TYPES: Record<string, string> = {
  excel: "application/octet-stream",
  pdf: "application/pdf",
  image: "image/*",
  zip: "application/octet-stream",
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const file = await prisma.file.findUnique({ where: { id } });

  if (!file) {
    return NextResponse.json({ error: "文件记录不存在。" }, { status: 404 });
  }

  const resolvedPath = await resolveStoredFilePath(file);

  try {
    await stat(resolvedPath);
  } catch {
    return NextResponse.json({ error: "源文件当前不可读取。" }, { status: 404 });
  }

  const stream = createReadStream(resolvedPath);
  const body = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[file.fileType] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    },
  });
}
