import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-aviation">FreshFlite</p>
      <h1 className="text-2xl font-semibold">Manifest not on this flight board</h1>
      <Link href="/" className="text-sm text-aviation underline">
        Return to dispatch
      </Link>
    </main>
  );
}
