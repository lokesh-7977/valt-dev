import { HealthCard } from "@/components/health-card";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">VALT</h1>
        <p className="mt-1 text-sm opacity-70">Next.js web + FastAPI service in one repo.</p>
      </div>
      <HealthCard />
    </main>
  );
}
