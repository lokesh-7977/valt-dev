"use client";

import { CheckIcon, Loader2Icon, MicIcon, RotateCcwIcon, SquareIcon } from "lucide-react";

import { useObjectUrl } from "@/components/inputs/file-preview-list";
import { Button } from "@/components/ui/button";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Record a voice note → WAV File. Calls `onRecorded` when the user confirms.
 * Pair with a FileDropzone accepting audio/* for uploads.
 */
export function AudioRecorder({
  onRecorded,
  maxMs,
  className,
}: {
  onRecorded: (file: File) => void;
  maxMs?: number;
  className?: string;
}) {
  const rec = useAudioRecorder({ maxMs });
  const url = useObjectUrl(rec.file);
  const recording = rec.status === "recording";

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-8 text-center shadow-card",
        className,
      )}
    >
      {rec.status === "done" && url ? (
        <>
          <audio controls src={url} className="w-full max-w-sm" />
          <p className="text-footnote text-muted-foreground">
            {formatDuration(rec.elapsedMs)} recorded
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={rec.reset}>
              <RotateCcwIcon data-icon="inline-start" /> Record again
            </Button>
            <Button
              onClick={() => {
                if (rec.file) onRecorded(rec.file);
                rec.reset();
              }}
            >
              <CheckIcon data-icon="inline-start" /> Use recording
            </Button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={recording ? rec.stop : rec.start}
            disabled={rec.status === "requesting" || rec.status === "processing"}
            aria-label={recording ? "Stop recording" : "Start recording"}
            className={cn(
              "relative grid size-20 place-items-center rounded-full transition-[transform,background-color] duration-150 ease-standard active:scale-95 disabled:opacity-60",
              recording
                ? "bg-destructive text-primary-foreground"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {recording && (
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-full bg-destructive/30 motion-reduce:hidden"
              />
            )}
            {rec.status === "processing" || rec.status === "requesting" ? (
              <Loader2Icon className="size-7 animate-spin" />
            ) : recording ? (
              <SquareIcon className="size-6 fill-current" />
            ) : (
              <MicIcon className="size-7" strokeWidth={1.75} />
            )}
          </button>
          <div aria-live="polite">
            <p className="text-body font-semibold tabular-nums">
              {recording
                ? formatDuration(rec.elapsedMs)
                : rec.status === "processing"
                  ? "Preparing audio…"
                  : rec.status === "requesting"
                    ? "Waiting for microphone…"
                    : "Tap to record"}
            </p>
            <p className="mt-1 text-footnote text-muted-foreground">
              {recording ? "Tap again to stop" : "Speak naturally — we'll transcribe it."}
            </p>
          </div>
          {rec.error && (
            <p role="alert" className="text-footnote text-destructive">
              {rec.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
