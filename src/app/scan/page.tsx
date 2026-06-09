import { ScanPanel } from "./scan-panel";

export default function ScanPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">Phase 2</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">文件扫描</h1>
      </header>
      <ScanPanel />
    </div>
  );
}
