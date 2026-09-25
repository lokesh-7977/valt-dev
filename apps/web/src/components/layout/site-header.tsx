"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { navItems, siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="material sticky top-0 z-40 border-b">
      <nav
        aria-label="Main"
        className="mx-auto flex h-13 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10"
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-callout font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-lg bg-foreground text-background text-footnote font-bold"
          >
            {siteConfig.name.charAt(0)}
          </span>
          {siteConfig.name}
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-callout text-muted-foreground transition-colors duration-150 ease-standard hover:text-foreground",
                  isActive(item.href) && "bg-secondary text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="hidden rounded-full sm:inline-flex">
            <Link href={siteConfig.primaryCta.href}>{siteConfig.primaryCta.label}</Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>{siteConfig.name}</SheetTitle>
                <SheetDescription>{siteConfig.tagline}</SheetDescription>
              </SheetHeader>
              <ul className="flex flex-col gap-1 px-4">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={cn(
                        "flex h-11 items-center rounded-[12px] px-3 text-body",
                        isActive(item.href) ? "bg-secondary font-medium" : "hover:bg-accent",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-auto p-4">
                <Button asChild className="w-full">
                  <Link href={siteConfig.primaryCta.href} onClick={() => setOpen(false)}>
                    {siteConfig.primaryCta.label}
                  </Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
