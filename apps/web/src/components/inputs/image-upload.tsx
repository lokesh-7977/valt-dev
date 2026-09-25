"use client";

import { CameraIcon, ImageIcon, XIcon } from "lucide-react";

import { FileDropzone } from "@/components/inputs/file-dropzone";
import { useObjectUrl } from "@/components/inputs/file-preview-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

function ImageTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useObjectUrl(file);
  return (
    <figure className="group relative aspect-square overflow-hidden rounded-xl bg-secondary">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={url} alt={file.name} className="size-full object-cover" />
      )}
      <Button
        type="button"
        size="icon-sm"
        variant="secondary"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute top-2 right-2 rounded-full shadow-card"
      >
        <XIcon />
      </Button>
    </figure>
  );
}

/** Image picker with drag-drop, phone camera capture, and a preview grid. Controlled. */
export function ImageUpload({
  value,
  onChange,
  max = 6,
  showPreviews = true,
  className,
}: {
  value: File[];
  onChange: (files: File[]) => void;
  max?: number;
  /** Turn off when the parent already lists attached files. */
  showPreviews?: boolean;
  className?: string;
}) {
  const add = (files: File[]) => onChange([...value, ...files].slice(0, max));
  const full = value.length >= max;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FileDropzone
          accept={IMAGE_ACCEPT}
          onFiles={add}
          disabled={full}
          icon={ImageIcon}
          title={full ? `Up to ${max} images` : "Drop images or click to choose"}
          hint="PNG, JPG, WebP, HEIC"
        />
        <FileDropzone
          accept={IMAGE_ACCEPT}
          onFiles={add}
          disabled={full}
          multiple={false}
          capture="environment"
          icon={CameraIcon}
          title="Take photo"
          className="sm:hidden"
        />
      </div>
      {showPreviews && value.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {value.map((file, i) => (
            <ImageTile
              key={`${file.name}-${file.lastModified}-${i}`}
              file={file}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
