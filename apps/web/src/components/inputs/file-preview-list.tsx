"use client";

import { FileAudioIcon, FileIcon, FileTextIcon, FileVideoIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";

/** Object URL for a file, revoked on change/unmount. */
export function useObjectUrl(file: File | Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function kindIcon(type: string) {
  if (type.startsWith("audio/")) return FileAudioIcon;
  if (type.startsWith("video/")) return FileVideoIcon;
  if (type === "application/pdf" || type.startsWith("text/")) return FileTextIcon;
  return FileIcon;
}

function FileThumb({ file }: { file: File }) {
  const isImage = file.type.startsWith("image/");
  const url = useObjectUrl(isImage ? file : null);
  if (isImage && url) {
    // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimizable asset
    return <img src={url} alt="" className="size-11 shrink-0 rounded-[10px] object-cover" />;
  }
  const Icon = kindIcon(file.type);
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground">
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
    </span>
  );
}

export function FilePreviewList({
  files,
  onRemove,
  className,
}: {
  files: File[];
  onRemove?: (index: number) => void;
  className?: string;
}) {
  if (!files.length) return null;
  return (
    <ul className={cn("divide-y rounded-xl bg-card shadow-card", className)}>
      {files.map((file, i) => (
        <li
          key={`${file.name}-${file.size}-${file.lastModified}`}
          className="flex items-center gap-3 px-3 py-2.5"
        >
          <FileThumb file={file} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-callout font-medium">{file.name}</p>
            <p className="text-footnote text-muted-foreground">
              {formatBytes(file.size)} · {file.type || "unknown type"}
            </p>
          </div>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemove(i)}
            >
              <XIcon />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
