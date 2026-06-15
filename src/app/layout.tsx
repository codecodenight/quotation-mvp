import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Supplier Quotation MVP",
  description: "Local supplier quotation management tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
      </body>
    </html>
  );
}
