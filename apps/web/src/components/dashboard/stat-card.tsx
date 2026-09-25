import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Secondary line: a delta, a unit, or context ("vs. last week"). */
  hint?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-footnote font-medium text-muted-foreground">{label}</span>
          {Icon && <Icon aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.75} />}
        </div>
        <div className="text-title-2 font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-footnote text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)} {...props} />;
}
