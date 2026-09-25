import { ArrowRightIcon, FileTextIcon, ImageIcon, MicIcon, TypeIcon } from "lucide-react";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { siteConfig } from "@/config/site";

const ICONS = { text: TypeIcon, file: FileTextIcon, image: ImageIcon, audio: MicIcon } as const;

export default function Home() {
  const { home } = siteConfig;
  return (
    <PageContainer narrow className="pt-16 sm:pt-28">
      <section className="flex flex-col items-center text-center">
        <p className="text-footnote font-semibold text-muted-foreground">{home.eyebrow}</p>
        <h1 className="mt-3 text-display font-semibold text-balance">{siteConfig.tagline}</h1>
        <p className="mt-6 max-w-[46ch] text-title-3 font-normal text-balance text-muted-foreground">
          {siteConfig.description}
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="rounded-full px-7">
            <Link href={siteConfig.primaryCta.href}>
              {siteConfig.primaryCta.label}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost" className="rounded-full">
            <Link href="/dashboard">See system status</Link>
          </Button>
        </div>
      </section>

      <section
        aria-label="What you can analyze"
        className="mt-20 grid grid-cols-2 gap-4 sm:mt-28 lg:grid-cols-4"
      >
        {home.capabilities.map((c) => {
          const Icon = ICONS[c.icon];
          return (
            <Link key={c.title} href={siteConfig.primaryCta.href} className="group rounded-xl">
              <Card className="h-full transition-transform duration-150 ease-standard group-hover:-translate-y-0.5 group-active:scale-[0.98]">
                <CardContent className="flex flex-col gap-3">
                  <span className="grid size-10 place-items-center rounded-[12px] bg-secondary text-foreground">
                    <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-body font-semibold">{c.title}</p>
                    <p className="mt-1 text-callout text-muted-foreground">{c.body}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      <section aria-labelledby="how" className="mt-20 sm:mt-28">
        <h2 id="how" className="text-center text-title-2 font-semibold">
          How it works
        </h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {home.steps.map((s, i) => (
            <li key={s.title} className="flex flex-col items-center text-center">
              <span className="grid size-9 place-items-center rounded-full bg-foreground text-callout font-semibold text-background tabular-nums">
                {i + 1}
              </span>
              <p className="mt-4 text-body font-semibold">{s.title}</p>
              <p className="mt-1 max-w-[28ch] text-callout text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </PageContainer>
  );
}
