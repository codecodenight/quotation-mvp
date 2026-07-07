import type { ReactNode } from "react";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#f8f5ff] via-white to-[#f3eeff]">
      {children}
    </div>
  );
}
