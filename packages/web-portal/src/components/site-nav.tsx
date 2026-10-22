import Link from "next/link";

const LINKS = [
  { href: "/companion", label: "📱 Stage 1: Coastal Companion" },
  { href: "/", label: "✈️ Stage 2–4: Ibom Air Dispatch" },
  { href: "/trace/FF-MAN-QI0412-20261014", label: "🛡️ Stage 5: FreshTrace™ Buyer QR" },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/95 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-3 py-2">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-100 hover:border-aviation/60 sm:text-sm"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
