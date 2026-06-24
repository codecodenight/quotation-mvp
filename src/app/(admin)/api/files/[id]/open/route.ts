import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

import { resolveStoredFilePath } from "@/lib/file-paths";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const openFile = promisify(execFile);

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const file = await prisma.file.findUnique({ where: { id } });

  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const resolvedPath = await resolveStoredFilePath(file);

  try {
    await stat(resolvedPath);
  } catch {
    return NextResponse.json({ error: "源文件当前不可读取" }, { status: 404 });
  }

  try {
    await openFile("open", [resolvedPath]);
  } catch {
    return NextResponse.json({ error: "无法打开文件" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fileName: file.fileName });
}
