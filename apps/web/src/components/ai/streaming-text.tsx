import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Streamed model text. Plain text only (model output is untrusted — never inject as HTML).
 * Shows a skeleton until the first token, then a soft caret while streaming.
 */
export function StreamingText({
  text,
  streaming,
  className,
}: {
  text: string;
  streaming: boolean;
  className?: string;
}) {
  return (
    <div aria-live="polite" aria-busy={streaming} className={cn("text-body", className)}>
      {!text && streaming ? (
        <div className="flex flex-col gap-2.5" aria-label="Generating">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <p className="whitespace-pre-wrap">
          {text}
          {streaming && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.2em] animate-pulse bg-primary"
            />
          )}
        </p>
      )}
    </div>
  );
}
