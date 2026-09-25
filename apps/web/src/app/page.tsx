import { HealthCard } from "@/components/health-card";

export default function Home() {
  return (
    <>
      <header className="material sticky top-0 z-40 border-b">
        <nav className="mx-auto flex h-13 max-w-[980px] items-center justify-between px-4 sm:px-6">
          <span className="text-callout font-semibold tracking-tight">VALT</span>
          <a
            href="http://localhost:8000/docs"
            className="text-callout text-link transition-opacity duration-150 ease-standard hover:opacity-80"
          >
            API docs
          </a>
        </nav>
      </header>

      <main className="mx-auto flex max-w-[980px] flex-col items-center px-4 pt-24 pb-32 text-center sm:px-6 sm:pt-32">
        <p className="text-footnote font-semibold text-muted-foreground">Next.js · FastAPI · LangGraph</p>
        <h1 className="mt-3 text-display font-semibold text-balance">Your work, with an assistant that thinks it through.</h1>
        <p className="mt-6 max-w-[40ch] text-title-3 font-normal text-balance text-muted-foreground">
          One repo for the web app and the AI service, wired together and ready to build on.
        </p>

        <div className="mt-16 w-full max-w-md text-left">
          <HealthCard />
        </div>
      </main>
    </>
  );
}
