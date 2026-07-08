"use client";

import { FormEvent, useState } from "react";
import { Loader2, Search } from "lucide-react";

type ScanResponse = {
  rootPath: string;
  scanned: number;
  written: number;
  errors: Array<{ path: string; reason: string; message: string }>;
  error?: string;
};

export function ScanPanel() {
  const [folderPath, setFolderPath] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsScanning(true);
    setResult(null);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath }),
      });
      const payload = (await response.json()) as ScanResponse;
      setResult(payload);
    } catch (error) {
      setResult({
        rootPath: folderPath,
        scanned: 0,
        written: 0,
        errors: [],
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <section className="rounded-md border border-line bg-paper p-5 shadow-panel">
      <form onSubmit={handleSubmit} className="flex gap-3">
        <label className="min-w-0 flex-1">
          <span className="mb-2 block text-sm font-medium text-stone-700">本地文件夹路径</span>
          <input
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder="/Volumes/硬盘名/供应商资料"
            className="h-11 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-leaf"
          />
        </label>
        <button
          type="submit"
          disabled={isScanning}
          className="mt-7 inline-flex h-11 items-center gap-2 rounded-md bg-primary hover:bg-primary-hover px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          扫描
        </button>
      </form>

      {result ? (
        <div className="mt-5 border-t border-line pt-5">
          {result.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {result.error}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="扫描到" value={result.scanned} />
              <Metric label="写入/更新" value={result.written} />
              <Metric label="跳过/错误" value={result.errors.length} />
            </div>
          )}

          {result.errors.length > 0 ? (
            <div className="mt-4 overflow-hidden rounded-md border border-line">
              <div className="bg-cream px-3 py-2 text-sm font-semibold">扫描日志</div>
              <div className="max-h-72 overflow-auto bg-white">
                {result.errors.map((error) => (
                  <div key={`${error.reason}:${error.path}`} className="border-t border-line px-3 py-2 text-xs">
                    <span className="font-semibold text-brass">{error.reason}</span>
                    <span className="mx-2 text-stone-400">/</span>
                    <span className="text-stone-700">{error.path}</span>
                    <div className="mt-1 text-stone-500">{error.message}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-ink">{value}</div>
    </div>
  );
}
