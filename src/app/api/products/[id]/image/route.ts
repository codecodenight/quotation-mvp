import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const product = await prisma.product.findUnique({
    where: { id },
    select: { imagePath: true },
  });

  if (!product?.imagePath) {
    return NextResponse.json({ error: "产品图片不存在。" }, { status: 404 });
  }

  const imageRoot = resolve(process.cwd(), "data", "images");
  const imagePath = resolve(product.imagePath);
  if (!imagePath.startsWith(`${imageRoot}${sep}`)) {
    return NextResponse.json({ error: "产品图片路径不允许访问。" }, { status: 403 });
  }

  try {
    const file = await stat(imagePath);
    if (!file.isFile()) {
      return NextResponse.json({ error: "产品图片不可读取。" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "产品图片已移动或删除。" }, { status: 404 });
  }

  const stream = createReadStream(imagePath);
  const body = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentTypeForPath(imagePath),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function contentTypeForPath(filePath: string): string {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerPath.endsWith(".png")) {
    return "image/png";
  }
  if (lowerPath.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowerPath.endsWith(".gif")) {
    return "image/gif";
  }
  return "application/octet-stream";
}
