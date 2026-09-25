"use client";

import { UploadCloudIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { matchesAccept } from "@/lib/workflow/schema";
import { cn } from "@/lib/utils";

export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  /** MIME types / wildcards / extensions: ["image/*", "application/pdf", ".md"] */
  accept?: string[];
  multiple?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  title?: string;
  hint?: string;
  /** Opens the camera on phones (image inputs). */
  capture?: "user" | "environment";
  className?: string;
}

/** Drag-and-drop + click/keyboard file picker. Rejected types are reported with a toast. */
export function FileDropzone({
  onFiles,
  accept = [],
  multiple = true,
  disabled,
  icon: Icon = UploadCloudIcon,
  title = "Drop files here or click to browse",
  hint,
  capture,
  className,
}: FileDropzoneProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = (list: FileList | null) => {
    if (!list?.length) return;
    const all = Array.from(list);
    const ok = all.filter((f) => matchesAccept(f, accept));
    const rejected = all.length - ok.length;
    if (rejected) {
      toast.error(`${rejected} file${rejected > 1 ? "s" : ""} not supported`, {
        description: "Check the file type and try again.",
      });
    }
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handle(e.dataTransfer.files);
      }}
      className={cn(
        "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed border-input/60 bg-card px-6 py-10 text-center transition-[border-color,background-color] duration-150 ease-standard",
        "hover:border-primary/60 hover:bg-accent/50 has-focus-visible:border-ring has-focus-visible:ring-4 has-focus-visible:ring-ring/25",
        dragging && "border-primary bg-primary/5",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors group-hover:text-primary"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <span>
        <span className="block text-callout font-medium">{title}</span>
        {hint && <span className="mt-1 block text-footnote text-muted-foreground">{hint}</span>}
      </span>
      <input
        ref={input}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept.join(",") || undefined}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = ""; // allow picking the same file again
        }}
      />
    </label>
  );
}
