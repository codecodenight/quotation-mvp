import Link from "next/link";
import {
  BarChart3,
  Files,
  FileSpreadsheet,
  FolderSearch,
  LayoutDashboard,
  ListChecks,
  PackageSearch,
  ReceiptText,
  SearchCheck,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/scan", label: "文件扫描", icon: FolderSearch },
  { href: "/files", label: "文件列表", icon: Files },
  { href: "/products", label: "产品管理", icon: PackageSearch },
  { href: "/import", label: "Excel 导入", icon: FileSpreadsheet },
  { href: "/triage", label: "产品整理", icon: ListChecks },
  { href: "/quotes", label: "报价中心", icon: ReceiptText },
  { href: "/customer-quotes", label: "历史报价", icon: SearchCheck },
  { href: "/customers", label: "客户管理", icon: Users },
  { href: "/data-quality", label: "数据质量", icon: BarChart3 },
];

export function Sidebar() {
  return (
    <aside className="flex min-h-screen w-60 shrink-0 flex-col border-r border-line bg-white">
      <div className="border-b border-line px-5 py-5">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Local MVP</div>
        <div className="mt-2 text-xl font-semibold text-ink">报价资料库</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-cream"
            >
              <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line px-5 py-4 text-xs leading-5 text-slate-400">
        Phase 1 - 6
        <br />
        本地 SQLite
      </div>
    </aside>
  );
}
