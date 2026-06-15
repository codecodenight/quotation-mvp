import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const quote = await prisma.quote.findUnique({ where: { id } });

  if (!quote?.quoteFilePath) {
    return NextResponse.json({ error: "报价文件不存在。" }, { status: 404 });
  }

  const outputRoot = resolve(process.cwd(), "outputs", "quotes");
  const filePath = resolve(quote.quoteFilePath);
  if (!filePath.startsWith(`${outputRoot}${sep}`)) {
    return NextResponse.json({ error: "报价文件路径不允许下载。" }, { status: 403 });
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) {
      return NextResponse.json({ error: "报价文件不可读取。" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "报价文件已移动或删除。" }, { status: 404 });
  }

  const stream = createReadStream(filePath);
  const body = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`,
    },
  });
}
