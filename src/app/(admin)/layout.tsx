import type { ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
    </div>
  );
}
