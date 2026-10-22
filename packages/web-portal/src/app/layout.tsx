import type { Metadata, Viewport } from "next";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreshFlite | Ibom Air",
  description: "Aviation cold-chain dispatch and FreshTrace buyer verification.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-slate-100 antialiased">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
