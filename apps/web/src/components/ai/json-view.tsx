import { cn } from "@/lib/utils";

/**
 * Renders any JSON result readably — for custom `output_schema` results before a bespoke Result
 * component exists. Objects → labelled rows, arrays of scalars → bullets, arrays of objects → cards.
 */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={cn("text-callout", className)}>
      <Node value={value} depth={0} />
    </div>
  );
}

const humanize = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const PERCENT_KEY = /confidence|probability|score/i;

function Scalar({ value, field }: { value: unknown; field?: string }) {
  if (value === null || value === undefined || value === "")
    return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number")
    return (
      <span className="tabular-nums">
        {field && PERCENT_KEY.test(field) && value >= 0 && value <= 1
          ? `${Math.round(value * 100)}%`
          : value}
      </span>
    );
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

function Node({ value, depth, field }: { value: unknown; depth: number; field?: string }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">None</span>;
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return (
        <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground">
          {value.map((v, i) => (
            <li key={i}>
              <Scalar value={v} />
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {value.map((v, i) => (
          <div key={i} className="rounded-[12px] bg-secondary/60 p-3.5">
            <Node value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (value && typeof value === "object") {
    return (
      <dl className={cn("flex flex-col", depth === 0 ? "gap-4" : "gap-2.5")}>
        {Object.entries(value).map(([k, v]) => {
          const nested = v !== null && typeof v === "object";
          return (
            <div
              key={k}
              className={cn(
                "flex gap-1",
                nested ? "flex-col" : "flex-col sm:flex-row sm:items-baseline sm:gap-4",
              )}
            >
              <dt className="shrink-0 text-footnote font-medium text-muted-foreground sm:w-40">
                {humanize(k)}
              </dt>
              <dd className="min-w-0">
                <Node value={v} depth={depth + 1} field={k} />
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return <Scalar value={value} field={field} />;
}
