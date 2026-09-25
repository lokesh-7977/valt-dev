import { cn } from "@/lib/utils";

/** Page width + gutters (MASTER §4). `narrow` for reading/forms, default for app workspaces. */
export function PageContainer({
  narrow,
  className,
  ...props
}: React.ComponentProps<"div"> & { narrow?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pt-10 pb-24 sm:px-6 sm:pt-14 lg:px-10",
        narrow ? "max-w-[860px]" : "max-w-[1200px]",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="text-footnote font-semibold text-muted-foreground">{eyebrow}</p>}
        <h1 className="mt-1 text-title-2 font-semibold text-balance sm:text-title-1">{title}</h1>
        {description && (
          <p className="mt-3 max-w-[60ch] text-body text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A titled block inside a page. */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-4">
          <div>
            {title && <h2 className="text-title-3 font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 text-callout text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
