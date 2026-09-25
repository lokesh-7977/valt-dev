import { AlertCircleIcon, InboxIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { UserFacingError } from "@/lib/errors";
import { cn } from "@/lib/utils";

function StateFrame({
  icon: Icon,
  tone = "muted",
  title,
  description,
  action,
  className,
  children,
}: {
  icon: LucideIcon;
  tone?: "muted" | "destructive";
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl px-6 py-14 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-12 place-items-center rounded-full",
          tone === "destructive"
            ? "bg-destructive/10 text-destructive"
            : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <div className="max-w-[44ch]">
        <p className="text-body font-semibold">{title}</p>
        {description && <p className="mt-1 text-callout text-muted-foreground">{description}</p>}
      </div>
      {children}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon = InboxIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <StateFrame
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={cn("border border-dashed", className)}
    />
  );
}

export function ErrorState({
  error,
  onRetry,
  secondaryAction,
  className,
}: {
  error: Pick<UserFacingError, "title" | "description"> & Partial<UserFacingError>;
  onRetry?: () => void;
  secondaryAction?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert">
      <StateFrame
        icon={AlertCircleIcon}
        tone="destructive"
        title={error.title}
        description={error.description}
        className={className}
        action={
          (onRetry && error.retryable !== false) || secondaryAction ? (
            <>
              {onRetry && error.retryable !== false && (
                <Button onClick={onRetry}>
                  <RotateCcwIcon data-icon="inline-start" /> Try again
                </Button>
              )}
              {secondaryAction}
            </>
          ) : undefined
        }
      >
        {error.requestId && (
          <p className="font-mono text-footnote text-muted-foreground">Ref: {error.requestId}</p>
        )}
      </StateFrame>
    </div>
  );
}

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 py-14 text-callout text-muted-foreground",
        className,
      )}
    >
      <Loader2Icon aria-hidden className="size-4 animate-spin" />
      {label}
    </div>
  );
}
