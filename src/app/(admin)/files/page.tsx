import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { Prisma } from "@prisma/client";

import { formatBytes, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

type FilesPageProps = {
  searchParams: Promise<{
    search?: string;
    type?: string;
  }>;
};

const typeOptions = [
  { value: "all", label: "全部" },
  { value: "excel", label: "Excel" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "图片" },
  { value: "zip", label: "压缩包" },
];

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const params = await searchParams;
  const search = params.search?.trim() ?? "";
  const type = params.type?.trim() ?? "all";

  const where: Prisma.FileWhereInput = {};
  if (search) {
    where.fileName = { contains: search };
  }
  if (type !== "all") {
    where.fileType = type;
  }

  const files = await prisma.file.findMany({
    where,
    orderBy: [{ scannedAt: "desc" }, { fileName: "asc" }],
    take: 500,
  });

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Phase 2</div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">文件列表</h1>
        </div>
        <div className="rounded-md border border-line bg-paper px-4 py-2 text-sm shadow-panel">
          {files.length} 条
        </div>
      </header>

      <form className="mb-4 flex flex-wrap gap-3 rounded-md border border-line bg-paper p-4 shadow-panel">
        <input
          name="search"
          defaultValue={search}
          placeholder="搜索文件名"
          className="h-10 min-w-72 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf"
        />
        <select
          name="type"
          defaultValue={type}
          className="h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf"
        >
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="h-10 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white">筛选</button>
      </form>

      <div className="overflow-hidden rounded-md border border-line bg-paper shadow-panel">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.08em] text-stone-600">
            <tr>
              <th className="px-3 py-3">文件名</th>
              <th className="px-3 py-3">类型</th>
              <th className="px-3 py-3">大小</th>
              <th className="px-3 py-3">文件夹</th>
              <th className="px-3 py-3">相对路径</th>
              <th className="px-3 py-3">修改时间</th>
              <th className="px-3 py-3">打开</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {files.map((file) => (
              <tr key={file.id} className="align-top hover:bg-[#fbfaf7]">
                <td className="max-w-72 px-3 py-3 font-medium text-ink">{file.fileName}</td>
                <td className="px-3 py-3">
                  <span className="rounded-sm border border-line bg-paper px-2 py-1 text-xs">
                    {file.fileType}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-stone-700">{formatBytes(file.fileSize)}</td>
                <td className="px-3 py-3 text-stone-700">{file.folderName ?? "-"}</td>
                <td className="max-w-xl px-3 py-3 font-mono text-xs text-stone-600">
                  <div>{file.relativePath}</div>
                  <div className="mt-1 text-stone-400">{file.absolutePathSnapshot}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-stone-700">
                  {formatDateTime(file.modifiedAt)}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/api/files/${file.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:bg-paper"
                    target="_blank"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    查看
                  </Link>
                </td>
              </tr>
            ))}
            {files.length === 0 ? (
              <tr>
                <td className="px-3 py-10 text-center text-stone-500" colSpan={7}>
                  暂无文件记录
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
