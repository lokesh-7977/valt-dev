import { ChevronRightIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export interface ListGroupItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** Right-side content (badge, value, time). */
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}

/** iOS-style inset grouped list (MASTER §7): rounded group, inset hairlines, chevrons to drill in. */
export function ListGroup({ items, className }: { items: ListGroupItem[]; className?: string }) {
  return (
    <ul className={cn("overflow-hidden rounded-xl bg-card shadow-card", className)}>
      {items.map((item, i) => {
        const Icon = item.icon;
        const interactive = !!(item.href || item.onClick);
        const body = (
          <>
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground">
                <Icon aria-hidden className="size-4.5" strokeWidth={1.75} />
              </span>
            )}
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 py-3 pr-4",
                i > 0 && "border-t",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-callout font-medium">{item.title}</span>
                {item.description && (
                  <span className="block truncate text-footnote text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
              {item.trailing && <span className="shrink-0">{item.trailing}</span>}
              {interactive && (
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              )}
            </span>
          </>
        );
        const rowClass = cn(
          "flex w-full items-center gap-3 pl-4 text-left",
          interactive &&
            "transition-colors duration-150 ease-standard hover:bg-accent/60 focus-visible:bg-accent/60",
        );
        return (
          <li key={item.id}>
            {item.href ? (
              <Link href={item.href} className={rowClass}>
                {body}
              </Link>
            ) : item.onClick ? (
              <button type="button" onClick={item.onClick} className={rowClass}>
                {body}
              </button>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
